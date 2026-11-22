import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { ENV } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import {
  assertSafeOutboundUrl,
  safeFetchWithRedirects,
} from '../security/antiSsrfGuard.js';
import { selectOptimalUpstreamUserAgent } from './idmTurboDownloader.js';
import {
  ALLOWED_DOWNLOAD_EXTENSIONS,
  getLibraryEntry,
} from '../data/downloadLibrary.js';
import { mimeForExtension, extensionOfFileName } from '../data/mediaFormats.js';

// ============================================================================
// SIGNED DOWNLOAD TICKETS (IDM / FDM / JDOWNLOADER / ARIA2 / BROWSER READY)
// - HMAC-SHA256 signed payload with expiry timestamp.
// - Reusable within TTL so multi-connection downloaders (IDM 8x-32x HTTP Range)
//   and pause/resume transfers work seamlessly.
// - Validates every redirect hop via Anti-SSRF guard.
// ============================================================================

const TICKET_SECRET =
  process.env.DOWNLOAD_TICKET_SECRET || `${ENV.JWT_USER_SECRET}::download-ticket::v10`;

function getEffectiveTicketTtlSeconds() {
  if (process.env.DOWNLOAD_TICKET_TTL_SECONDS) {
    return Number(process.env.DOWNLOAD_TICKET_TTL_SECONDS);
  }
  return ENV.NODE_ENV === 'test' ? 300 : ENV.DOWNLOAD_TICKET_TTL_SECONDS || 7200;
}

const MAX_TICKET_LENGTH = 4096;

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(encodedPayload) {
  return crypto.createHmac('sha256', TICKET_SECRET).update(encodedPayload).digest('base64url');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function sanitizeDownloadFileName(rawName, fallbackExt = 'bin') {
  const fallback = `UltraDownloader_File.${fallbackExt}`;
  const cleaned = String(rawName || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);

  if (!cleaned) return fallback;

  const ext = cleaned.includes('.') ? cleaned.split('.').pop().toLowerCase() : '';
  if (!ALLOWED_DOWNLOAD_EXTENSIONS.includes(ext)) {
    return fallback;
  }
  return cleaned;
}

function extensionOf(fileName) {
  return extensionOfFileName(fileName);
}

function buildContentDisposition(fileName) {
  const asciiFallback = String(fileName).replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '') || 'file';
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Creates a signed ticket for either a library file (`fileId`) or an
 * authorized remote media stream (`url`). Returns a same-origin URL with a
 * clean filename in the path so Chrome, Edge, Firefox, IDM, FDM, JDownloader,
 * and aria2 all save the exact filename and support Range resume.
 */
export async function createDownloadTicket({
  fileId = '',
  url = '',
  fileName = '',
  mimeType = '',
  sourceUrl = '',
  title = '',
  qualityLabel = '',
  user = null,
  originBaseUrl = '',
}) {
  const requestedFileId = String(fileId || '').trim();
  const requestedUrl = String(url || '').trim();

  if (!requestedFileId && !requestedUrl) {
    throw new AppError(
      400,
      'DOWNLOAD_TARGET_REQUIRED',
      'No file was selected for download. Please choose a file or a video stream first.'
    );
  }

  let target;

  if (requestedFileId) {
    const entry = getLibraryEntry(requestedFileId);
    if (!entry) {
      throw new AppError(404, 'FILE_NOT_REGISTERED', 'This file is not available for download.');
    }
    if (entry.requiresAuth && !user) {
      throw new AppError(
        401,
        'AUTH_REQUIRED',
        'Please sign in to download this protected file.'
      );
    }
    if (!entry.exists) {
      throw new AppError(404, 'FILE_NOT_FOUND', 'This file is no longer available.');
    }

    target = {
      kind: 'local',
      fileId: entry.fileId,
      absolutePath: entry.absolutePath,
      fileName: entry.fileName,
      mimeType: entry.mimeType,
      sizeBytes: entry.sizeBytes,
    };
  } else {
    const parsed = await assertSafeOutboundUrl(requestedUrl, { performDnsCheck: true });
    const guessedExt = extensionOf(fileName) || extensionOf(parsed.pathname) || 'mp4';
    const finalName = sanitizeDownloadFileName(fileName || `UltraDownloader_Download.${guessedExt}`, guessedExt);
    const finalExt = extensionOf(finalName) || guessedExt;

    let detectedSizeBytes = 0;
    let detectedMime = String(mimeType || '').trim() || mimeForExtension(finalExt);

    if (!looksLikeHlsPlaylist(parsed.toString(), detectedMime)) {
      const probeHeaders = {
        'User-Agent': selectOptimalUpstreamUserAgent(parsed.toString()),
        Accept: '*/*',
        ...(sourceUrl && /^https?:\/\//i.test(sourceUrl) && !parsed.hostname.includes('googlevideo.com')
          ? { Referer: sourceUrl }
          : {}),
      };
      let probeRes = await safeFetchWithRedirects(parsed.toString(), {
        method: 'HEAD',
        headers: probeHeaders,
        signal: AbortSignal.timeout(10000),
      }).catch((err) => {
        if (err instanceof AppError) throw err;
        return null;
      });
      let fromRangeProbe = false;
      if (!probeRes || [403, 405, 501].includes(probeRes.status) || !probeRes.headers.get('content-length')) {
        probeRes?.body?.cancel?.().catch?.(() => {});
        fromRangeProbe = true;
        probeRes = await safeFetchWithRedirects(parsed.toString(), {
          method: 'GET',
          headers: { ...probeHeaders, Range: 'bytes=0-0' },
          signal: AbortSignal.timeout(10000),
        }).catch((err) => {
          if (err instanceof AppError) throw err;
          return null;
        });
      }

      if (!probeRes) {
        throw new AppError(
          502,
          'UPSTREAM_UNAVAILABLE',
          'The media server could not be reached. Please check the link and try again.'
        );
      }
      if (!probeRes.ok && probeRes.status !== 206) {
        probeRes.body?.cancel?.().catch?.(() => {});
        throw new AppError(
          probeRes.status === 404 ? 404 : 502,
          'UPSTREAM_ERROR',
          probeRes.status === 404
            ? 'The requested media file returned HTTP 404 (not found).'
            : `The remote media server rejected the probe (HTTP ${probeRes.status}).`
        );
      }
      const probeCt = String(probeRes.headers.get('content-type') || '');
      if (/text\/html/i.test(probeCt) && finalExt && !/^(html?|php)$/i.test(finalExt)) {
        probeRes.body?.cancel?.().catch?.(() => {});
        throw new AppError(
          502,
          'HOST_BLOCKED_DOWNLOAD',
          'The remote URL returned an HTML webpage instead of a downloadable media stream.'
        );
      }
      const cr = String(probeRes.headers.get('content-range') || '');
      const totalFromRange = cr.includes('/') ? Number(cr.split('/')[1]) : 0;
      detectedSizeBytes =
        (fromRangeProbe && totalFromRange > 0 ? totalFromRange : Number(probeRes.headers.get('content-length') || 0)) ||
        totalFromRange ||
        0;
      if (probeCt && !/octet-stream|text\/plain/i.test(probeCt)) {
        detectedMime = probeCt.split(';')[0].trim();
      }
      probeRes.body?.cancel?.().catch?.(() => {});
    }

    target = {
      kind: 'remote',
      upstreamUrl: parsed.toString(),
      fileName: finalName,
      mimeType: detectedMime,
      sizeBytes: detectedSizeBytes,
      sourceUrl: String(sourceUrl || '').trim(),
      title: String(title || '').slice(0, 200),
      qualityLabel: String(qualityLabel || '').slice(0, 64),
    };
  }

  const ttlSeconds = getEffectiveTicketTtlSeconds();
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    ...target,
    iss: 'ultradownloader',
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    jti: crypto.randomUUID(),
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encoded);
  const ticket = `${encoded}.${signature}`;
  const safeName = encodeURIComponent(payload.fileName);

  return {
    ticket,
    fileName: payload.fileName,
    mimeType: payload.mimeType,
    sizeBytes: payload.sizeBytes || 0,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    expiresInSeconds: ttlSeconds,
    downloadPath: `/api/v1/files/download/${safeName}?ticket=${encodeURIComponent(ticket)}`,
    downloadUrl: originBaseUrl
      ? `${originBaseUrl}/api/v1/files/download/${safeName}?ticket=${encodeURIComponent(ticket)}`
      : `/api/v1/files/download/${safeName}?ticket=${encodeURIComponent(ticket)}`,
  };
}

export function verifyDownloadTicket(rawTicket) {
  const ticket = String(rawTicket || '').trim();
  if (!ticket || ticket.length > MAX_TICKET_LENGTH) {
    throw new AppError(400, 'INVALID_TICKET', 'This download link is incomplete. Please click Download again.');
  }

  const separatorIndex = ticket.lastIndexOf('.');
  if (separatorIndex <= 0) {
    throw new AppError(403, 'INVALID_TICKET', 'This download link is not valid. Please click Download again.');
  }

  const encoded = ticket.slice(0, separatorIndex);
  const signature = ticket.slice(separatorIndex + 1);

  if (!safeEqual(signPayload(encoded), signature)) {
    throw new AppError(
      403,
      'TICKET_SIGNATURE_INVALID',
      'This download link was modified and cannot be used. Please click Download again.'
    );
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded));
  } catch {
    throw new AppError(403, 'INVALID_TICKET', 'This download link is not readable. Please click Download again.');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!payload?.exp || payload.exp <= nowSeconds) {
    throw new AppError(
      410,
      'TICKET_EXPIRED',
      'This download link has expired. Please click Download again to get a fresh link.'
    );
  }

  return payload;
}

function applyAttachmentHeaders(res, fileName, mimeType, extra = {}) {
  res.setHeader('Content-Disposition', buildContentDisposition(fileName));
  res.setHeader('Content-Type', mimeType || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range,Accept-Ranges,Content-Length,Content-Disposition');
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== null) res.setHeader(key, value);
  });
}

function parseRangeHeader(rangeHeader, totalSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader || '').trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  let start = rawStart ? Number.parseInt(rawStart, 10) : 0;
  let end = rawEnd ? Number.parseInt(rawEnd, 10) : totalSize - 1;

  if (!rawStart && rawEnd) {
    const suffixLength = Number.parseInt(rawEnd, 10);
    start = Math.max(totalSize - suffixLength, 0);
    end = totalSize - 1;
  }

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= totalSize) return null;
  return { start, end: Math.min(end, totalSize - 1) };
}

async function streamLocalFile(req, res, payload) {
  let stat;
  try {
    stat = fs.statSync(payload.absolutePath);
  } catch {
    throw new AppError(404, 'FILE_NOT_FOUND', 'This file is no longer available on the server.');
  }
  if (!stat.isFile()) {
    throw new AppError(404, 'FILE_NOT_FOUND', 'This file is no longer available on the server.');
  }

  const totalSize = stat.size;
  const range = parseRangeHeader(req.headers.range, totalSize);

  res.setHeader('Accept-Ranges', 'bytes');

  if (range) {
    const chunkSize = range.end - range.start + 1;
    applyAttachmentHeaders(res, payload.fileName, payload.mimeType, {
      'Content-Range': `bytes ${range.start}-${range.end}/${totalSize}`,
      'Content-Length': String(chunkSize),
    });
    res.status(206);
    if (req.method === 'HEAD') return res.end();
    await pipeline(fs.createReadStream(payload.absolutePath, { start: range.start, end: range.end }), res).catch(
      () => {}
    );
    return;
  }

  applyAttachmentHeaders(res, payload.fileName, payload.mimeType, {
    'Content-Length': String(totalSize),
  });
  res.status(200);
  if (req.method === 'HEAD') return res.end();
  await pipeline(fs.createReadStream(payload.absolutePath), res).catch(() => {});
}

function looksLikeHlsPlaylist(targetUrl, mimeType = '') {
  const u = String(targetUrl || '');
  if (/\.m3u8(\?|#|$)/i.test(u)) return true;
  if (/format=m3u8|type=m3u8|[?&]hls=1/i.test(u)) return true;
  return /mpegurl/i.test(String(mimeType || ''));
}

async function streamRemoteFile(req, res, payload) {
  if (looksLikeHlsPlaylist(payload.upstreamUrl, payload.mimeType)) {
    const { writeHlsAsSingleFile } = await import('./streamProxyService.js');
    return writeHlsAsSingleFile(req, res, {
      url: payload.upstreamUrl,
      referer: payload.sourceUrl,
      fileName: payload.fileName,
    });
  }

  const upstreamHeaders = {
    'User-Agent': selectOptimalUpstreamUserAgent(payload.upstreamUrl),
    Accept: '*/*',
  };
  if (payload.sourceUrl && /^https?:\/\//i.test(payload.sourceUrl) && !payload.upstreamUrl.includes('googlevideo.com')) {
    upstreamHeaders.Referer = payload.sourceUrl;
  }
  if (req.headers.range) upstreamHeaders.Range = req.headers.range;

  const controller = new AbortController();
  if (typeof req.on === 'function') {
    req.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
  }

  let upstream;
  let usedRangeProbeForHead = false;
  try {
    if (req.method === 'HEAD') {
      upstream = await safeFetchWithRedirects(payload.upstreamUrl, {
        method: 'HEAD',
        headers: upstreamHeaders,
        signal: controller.signal,
      });
      if ([403, 405, 501].includes(upstream.status) || !upstream.headers.get('content-length')) {
        upstream.body?.cancel?.().catch?.(() => {});
        usedRangeProbeForHead = true;
        upstream = await safeFetchWithRedirects(payload.upstreamUrl, {
          method: 'GET',
          headers: { ...upstreamHeaders, Range: 'bytes=0-0' },
          signal: controller.signal,
        });
      }
    } else {
      upstream = await safeFetchWithRedirects(payload.upstreamUrl, {
        method: 'GET',
        headers: upstreamHeaders,
        signal: controller.signal,
      });
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.name === 'AbortError') return;
    throw new AppError(
      502,
      'UPSTREAM_UNAVAILABLE',
      'The media server could not be reached. Please try again in a moment.'
    );
  }

  if (!upstream.ok && upstream.status !== 206) {
    upstream.body?.cancel?.().catch?.(() => {});
    throw new AppError(
      upstream.status === 404 ? 404 : upstream.status === 403 || upstream.status === 401 ? 403 : 502,
      'UPSTREAM_ERROR',
      upstream.status === 404
        ? 'The media file was not found on the remote server (HTTP 404).'
        : upstream.status === 403 || upstream.status === 401
        ? 'The media server refused this download (access expired). Please extract the link again.'
        : `The media server returned an error (HTTP ${upstream.status}).`
    );
  }

  const upstreamMime = upstream.headers.get('content-type') || payload.mimeType;
  const reqExt = extensionOf(payload.fileName);
  if (/text\/html/i.test(upstreamMime) && reqExt && !/^(html?|php)$/i.test(reqExt)) {
    upstream.body?.cancel?.().catch?.(() => {});
    throw new AppError(
      502,
      'HOST_BLOCKED_DOWNLOAD',
      'The remote server returned a webpage instead of the media file. Please re-extract the link.'
    );
  }

  const contentRange = upstream.headers.get('content-range') || '';
  const totalFromRange = contentRange.includes('/') ? contentRange.split('/')[1] : '';
  const contentLength = usedRangeProbeForHead && totalFromRange && totalFromRange !== '*'
    ? totalFromRange
    : upstream.headers.get('content-length');

  applyAttachmentHeaders(res, payload.fileName, payload.mimeType || upstreamMime, {
    'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
    'Content-Length': contentLength || undefined,
    'Content-Range': contentRange && !usedRangeProbeForHead ? contentRange : undefined,
  });

  res.status(!usedRangeProbeForHead && contentRange ? 206 : 200);

  if (req.method === 'HEAD' || !upstream.body) {
    upstream.body?.cancel?.().catch?.(() => {});
    controller.abort();
    return res.end();
  }

  await pipeline(Readable.fromWeb(upstream.body), res).catch(() => {});
}

export async function serveTicketDownload(req, res, rawTicket) {
  const payload = verifyDownloadTicket(rawTicket);

  if (payload.kind === 'local') {
    return streamLocalFile(req, res, payload);
  }
  if (payload.kind === 'remote') {
    return streamRemoteFile(req, res, payload);
  }
  throw new AppError(400, 'INVALID_TICKET', 'This download link is not supported.');
}

export { buildContentDisposition };

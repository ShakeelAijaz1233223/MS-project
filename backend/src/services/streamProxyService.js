import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  assertSafeOutboundUrl,
  safeFetchWithRedirects,
} from '../security/antiSsrfGuard.js';
import { selectOptimalUpstreamUserAgent } from './idmTurboDownloader.js';
import { AppError } from '../utils/errors.js';
import { mimeForExtension } from '../data/mediaFormats.js';

function applyContentDispositionHeader(res, downloadFileName) {
  if (!downloadFileName) return;
  const asciiFallback =
    String(downloadFileName)
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\\]/g, '')
      .trim() || 'video.mp4';
  const utf8Encoded = encodeURIComponent(downloadFileName);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`
  );
}

// ============================================================================
// REAL RFC-9110 HTTP 206 PARTIAL CONTENT RANGE STREAMER (LOCAL FILES ON DISK)
// ============================================================================
export function streamLocalFileWithRange(
  req,
  res,
  filePath,
  mimeType = 'video/mp4',
  downloadFileName = null
) {
  if (!fs.existsSync(filePath)) {
    throw new AppError(404, 'NOT_FOUND', 'Requested media file does not exist on disk.');
  }

  const stat = fs.statSync(filePath);
  const totalSize = stat.size;
  const rangeHeader = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);
  applyContentDispositionHeader(res, downloadFileName);

  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (!match) {
      res.setHeader('Content-Range', `bytes */${totalSize}`);
      return res.status(416).end();
    }
    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

    if (start >= totalSize || end >= totalSize || start > end) {
      res.setHeader('Content-Range', `bytes */${totalSize}`);
      return res.status(416).end();
    }

    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    res.setHeader('Content-Length', chunkSize);
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(filePath, { start, end }).pipe(res);
  }

  res.status(200);
  res.setHeader('Content-Length', totalSize);
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(filePath).pipe(res);
}

// ============================================================================
// ZERO-STORAGE LIVE REMOTE STREAM, M3U8 HLS PROXY & UNIVERSAL DOWNLOAD STREAMER
// Compatible with Chrome, Firefox, Edge, Safari, IDM, FDM, JDownloader & aria2
// ============================================================================
export async function proxyRemoteMediaStream(req, res, { asAttachment = false } = {}) {
  const targetUrl = String(req.query.url || '').trim();
  const parsed = await assertSafeOutboundUrl(targetUrl, { performDnsCheck: true });
  const customReferer = String(req.query.referer || '').trim();
  const requestedFilename = String(
    req.query.filename || req.params?.fileHint || ''
  ).trim();

  const upstreamHeaders = {
    'User-Agent': selectOptimalUpstreamUserAgent(parsed.toString()),
    Accept: '*/*',
  };

  if (customReferer && /^https?:\/\//i.test(customReferer) && !parsed.hostname.includes('googlevideo.com')) {
    upstreamHeaders.Referer = customReferer;
  }
  if (req.headers.range) {
    upstreamHeaders.Range = req.headers.range;
  }

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
      upstream = await safeFetchWithRedirects(parsed.toString(), {
        method: 'HEAD',
        headers: upstreamHeaders,
        signal: controller.signal,
      });
      if ([403, 405, 501].includes(upstream.status) || !upstream.headers.get('content-length')) {
        upstream.body?.cancel?.().catch?.(() => {});
        usedRangeProbeForHead = true;
        upstream = await safeFetchWithRedirects(parsed.toString(), {
          method: 'GET',
          headers: { ...upstreamHeaders, Range: 'bytes=0-0' },
          signal: controller.signal,
        });
      }
    } else {
      upstream = await safeFetchWithRedirects(parsed.toString(), {
        method: 'GET',
        headers: upstreamHeaders,
        signal: controller.signal,
      });
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.name === 'AbortError') return;
    throw new AppError(502, 'UPSTREAM_ERROR', `Upstream stream unreachable: ${err.message}`);
  }

  if (asAttachment && upstream.status >= 400) {
    upstream.body?.cancel?.().catch?.(() => {});
    throw new AppError(
      upstream.status === 404 ? 404 : upstream.status === 403 || upstream.status === 401 ? 403 : 502,
      'UPSTREAM_ERROR',
      `Remote media server returned HTTP ${upstream.status}.`
    );
  }

  const upstreamType = upstream.headers.get('content-type') || '';
  const requestedExt = String(requestedFilename || '').split('.').pop().toLowerCase();
  const isGenericType = !upstreamType || /application\/octet-stream|binary\/octet-stream/i.test(upstreamType);

  // Never save an HTML error/consent page as if it were the media file.
  if (asAttachment && /text\/html/i.test(upstreamType) && requestedExt && !/^(html?|php)$/.test(requestedExt)) {
    upstream.body?.cancel?.().catch?.(() => {});
    throw new AppError(
      502,
      'HOST_BLOCKED_DOWNLOAD',
      'The host returned a web page instead of the media file. Try re-extracting the direct video link.'
    );
  }

  const contentType = isGenericType && requestedExt
    ? mimeForExtension(requestedExt)
    : upstreamType || 'video/mp4';

  if (!asAttachment && (contentType.includes('mpegurl') || parsed.pathname.endsWith('.m3u8'))) {
    const manifestText = await upstream.text();
    const baseManifestUrl = upstream.url || parsed.toString();
    const rewritten = manifestText
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        const resolvedSeg = new URL(trimmed, baseManifestUrl).toString();
        return `/api/v1/stream/proxy?url=${encodeURIComponent(resolvedSeg)}`;
      })
      .join('\n');

    res.status(200);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(rewritten);
  }

  res.status(usedRangeProbeForHead ? 200 : upstream.status);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range,Accept-Ranges,Content-Length,Content-Disposition');

  if (asAttachment || requestedFilename) {
    const fallbackExt = mimeForExtension(requestedExt).split('/')[1]?.split(';')[0] || 'mp4';
    applyContentDispositionHeader(
      res,
      requestedFilename ||
        `UltraDownloader_Download.${/^[a-z0-9]{2,5}$/i.test(fallbackExt) ? fallbackExt : 'mp4'}`
    );
  }

  const contentRange = upstream.headers.get('content-range') || '';
  const totalFromRange = contentRange.includes('/') ? contentRange.split('/')[1] : '';
  const contentLength = usedRangeProbeForHead && totalFromRange && totalFromRange !== '*'
    ? totalFromRange
    : upstream.headers.get('content-length');

  if (contentLength) res.setHeader('Content-Length', contentLength);
  if (contentRange && !usedRangeProbeForHead) res.setHeader('Content-Range', contentRange);

  if (req.method === 'HEAD' || !upstream.body) {
    upstream.body?.cancel?.().catch?.(() => {});
    return res.end();
  }

  await pipeline(Readable.fromWeb(upstream.body), res).catch(() => {});
}

// ============================================================================
// INSTANT HTTP 200 / 206 ATTACHMENT STREAM FOR BROWSERS & DOWNLOAD MANAGERS
// ============================================================================
export async function streamDirectDownloadPassThrough(req, res) {
  return proxyRemoteMediaStream(req, res, { asAttachment: true });
}

// ============================================================================
// UNIVERSAL HLS (.m3u8) -> SINGLE PLAYABLE FILE DOWNLOADER (.ts / .mp4)
// Validates every child playlist, key, init map, and segment URL via SSRF guard,
// verifies initial segment fetch + decryption BEFORE sending HTTP 200 headers,
// and never silently returns truncated files on segment/decryption failure.
// ============================================================================
async function fetchTextWithUa(targetUrl, extraHeaders = {}) {
  const res = await safeFetchWithRedirects(targetUrl, {
    headers: {
      'User-Agent': selectOptimalUpstreamUserAgent(targetUrl),
      Accept: '*/*',
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new AppError(502, 'UPSTREAM_ERROR', `Upstream HTTP ${res.status}`);
  return { text: await res.text(), finalUrl: res.url || targetUrl };
}

function parseAttributeList(line) {
  const attrs = {};
  const body = line.slice(line.indexOf(':') + 1);
  body.split(',').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    attrs[pair.slice(0, idx).trim()] = pair
      .slice(idx + 1)
      .trim()
      .replace(/^"|"$/g, '');
  });
  return attrs;
}

function pickHighestBandwidthVariant(manifestText, baseUrl) {
  const lines = manifestText.split(/\r?\n/);
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
    const attrs = parseAttributeList(line);
    const bandwidth = Number(attrs.BANDWIDTH || attrs['AVERAGE-BANDWIDTH'] || 0);
    const nextLine = (lines[i + 1] || '').trim();
    if (!nextLine || nextLine.startsWith('#')) continue;
    if (!best || bandwidth > best.bandwidth) {
      best = { bandwidth, url: new URL(nextLine, baseUrl).toString() };
    }
  }
  return best;
}

export async function streamHlsDownloadAsFile(req, res) {
  return writeHlsAsSingleFile(req, res, {
    url: req.query.url,
    referer: req.query.referer,
    fileName: req.query.filename || req.params?.fileHint,
  });
}

export async function writeHlsAsSingleFile(req, res, { url, referer: rawReferer, fileName: rawName } = {}) {
  const targetUrl = String(url || '').trim();
  const parsedTarget = await assertSafeOutboundUrl(targetUrl, { performDnsCheck: true });
  const referer = String(rawReferer || '').trim();
  const requested =
    String(rawName || 'UltraDownloader_Video.ts')
      .replace(/[^\p{L}\p{N}\s_.-]/gu, '')
      .trim() || 'UltraDownloader_Video.ts';
  const fileName = /\.(ts|mp4)$/i.test(requested) ? requested : `${requested}.ts`;

  const extraHeaders = referer && /^https?:\/\//i.test(referer) ? { Referer: referer } : {};

  // HEAD probe verifies that the playlist exists and resolves cleanly without joining every segment
  if (String(req?.method || 'GET').toUpperCase() === 'HEAD') {
    const peek = await safeFetchWithRedirects(parsedTarget.toString(), {
      headers: {
        'User-Agent': selectOptimalUpstreamUserAgent(parsedTarget.toString()),
        Accept: '*/*',
        ...extraHeaders,
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!peek.ok) {
      peek.body?.cancel?.().catch?.(() => {});
      throw new AppError(
        peek.status === 404 ? 404 : 502,
        'UPSTREAM_ERROR',
        `HLS playlist returned HTTP ${peek.status}.`
      );
    }

    const text = await peek.text();
    let fmp4 = text.includes('#EXT-X-MAP');
    const variant = text.includes('#EXT-X-STREAM-INF')
      ? pickHighestBandwidthVariant(text, peek.url || parsedTarget.toString())
      : null;

    if (variant) {
      const variantRes = await safeFetchWithRedirects(variant.url, {
        headers: {
          'User-Agent': selectOptimalUpstreamUserAgent(variant.url),
          Accept: '*/*',
          ...extraHeaders,
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!variantRes.ok) {
        variantRes.body?.cancel?.().catch?.(() => {});
        throw new AppError(502, 'UPSTREAM_ERROR', `HLS variant returned HTTP ${variantRes.status}.`);
      }
      const vText = await variantRes.text();
      fmp4 = vText.includes('#EXT-X-MAP');
    }

    const outName = fmp4
      ? fileName.replace(/\.(ts|m3u8|mpd)$/i, '.mp4')
      : fileName.replace(/\.(m3u8|mpd)$/i, '.ts');
    res.status(200);
    res.setHeader('Content-Type', fmp4 ? 'video/mp4' : 'video/mp2t');
    res.setHeader('Accept-Ranges', 'none');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    applyContentDispositionHeader(res, outName);
    return res.end();
  }

  const first = await fetchTextWithUa(parsedTarget.toString(), extraHeaders);
  let mediaManifest = first.text;
  let mediaBase = first.finalUrl;

  if (mediaManifest.includes('#EXT-X-STREAM-INF')) {
    const variant = pickHighestBandwidthVariant(mediaManifest, mediaBase);
    if (!variant) throw new AppError(422, 'STREAM_UNAVAILABLE', 'No playable HLS variant found.');
    const variantRes = await fetchTextWithUa(variant.url, extraHeaders);
    mediaManifest = variantRes.text;
    mediaBase = variantRes.finalUrl;
  }

  const lines = mediaManifest.split(/\r?\n/);
  const segments = [];
  let initSegment = '';
  let isFmp4 = false;
  let currentKey = null;
  let mediaSequence = 0;

  const seqMatch = /#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/i.exec(mediaManifest);
  if (seqMatch) mediaSequence = Number(seqMatch[1]) || 0;

  const keyCache = new Map();
  const loadAesKey = async (uri) => {
    if (keyCache.has(uri)) return keyCache.get(uri);
    const keyRes = await safeFetchWithRedirects(uri, {
      headers: { 'User-Agent': selectOptimalUpstreamUserAgent(uri), Accept: '*/*', ...extraHeaders },
      signal: AbortSignal.timeout(10000),
    });
    if (!keyRes.ok) {
      throw new AppError(422, 'STREAM_UNAVAILABLE', 'The HLS encryption key could not be fetched.');
    }
    const buf = Buffer.from(await keyRes.arrayBuffer());
    if (buf.length < 16) {
      throw new AppError(422, 'STREAM_UNAVAILABLE', 'Invalid HLS AES-128 key length.');
    }
    keyCache.set(uri, buf);
    return buf;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-MAP')) {
      const attrs = parseAttributeList(line);
      if (attrs.URI) {
        initSegment = new URL(attrs.URI, mediaBase).toString();
        await assertSafeOutboundUrl(initSegment, { performDnsCheck: false });
        isFmp4 = true;
      }
      continue;
    }
    if (line.startsWith('#EXT-X-KEY')) {
      const attrs = parseAttributeList(line);
      const method = String(attrs.METHOD || '').toUpperCase();
      if (!method || method === 'NONE') {
        currentKey = null;
      } else if (method === 'AES-128') {
        if (!attrs.URI) {
          throw new AppError(422, 'STREAM_UNAVAILABLE', 'HLS playlist missing AES-128 key URI.');
        }
        const keyUrl = new URL(attrs.URI, mediaBase).toString();
        await assertSafeOutboundUrl(keyUrl, { performDnsCheck: false });
        currentKey = {
          method,
          url: keyUrl,
          iv: attrs.IV ? Buffer.from(String(attrs.IV).replace(/^0x/i, '').padStart(32, '0'), 'hex') : null,
        };
      } else {
        throw new AppError(
          422,
          'DRM_PROTECTED',
          'This HLS stream uses sample-level DRM encryption and cannot be downloaded.'
        );
      }
      continue;
    }
    if (line.startsWith('#')) continue;
    const segUrl = new URL(line, mediaBase).toString();
    await assertSafeOutboundUrl(segUrl, { performDnsCheck: false });
    segments.push({
      url: segUrl,
      key: currentKey,
      sequence: mediaSequence + segments.length,
    });
  }

  if (segments.length === 0) {
    throw new AppError(422, 'STREAM_UNAVAILABLE', 'This HLS playlist contains no media segments.');
  }

  const fetchAndDecryptChunk = async (segmentOrUrl) => {
    const chunkUrl = typeof segmentOrUrl === 'string' ? segmentOrUrl : segmentOrUrl.url;
    const key = typeof segmentOrUrl === 'string' ? null : segmentOrUrl.key;

    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const upstream = await safeFetchWithRedirects(chunkUrl, {
          headers: { 'User-Agent': selectOptimalUpstreamUserAgent(chunkUrl), Accept: '*/*', ...extraHeaders },
          signal: AbortSignal.timeout(20000),
        });
        if (!upstream.ok || !upstream.body) {
          upstream.body?.cancel?.().catch?.(() => {});
          throw new AppError(
            502,
            'SEGMENT_FETCH_FAILED',
            `HLS media segment failed with HTTP ${upstream.status}.`
          );
        }
        let buffer = Buffer.from(await upstream.arrayBuffer());
        if (key && key.method === 'AES-128') {
          const keyBytes = await loadAesKey(key.url);
          const iv =
            key.iv && key.iv.length === 16
              ? key.iv
              : (() => {
                  const buf = Buffer.alloc(16);
                  buf.writeUInt32BE(segmentOrUrl.sequence >>> 0, 12);
                  return buf;
                })();
          try {
            const decipher = crypto.createDecipheriv('aes-128-cbc', keyBytes.slice(0, 16), iv);
            buffer = Buffer.concat([decipher.update(buffer), decipher.final()]);
          } catch {
            throw new AppError(422, 'SEGMENT_DECRYPT_FAILED', 'HLS AES-128 segment decryption failed.');
          }
        }
        return buffer;
      } catch (err) {
        lastErr = err;
        if (err instanceof AppError && (err.statusCode === 403 || err.statusCode === 422)) {
          throw err;
        }
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        }
      }
    }
    throw lastErr || new AppError(502, 'SEGMENT_FETCH_FAILED', 'Unable to fetch HLS media segment.');
  };

  // Pre-verify init segment (if present) and the first media segment BEFORE sending HTTP 200!
  // Prevents false HTTP 200 empty/corrupt downloads when segments or keys are unreachable.
  const preloadedInitBuffer = initSegment ? await fetchAndDecryptChunk(initSegment) : null;
  const preloadedFirstSegment = await fetchAndDecryptChunk(segments[0]);

  res.status(200);
  res.setHeader('Content-Type', isFmp4 ? 'video/mp4' : 'video/mp2t');
  res.setHeader('Accept-Ranges', 'none');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  applyContentDispositionHeader(res, isFmp4 ? fileName.replace(/\.ts$/i, '.mp4') : fileName);

  let clientGone = false;
  if (typeof req?.on === 'function') {
    req.on('close', () => {
      if (!res.writableEnded) clientGone = true;
    });
  }

  const writeBufferToResponse = async (buf) => {
    if (clientGone || !buf) return;
    if (!res.write(buf)) {
      await new Promise((resolve) => res.once('drain', resolve));
    }
  };

  try {
    if (preloadedInitBuffer) await writeBufferToResponse(preloadedInitBuffer);
    await writeBufferToResponse(preloadedFirstSegment);

    for (let idx = 1; idx < segments.length; idx++) {
      if (clientGone) break;
      const segBuffer = await fetchAndDecryptChunk(segments[idx]);
      await writeBufferToResponse(segBuffer);
    }
    res.end();
  } catch (err) {
    // Destroy socket if a later segment fails so browser/downloader detects incomplete transfer
    res.destroy(err instanceof Error ? err : new Error('HLS stream interrupted'));
  }
}

// ============================================================================
// PURE NODE.JS LIVE PREVIEW RESOLVER
// ============================================================================
export async function pipeLivePureJsPreview(req, res) {
  const targetUrl = String(req.query.url || '').trim();
  await assertSafeOutboundUrl(targetUrl, { performDnsCheck: true });

  const { analyzeMediaUrl } = await import('./extractorEngine.js');
  const analysis = await analyzeMediaUrl({ rawUrl: targetUrl });
  const directPreview =
    analysis?.media?.previewPlayer?.streamUrl ||
    analysis?.streams?.videoAudio?.[0]?.streamUrl ||
    '';

  if (!directPreview || directPreview.includes('/stream/live-pipe')) {
    throw new AppError(422, 'STREAM_UNAVAILABLE', 'Unable to resolve preview stream.');
  }

  return res.redirect(302, directPreview);
}

// ============================================================================
// REAL SUBTITLE STREAM FETCHER (.VTT / .SRT)
// ============================================================================
export async function proxySubtitleDownload(req, res) {
  const targetUrl = String(req.query.url || '').trim();
  const lang = String(req.query.lang || 'en').replace(/[^a-zA-Z0-9_-]/g, '');
  const parsed = await assertSafeOutboundUrl(targetUrl, { performDnsCheck: true });

  const upstream = await safeFetchWithRedirects(parsed.toString(), {
    headers: { 'User-Agent': selectOptimalUpstreamUserAgent(parsed.toString()) },
    signal: AbortSignal.timeout(10000),
  });
  if (!upstream.ok) {
    throw new AppError(502, 'UPSTREAM_ERROR', 'Unable to fetch subtitle track from source.');
  }
  const text = await upstream.text();
  res.status(200);
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="subtitles.${lang}.vtt"`);
  res.send(text);
}

// ============================================================================
// HLS PLAYBACK PROXY  (same-origin playlist rewrite + SSRF-guarded segments)
// ============================================================================
function rewritePlaylist(text, baseUrl, referer) {
  const ref = referer ? `&ref=${encodeURIComponent(referer)}` : '';
  const segmentUrl = (raw) =>
    `/api/v1/stream/hls-play/seg?url=${encodeURIComponent(new URL(raw, baseUrl).toString())}${ref}`;

  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#EXT-X-KEY') || trimmed.startsWith('#EXT-X-MAP')) {
        return trimmed.replace(/URI="([^"]+)"/, (_m, uri) => `URI="${segmentUrl(uri)}"`);
      }
      if (trimmed.startsWith('#EXT-X-MEDIA') && /URI="([^"]+)"/.test(trimmed)) {
        return trimmed.replace(/URI="([^"]+)"/, (_m, uri) => `URI="${segmentUrl(uri)}"`);
      }
      if (trimmed.startsWith('#')) return line;
      return segmentUrl(trimmed);
    })
    .join('\n');
}

export async function proxyHlsPlayback(req, res) {
  const targetUrl = String(req.query.url || '').trim();
  const referer = String(req.query.ref || '').trim();
  const parsedTarget = await assertSafeOutboundUrl(targetUrl, { performDnsCheck: true });

  const extraHeaders = referer && /^https?:\/\//i.test(referer) ? { Referer: referer } : {};
  const upstream = await safeFetchWithRedirects(parsedTarget.toString(), {
    headers: {
      'User-Agent': selectOptimalUpstreamUserAgent(parsedTarget.toString()),
      Accept: '*/*',
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!upstream.ok) {
    res.status(502).json({ success: false, error: { code: 'UPSTREAM_ERROR', message: `Upstream HTTP ${upstream.status}` } });
    return;
  }

  const body = await upstream.text();
  const finalUrl = upstream.url || parsedTarget.toString();

  res.status(200);
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.send(rewritePlaylist(body, finalUrl, referer));
}

export async function proxyHlsSubResource(req, res) {
  const targetUrl = String(req.query.url || '').trim();
  const referer = String(req.query.ref || '').trim();
  const parsedTarget = await assertSafeOutboundUrl(targetUrl, { performDnsCheck: true });

  const extraHeaders = referer && /^https?:\/\//i.test(referer) ? { Referer: referer } : {};
  const controller = new AbortController();
  if (typeof req.on === 'function') {
    req.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
  }

  const upstream = await safeFetchWithRedirects(parsedTarget.toString(), {
    headers: {
      'User-Agent': selectOptimalUpstreamUserAgent(parsedTarget.toString()),
      Accept: '*/*',
      ...extraHeaders,
    },
    signal: controller.signal,
  });

  if (!upstream.ok || !upstream.body) {
    res.status(502).end();
    return;
  }

  const upstreamType = String(upstream.headers.get('content-type') || '').toLowerCase();
  const looksPlaylist =
    /mpegurl|x-mpegURL/i.test(upstreamType) || /\.m3u8/i.test(parsedTarget.pathname);

  if (looksPlaylist) {
    const text = await upstream.text();
    res.status(200);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.send(rewritePlaylist(text, upstream.url || parsedTarget.toString(), referer));
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', upstreamType || 'application/octet-stream');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  Readable.fromWeb(upstream.body).on('error', () => res.end()).pipe(res);
}

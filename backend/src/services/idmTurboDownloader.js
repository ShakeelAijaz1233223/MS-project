import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import {
  assertSafeOutboundUrl,
  createPinnedDnsLookup,
} from '../security/antiSsrfGuard.js';
import { extensionOfFileName, hasAllowedExtension } from '../data/mediaFormats.js';
import { recordRxBytes, runtimeEnginePreferences } from './trafficEngine.js';

export const CHROME_DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export const YT_IOS_UA =
  'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)';
export const YT_ANDROID_UA =
  'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip';

// Automatically select the exact upstream User-Agent required by CDN signed URLs
export function selectOptimalUpstreamUserAgent(targetUrl = '') {
  const s = String(targetUrl || '');
  if (s.includes('googlevideo.com')) {
    if (/[?&]c=IOS(&|$)/i.test(s)) return YT_IOS_UA;
    if (/[?&]c=ANDROID(&|$)/i.test(s)) return YT_ANDROID_UA;
  }
  return CHROME_DESKTOP_UA;
}

// ============================================================================
// HIGH-THROUGHPUT KEEP-ALIVE TCP/TLS AGENT POOL (64 CONCURRENT SOCKETS)
// ============================================================================
const fastHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 32,
  timeout: 45000,
});

const fastHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 32,
  timeout: 45000,
});

async function openRawRangeStream(targetUrl, extraHeaders = {}, abortSignal, redirectsLeft = 5) {
  if (abortSignal?.aborted) {
    throw new Error('Download paused or cancelled');
  }
  if (redirectsLeft < 0) {
    throw new Error('Too many HTTP redirects on media stream');
  }

  // Validate target URL + resolve & pin public IP on EVERY hop (prevents SSRF & DNS rebinding)
  const parsed = await assertSafeOutboundUrl(targetUrl, { performDnsCheck: true });
  const isFixture = process.env.NODE_ENV === 'test' && Boolean(parsed.fixturePort);
  const requestTarget = isFixture
    ? new URL(`http://127.0.0.1:${parsed.fixturePort}${parsed.pathname}${parsed.search}`)
    : parsed;
  const isHttps = !isFixture && parsed.protocol === 'https:';
  const transport = isHttps ? https : http;
  const pinnedLookup =
    !isFixture && parsed.verifiedAddress
      ? createPinnedDnsLookup(parsed.verifiedAddress, parsed.verifiedFamily)
      : undefined;

  return new Promise((resolve, reject) => {
    const req = transport.get(
      requestTarget,
      {
        agent: isHttps ? fastHttpsAgent : fastHttpAgent,
        ...(pinnedLookup ? { lookup: pinnedLookup } : {}),
        headers: {
          'User-Agent': selectOptimalUpstreamUserAgent(parsed.toString()),
          Accept: '*/*',
          Connection: 'keep-alive',
          ...(isFixture ? { Host: parsed.host } : {}),
          ...extraHeaders,
        },
        highWaterMark: 2 * 1024 * 1024,
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const nextUrl = new URL(res.headers.location, parsed.toString()).toString();
          res.resume();
          openRawRangeStream(nextUrl, extraHeaders, abortSignal, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        resolve({ req, res, finalUrl: parsed.toString() });
      }
    );

    const onAbort = () => {
      req.destroy(new Error('Aborted'));
    };
    if (abortSignal) {
      abortSignal.addEventListener('abort', onAbort, { once: true });
      req.on('close', () => abortSignal.removeEventListener('abort', onAbort));
    }
    req.on('error', reject);
  });
}

function createPerFileSpeedPacer() {
  let windowStart = Date.now();
  let bytesInWindow = 0;

  return async function paceBytesIfLimited(chunkBytes) {
    if (!runtimeEnginePreferences.speedLimiterEnabled) return;
    const maxBytesPerSec = Math.max(
      10 * 1024,
      Number(runtimeEnginePreferences.maxSpeedKBps || 500) * 1024
    );
    const now = Date.now();
    const elapsedMs = now - windowStart;
    if (elapsedMs >= 1000) {
      windowStart = now;
      bytesInWindow = chunkBytes;
      return;
    }
    bytesInWindow += chunkBytes;
    const expectedMs = Math.round((bytesInWindow / maxBytesPerSec) * 1000);
    if (expectedMs > elapsedMs + 15) {
      await new Promise((r) => setTimeout(r, Math.min(600, expectedMs - elapsedMs)));
    }
  };
}

// ============================================================================
// 1. PARALLEL HTTP BYTE-RANGE DOWNLOADER (FOR ADMIN VAULT & SERVER ARCHIVE)
// ============================================================================
export async function downloadParallelIdmRangeStream({
  url,
  destPath,
  referer = '',
  abortSignal,
  threads = runtimeEnginePreferences.idmConnections || 32,
  onProgress,
}) {
  const baseHeaders = referer && !String(url).includes('googlevideo.com') ? { Referer: referer } : {};
  const { req: probeReq, res: probeRes, finalUrl } = await openRawRangeStream(
    url,
    { ...baseHeaders, Range: 'bytes=0-0' },
    abortSignal
  );

  if (probeRes.statusCode !== 200 && probeRes.statusCode !== 206) {
    probeRes.resume();
    probeReq.destroy();
    throw new Error(`Upstream HTTP ${probeRes.statusCode}`);
  }

  const contentRange = String(probeRes.headers['content-range'] || '');
  const totalFromRange = contentRange.includes('/') ? Number(contentRange.split('/')[1]) : 0;
  const totalBytes = totalFromRange || Number(probeRes.headers['content-length'] || 0);
  const supportsRanges = probeRes.statusCode === 206 && totalBytes > 512 * 1024;
  probeRes.destroy();
  probeReq.destroy();

  const startedAt = Date.now();
  let downloadedBytes = 0;
  let lastTick = 0;
  let recentWindowTime = startedAt;
  let recentWindowBytes = 0;
  let smoothSpeedBps = 0;
  const paceBytes = createPerFileSpeedPacer();
  const slabSize = Math.max(1, Number(runtimeEnginePreferences.writeBufferMb || 4)) * 1024 * 1024;

  const reportProgress = (forceTotal = totalBytes, activeThreadsCount = 1) => {
    const now = Date.now();
    if (now - lastTick < 150) return;
    lastTick = now;
    const dt = Math.max(0.08, (now - recentWindowTime) / 1000);
    const instantBps = (downloadedBytes - recentWindowBytes) / dt;
    smoothSpeedBps =
      smoothSpeedBps > 0
        ? Math.round(smoothSpeedBps * 0.45 + instantBps * 0.55)
        : Math.round(instantBps);
    if (now - recentWindowTime >= 750) {
      recentWindowTime = now;
      recentWindowBytes = downloadedBytes;
    }
    const denom = forceTotal || downloadedBytes || 1;
    const pct = forceTotal > 0 ? Math.min(99, Math.round((downloadedBytes / denom) * 100)) : 65;
    const eta =
      forceTotal > 0 && smoothSpeedBps > 0
        ? Math.max(0, Math.round((forceTotal - downloadedBytes) / smoothSpeedBps))
        : 0;
    onProgress?.({
      pct,
      downloadedBytes,
      totalBytes: denom,
      speedBps: Math.max(0, smoothSpeedBps),
      etaSeconds: eta,
      activeThreads: activeThreadsCount,
    });
  };

  if (!supportsRanges) {
    const fileHandle = await fs.open(destPath, 'w');
    const { res: streamRes } = await openRawRangeStream(finalUrl, baseHeaders, abortSignal);
    const slab = Buffer.allocUnsafe(slabSize);
    let filled = 0;
    let filePos = 0;
    try {
      for await (const chunk of streamRes) {
        await paceBytes(chunk.length);
        recordRxBytes(chunk.length);
        downloadedBytes += chunk.length;
        if (filled + chunk.length > slab.length) {
          if (filled > 0) {
            await fileHandle.write(slab, 0, filled, filePos);
            filePos += filled;
            filled = 0;
          }
          if (chunk.length >= slab.length) {
            await fileHandle.write(chunk, 0, chunk.length, filePos);
            filePos += chunk.length;
          } else {
            chunk.copy(slab, 0);
            filled = chunk.length;
          }
        } else {
          chunk.copy(slab, filled);
          filled += chunk.length;
        }
        reportProgress(totalBytes, 1);
      }
      if (filled > 0) {
        await fileHandle.write(slab, 0, filled, filePos);
      }
    } finally {
      await fileHandle.close();
    }
    return downloadedBytes;
  }

  const numParts = Math.min(Math.max(1, Number(threads) || 32), Math.ceil(totalBytes / (512 * 1024)));
  const partSize = Math.ceil(totalBytes / numParts);
  const ranges = [];
  for (let i = 0; i < numParts; i++) {
    const start = i * partSize;
    if (start >= totalBytes) break;
    const end = Math.min(totalBytes - 1, start + partSize - 1);
    ranges.push({ index: i, start, end });
  }

  const fileHandle = await fs.open(destPath, 'w');
  try {
    await Promise.all(
      ranges.map(async (part) => {
        let writeCursor = part.start;
        let attempt = 0;
        const slab = Buffer.allocUnsafe(Math.min(slabSize, part.end - part.start + 1));

        while (writeCursor <= part.end) {
          if (abortSignal?.aborted) throw new Error('Download paused or cancelled');
          let filled = 0;
          let slabStartOffset = writeCursor;

          try {
            const { res: partRes } = await openRawRangeStream(
              finalUrl,
              {
                ...baseHeaders,
                Range: `bytes=${writeCursor}-${part.end}`,
              },
              abortSignal
            );
            if (partRes.statusCode !== 206 && partRes.statusCode !== 200) {
              partRes.resume();
              throw new Error(`Range HTTP ${partRes.statusCode}`);
            }

            for await (const rawChunk of partRes) {
              const remaining = part.end - (slabStartOffset + filled) + 1;
              if (remaining <= 0) break;
              const sliceLen = Math.min(rawChunk.length, remaining);

              await paceBytes(sliceLen);
              recordRxBytes(sliceLen);
              downloadedBytes += sliceLen;

              if (filled + sliceLen > slab.length) {
                if (filled > 0) {
                  await fileHandle.write(slab, 0, filled, slabStartOffset);
                  writeCursor = slabStartOffset + filled;
                  slabStartOffset = writeCursor;
                  filled = 0;
                }
                if (sliceLen >= slab.length) {
                  await fileHandle.write(rawChunk, 0, sliceLen, slabStartOffset);
                  writeCursor = slabStartOffset + sliceLen;
                  slabStartOffset = writeCursor;
                } else {
                  rawChunk.copy(slab, 0, 0, sliceLen);
                  filled = sliceLen;
                }
              } else {
                rawChunk.copy(slab, filled, 0, sliceLen);
                filled += sliceLen;
              }

              reportProgress(totalBytes, ranges.length);
            }

            if (filled > 0) {
              await fileHandle.write(slab, 0, filled, slabStartOffset);
              writeCursor = slabStartOffset + filled;
              filled = 0;
            }
            break;
          } catch (err) {
            if (filled > 0) {
              await fileHandle.write(slab, 0, filled, slabStartOffset).catch(() => {});
              writeCursor = slabStartOffset + filled;
            }
            if (abortSignal?.aborted) throw err;
            attempt += 1;
            if (attempt >= 6) throw err;
            await new Promise((r) => setTimeout(r, 250 * attempt));
          }
        }
      })
    );
  } finally {
    await fileHandle.close();
  }

  return totalBytes;
}

// ============================================================================
// 2. UNIVERSAL BROWSER & EXTERNAL DOWNLOAD MANAGER COMPATIBILITY
// Downloads are standard HTTP 200/206 attachment streams with Content-Length,
// Accept-Ranges: bytes, and RFC-5987 Content-Disposition headers so Chrome,
// Edge, Firefox, Safari, IDM (installed on visitor's PC), FDM, JDownloader,
// EagleGet, ADM, and aria2 all work natively without server-side .exe spawns.
// ============================================================================
export function findLocalWindowsIdmBinary() {
  return null;
}

export function getWindowsIdmStatus() {
  return {
    mode: 'standard_http_attachment',
    detected: false,
    binaryPath: null,
    idmBrowserIntegrationCompatible: true,
    supportsExternalDownloadManagers: true,
    supportsRangeResume: true,
    supportsEf2Export: true,
    threadsConfigured: runtimeEnginePreferences.idmConnections,
    speedLimiterEnabled: runtimeEnginePreferences.speedLimiterEnabled,
    maxSpeedKBps: runtimeEnginePreferences.maxSpeedKBps,
  };
}

export function triggerLocalWindowsIdmDownload(directDownloadUrl, fileName) {
  const cleanPath = String(directDownloadUrl || '').split('?')[0];
  const extension = extensionOfFileName(fileName) || extensionOfFileName(cleanPath);
  const extensionSupported = Boolean(extension) && hasAllowedExtension(fileName || cleanPath);

  return {
    launched: false,
    launchedDesktopIdm: false,
    idmBinaryPath: null,
    fallbackMode: 'browser_attachment_compatible',
    idmInstalled: false,
    supportsExternalDownloadManagers: true,
    extension,
    extensionSupported,
    routingReason: 'standard_browser_and_external_downloader_http_stream',
  };
}

export function buildIdmEf2FileContent({
  directUrl,
  downloadUrl,
  refererUrl = '',
  referer = '',
  userAgent = '',
}) {
  const url = directUrl || downloadUrl;
  const ref = refererUrl || referer;
  const effectiveUa = userAgent || selectOptimalUpstreamUserAgent(url);
  return ['<', url, ref ? `referer: ${ref}` : '', `User-Agent: ${effectiveUa}`, '>', '']
    .filter(Boolean)
    .join('\r\n');
}

export const generateIdmEf2Content = buildIdmEf2FileContent;

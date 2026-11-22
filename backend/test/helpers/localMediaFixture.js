import http from 'node:http';
import { registerTestFixtureServer } from '../../src/security/antiSsrfGuard.js';

function buildSyntheticMp4Buffer(totalSize = 32768) {
  const buf = Buffer.alloc(totalSize, 0x11);
  // Box 1: 24-byte `ftypisom` header (`subarray(4, 8) === 'ftyp'`)
  buf.writeUInt32BE(24, 0);
  buf.write('ftyp', 4, 4, 'ascii');
  buf.write('isom', 8, 4, 'ascii');
  buf.writeUInt32BE(0x200, 12);
  buf.write('isom', 16, 4, 'ascii');
  buf.write('mp41', 20, 4, 'ascii');
  // Box 2: `mdat` payload box
  const mdatSize = totalSize - 24;
  buf.writeUInt32BE(mdatSize, 24);
  buf.write('mdat', 28, 4, 'ascii');
  return buf;
}

function buildSyntheticMpegTsBuffer(packetCount = 100) {
  const packetSize = 188;
  const buf = Buffer.alloc(packetCount * packetSize, 0xff);
  for (let i = 0; i < packetCount; i++) {
    const offset = i * packetSize;
    buf[offset] = 0x47; // MPEG-TS sync byte
    buf[offset + 1] = 0x40;
    buf[offset + 2] = 0x11;
    buf[offset + 3] = 0x10 | (i & 0x0f);
  }
  return buf;
}

const MP4_BYTES = buildSyntheticMp4Buffer(32768);
const TS_BYTES = buildSyntheticMpegTsBuffer(100); // 18,800 bytes

function serveBinaryWithRange(req, res, payload, contentType, { rejectHead = false, queryRange = '' } = {}) {
  if (req.method === 'HEAD' && rejectHead) {
    res.writeHead(405, { 'Content-Type': 'text/plain', Allow: 'GET' });
    res.end();
    return;
  }

  const total = payload.length;
  const rangeHeader = String(req.headers.range || (queryRange ? `bytes=${queryRange}` : ''));
  if (rangeHeader.startsWith('bytes=')) {
    const [rawStart, rawEnd] = rangeHeader.replace(/^bytes=/, '').split('-');
    const start = Math.max(0, Number.parseInt(rawStart, 10) || 0);
    const end = rawEnd ? Math.min(total - 1, Number.parseInt(rawEnd, 10)) : total - 1;
    if (start >= total || end < start) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    const slice = payload.subarray(start, end + 1);
    const status = req.headers.range ? 206 : 200;
    res.writeHead(status, {
      'Content-Type': contentType,
      'Content-Length': String(slice.length),
      ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}),
      'Accept-Ranges': 'bytes',
    });
    res.end(req.method === 'HEAD' ? undefined : slice);
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': String(total),
    'Accept-Ranges': 'bytes',
  });
  res.end(req.method === 'HEAD' ? undefined : payload);
}

export async function startLocalMediaFixtureServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://cdn.fixture.example');
    const pathname = u.pathname;

    if (pathname.startsWith('/media/missing-404')) {
      const html = '<!doctype html><html><body><h1>404 Media Not Found</h1></body></html>';
      res.writeHead(404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': String(Buffer.byteLength(html)),
      });
      res.end(req.method === 'HEAD' ? undefined : html);
      return;
    }

    if (pathname === '/media/head-405.mp4') {
      serveBinaryWithRange(req, res, MP4_BYTES, 'video/mp4', { rejectHead: true });
      return;
    }

    if (pathname.startsWith('/media/') && pathname.endsWith('.mp4')) {
      serveBinaryWithRange(req, res, MP4_BYTES, 'video/mp4');
      return;
    }

    if (pathname.startsWith('/media/') && pathname.endsWith('.mp3')) {
      serveBinaryWithRange(req, res, MP4_BYTES.subarray(0, 8192), 'audio/mpeg');
      return;
    }

    if (pathname === '/media/terabox-vod.ts' || pathname === '/hls/seg0.ts' || pathname === '/hls/seg1.ts') {
      serveBinaryWithRange(req, res, TS_BYTES, 'video/mp2t', {
        queryRange: u.searchParams.get('range') || '',
      });
      return;
    }

    if (pathname === '/hls/master.m3u8') {
      const m3u8 = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720',
        'https://cdn.fixture.example/hls/prog.m3u8',
      ].join('\n');
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end(m3u8);
      return;
    }

    if (pathname === '/hls/prog.m3u8') {
      const m3u8 = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:6',
        '#EXTINF:5.0,',
        'https://cdn.fixture.example/hls/seg0.ts',
        '#EXTINF:5.0,',
        'https://cdn.fixture.example/hls/seg1.ts',
        '#EXT-X-ENDLIST',
      ].join('\n');
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end(m3u8);
      return;
    }

    if (pathname === '/hls/encrypted-prog.m3u8') {
      const m3u8 = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:6',
        '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.fixture.example/hls/enc.key"',
        '#EXTINF:5.0,',
        'https://cdn.fixture.example/hls/seg0.ts',
        '#EXT-X-ENDLIST',
      ].join('\n');
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end(m3u8);
      return;
    }

    if (pathname === '/hls/enc.key') {
      const key = Buffer.alloc(16, 0x22);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': '16' });
      res.end(key);
      return;
    }

    if (pathname === '/hls/broken.m3u8') {
      const m3u8 = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:6',
        '#EXTINF:5.0,',
        'https://cdn.fixture.example/hls/missing-seg.ts',
        '#EXT-X-ENDLIST',
      ].join('\n');
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end(m3u8);
      return;
    }

    if (pathname === '/ssrf-redirect') {
      res.writeHead(302, { Location: 'http://127.0.0.1:4000/api/v1/health' });
      res.end();
      return;
    }

    if (pathname === '/watch/html5-demo') {
      const html = `<!doctype html><html><head>
        <title>Big Buck Bunny Open Clip</title>
        <meta property="og:title" content="Big Buck Bunny Open Clip" />
        <meta property="og:image" content="https://cdn.fixture.example/thumb.jpg" />
      </head><body>
        <video src="https://cdn.fixture.example/media/flower.mp4" controls></video>
      </body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (pathname === '/empty' || pathname === '/') {
      const html = '<!doctype html><html><head><title>Example Domain</title></head><body><p>No media here.</p></body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // Deterministic upstream platform endpoints for offline CI / sandbox runs
    if (pathname.startsWith('/mock/youtubei')) {
      const payload = {
        playabilityStatus: { status: 'OK' },
        videoDetails: {
          videoId: 'WhWc3b3KhnY',
          title: 'Spring - Blender Open Movie',
          author: 'Blender Studio',
          lengthSeconds: '464',
          viewCount: '9200000',
          thumbnail: { thumbnails: [{ url: 'https://cdn.fixture.example/thumb.jpg' }] },
        },
        streamingData: {
          formats: [
            {
              itag: 18,
              url: 'https://cdn.fixture.example/media/yt-360p.mp4',
              mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
              width: 640,
              height: 360,
              qualityLabel: '360p',
              contentLength: String(MP4_BYTES.length),
              audioQuality: 'AUDIO_QUALITY_LOW',
            },
            {
              itag: 22,
              url: 'https://cdn.fixture.example/media/yt-720p.mp4',
              mimeType: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
              width: 1280,
              height: 720,
              qualityLabel: '720p',
              contentLength: String(MP4_BYTES.length),
              audioQuality: 'AUDIO_QUALITY_MEDIUM',
            },
          ],
          adaptiveFormats: [
            {
              itag: 137,
              url: 'https://cdn.fixture.example/media/yt-1080p.mp4',
              mimeType: 'video/mp4; codecs="avc1.640028"',
              width: 1920,
              height: 1080,
              qualityLabel: '1080p',
              contentLength: String(MP4_BYTES.length),
            },
            {
              itag: 313,
              url: 'https://cdn.fixture.example/media/yt-2160p.mp4',
              mimeType: 'video/mp4; codecs="vp9"',
              width: 3840,
              height: 2160,
              qualityLabel: '2160p',
              contentLength: String(MP4_BYTES.length),
            },
            {
              itag: 140,
              url: 'https://cdn.fixture.example/media/yt-audio.mp3',
              mimeType: 'audio/mp4; codecs="mp4a.40.2"',
              bitrate: 128000,
              contentLength: '8192',
              audioQuality: 'AUDIO_QUALITY_MEDIUM',
            },
          ],
        },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }

    if (pathname.startsWith('/mock/yt-search')) {
      const ytInitialData = {
        contents: {
          twoColumnSearchResultsRenderer: {
            primaryContents: {
              sectionListRenderer: {
                contents: [
                  {
                    itemSectionRenderer: {
                      contents: [
                        {
                          videoRenderer: {
                            videoId: 'WhWc3b3KhnY',
                            title: { runs: [{ text: 'Spring - Blender Open Movie 4K' }] },
                            lengthText: { simpleText: '7:44' },
                            ownerText: { runs: [{ text: 'Blender Studio' }] },
                            viewCountText: { simpleText: '9,200,000 views' },
                            publishedTimeText: { simpleText: '2 years ago' },
                            thumbnail: { thumbnails: [{ url: 'https://cdn.fixture.example/thumb.jpg' }] },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      };
      const html = `<!doctype html><html><body><script>var ytInitialData = ${JSON.stringify(ytInitialData)};</script></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (pathname.startsWith('/mock/dailymotion')) {
      const dm = {
        id: 'x8jz2mv',
        title: 'Dailymotion HD Sample Clip',
        duration: 95,
        thumbnail_url: 'https://cdn.fixture.example/thumb.jpg',
        qualities: {
          auto: [
            { type: 'video/mp4', quality: '720p', url: 'https://cdn.fixture.example/media/dm-720p.mp4' },
            { type: 'video/mp4', quality: '480p', url: 'https://cdn.fixture.example/media/dm-480p.mp4' },
          ],
        },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dm));
      return;
    }

    if (pathname.startsWith('/mock/facebook')) {
      const filler = '<!-- facebook plugin fixture payload '.repeat(65) + ' -->';
      const html = `<!doctype html><html><head><title>Facebook Reel Sample</title><meta property="og:title" content="Facebook Reel Sample" /></head><body>
        ${filler}
        <script>{"video_id":"987654321012345","hd_src_no_ratelimit":"https:\\/\\/cdn.fixture.example\\/media\\/fb-hd.mp4","sd_src_no_ratelimit":"https:\\/\\/cdn.fixture.example\\/media\\/fb-sd.mp4"}</script>
      </body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (pathname === '/mock/terabox/page') {
      const html = `<!doctype html><html><head><meta property="og:image" content="https://cdn.fixture.example/thumb.jpg" /></head><body>
        <script>window.jsToken = "ABCDEF1234567890"; var cfg = {"jsToken":"ABCDEF1234567890"};</script>
      </body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (pathname === '/mock/terabox/shorturlinfo') {
      const tb = {
        errno: 0,
        uk: 123456,
        shareid: 789012,
        sign: 'sig_fixture_v10',
        timestamp: 1700000000,
        list: [
          {
            fs_id: '1092837465',
            isdir: '0',
            server_filename: 'Sample_Cloud_Clip_1080p.mp4',
            size: TS_BYTES.length,
            thumbs: { url3: 'https://cdn.fixture.example/thumb.jpg' },
          },
        ],
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tb));
      return;
    }

    if (pathname === '/mock/terabox/streaming') {
      const m3u8 = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXTINF:60.0,',
        `https://cdn.fixture.example/media/terabox-vod.ts?chunk=_0_ts/seg&ts_size=${TS_BYTES.length}&len=${TS_BYTES.length}&range=0-${TS_BYTES.length - 1}`,
        '#EXT-X-ENDLIST',
      ].join('\n');
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end(m3u8);
      return;
    }

    if (pathname.startsWith('/mock/vimeo')) {
      const vm = {
        video: {
          id: 76979871,
          title: 'The New Vimeo Player',
          duration: 62,
          owner: { name: 'Vimeo Staff' },
          thumbs: { base: 'https://cdn.fixture.example/thumb.jpg' },
        },
        request: {
          files: {
            progressive: [
              {
                quality: '720p',
                width: 1280,
                height: 720,
                mime: 'video/mp4',
                url: 'https://cdn.fixture.example/media/vimeo-720p.mp4',
              },
            ],
          },
        },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(vm));
      return;
    }

    if (pathname.startsWith('/mock/peertube')) {
      const pt = {
        uuid: '9c9de5e8-0a1e-484a-b099-e80766180a6d',
        name: 'Framatube Open Source Clip',
        duration: 48,
        previewPath: '/lazy-static/previews/thumb.jpg',
        account: { displayName: 'Framasoft' },
        files: [
          {
            resolution: { id: 720, label: '720p' },
            size: MP4_BYTES.length,
            fileDownloadUrl: 'https://cdn.fixture.example/media/peertube-720p.mp4',
          },
        ],
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(pt));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Fixture route not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  registerTestFixtureServer(port);

  const realFetch = globalThis.fetch;
  const mockExternal = process.env.LIVE_NETWORK_TESTS !== '1';

  const wrappedFetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input?.url || String(input);
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return realFetch(input, init);
    }

    const host = parsed.hostname.toLowerCase();
    const base = `http://127.0.0.1:${port}`;

    // 1. Always route `*.fixture.example` to our local HTTP fixture server
    if (host === 'fixture.example' || host.endsWith('.fixture.example')) {
      return realFetch(`${base}${parsed.pathname}${parsed.search}`, init);
    }

    // 2. When LIVE_NETWORK_TESTS !== '1', deterministically serve external extractor fixtures locally
    if (mockExternal) {
      if (host.includes('youtube.com') && parsed.pathname.includes('/youtubei/v1/player')) {
        return realFetch(`${base}/mock/youtubei`, { method: 'GET' });
      }
      if (host.includes('youtube.com') && parsed.pathname.includes('/results')) {
        return realFetch(`${base}/mock/yt-search${parsed.search}`, { method: 'GET' });
      }
      if (host.includes('dailymotion.com') && parsed.pathname.includes('/player/metadata/video/')) {
        return realFetch(`${base}/mock/dailymotion`, { method: 'GET' });
      }
      if (host.includes('dailymotion.com') || host === 'dai.ly') {
        return realFetch(`${base}/watch/html5-demo`, { method: 'GET' });
      }
      if (host.includes('facebook.com') || host === 'fb.watch') {
        return realFetch(`${base}/mock/facebook`, { method: 'GET' });
      }
      if (
        host.includes('iteraplay.com') ||
        host.includes('terabox') ||
        host.includes('1024tera') ||
        host.includes('nephobox') ||
        host.includes('mirrobox')
      ) {
        if (parsed.pathname.includes('/api/shorturlinfo')) {
          return realFetch(`${base}/mock/terabox/shorturlinfo`, { method: 'GET' });
        }
        if (parsed.pathname.includes('/share/streaming')) {
          return realFetch(`${base}/mock/terabox/streaming`, { method: 'GET' });
        }
        return realFetch(`${base}/mock/terabox/page`, { method: 'GET' });
      }
      if (host === 'player.vimeo.com') {
        return realFetch(`${base}/mock/vimeo`, { method: 'GET' });
      }
      if (host.includes('vimeo.com')) {
        return realFetch(`${base}/watch/html5-demo`, { method: 'GET' });
      }
      if (host === 'a-v2.sndcdn.com') {
        return realFetch(`${base}/mock/sc-js`, { method: 'GET' });
      }
      if (host === 'api-v2.soundcloud.com') {
        return realFetch(`${base}/mock/sc-stream`, { method: 'GET' });
      }
      if (host.includes('soundcloud.com')) {
        return realFetch(`${base}/mock/sc-page`, { method: 'GET' });
      }
      if (host.includes('framatube.org') && parsed.pathname.includes('/api/v1/videos/')) {
        if (parsed.pathname.endsWith('/captions')) {
          return new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return realFetch(`${base}/mock/peertube`, { method: 'GET' });
      }
      if (host.includes('wikipedia.org')) {
        return realFetch(`${base}/watch/html5-demo`, { method: 'GET' });
      }
      if (host === 'example.com' || host === 'www.example.com') {
        return realFetch(`${base}/empty`, { method: 'GET' });
      }
      if (
        host.includes('interactive-examples.mdn.mozilla.net') ||
        host.includes('commondatastorage.googleapis.com')
      ) {
        return realFetch(`${base}/media/flower.mp4`, init);
      }
    }

    return realFetch(input, init);
  };

  globalThis.fetch = wrappedFetch;

  return {
    port,
    mp4Size: MP4_BYTES.length,
    tsSize: TS_BYTES.length,
    async close() {
      globalThis.fetch = realFetch;
      registerTestFixtureServer(0);
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

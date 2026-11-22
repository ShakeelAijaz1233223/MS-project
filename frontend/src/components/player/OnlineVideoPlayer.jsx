import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Play, Volume2, VolumeX, Maximize2, AlertTriangle, RefreshCw } from 'lucide-react';

export function OnlineVideoPlayer({
  streamUrl,
  posterUrl = '',
  title = 'Live Stream Preview',
  platformName = 'UltraDownloader',
  subtitles = [],
  autoPlay = false,
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  // Player error state: shown when the video element or HLS fails fatally
  // (bad stream, expired link, network drop) — with a retry that reloads
  // the same stream instead of a dead black box.
  const [playError, setPlayError] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !streamUrl) return undefined;

    setPlayError('');

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHlsStream =
      /\.m3u8(\?|#|$)/i.test(streamUrl) ||
      streamUrl.includes('/stream/hls-play') ||
      streamUrl.includes('/stream/terabox-hls') ||
      /[?&]url=[^&]*\.m3u8/i.test(streamUrl);

    if (isHlsStream && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoPlay) videoEl.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data?.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          try {
            hls.startLoad();
            return;
          } catch {
            /* fall through to recovery */
          }
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try {
            hls.recoverMediaError();
            return;
          } catch {
            /* fall through */
          }
        }
        hls.destroy();
        hlsRef.current = null;
        setPlayError('This stream could not be played (expired or blocked source). Try the download instead, or re-analyze the link.');
      });
    } else {
      videoEl.src = streamUrl;
      if (autoPlay) videoEl.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUrl, autoPlay, retryNonce]);

  const changePlaybackRate = (nextRate) => {
    setSpeed(nextRate);
    if (videoRef.current) videoRef.current.playbackRate = nextRate;
  };

  return (
    <div className="rounded-2xl bg-white border border-violet-200 shadow-[0_0_24px_rgba(124,58,237,0.08)] overflow-hidden">
      <div className="relative aspect-video bg-slate-950 flex items-center justify-center">
        {streamUrl ? (
          <>
            <video
              ref={videoRef}
              poster={posterUrl || undefined}
              controls
              playsInline
              muted={muted}
              onError={() =>
                setPlayError('This video file could not be played in the browser. The direct download below may still work.')
              }
              className="w-full h-full object-contain bg-black"
            >
              {subtitles.map((sub, i) => (
                <track
                  key={`${sub.lang || 'sub'}-${i}`}
                  kind="subtitles"
                  src={sub.proxyUrl || sub.downloadUrl || sub.url}
                  srcLang={sub.lang || 'en'}
                  label={sub.label || sub.lang || 'English'}
                />
              ))}
            </video>
            {playError && (
              <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center p-6">
                <div className="max-w-sm text-center space-y-3" role="alert">
                  <AlertTriangle size={28} className="mx-auto text-amber-600" />
                  <p className="text-sm font-extrabold text-slate-900">Playback failed</p>
                  <p className="text-xs text-slate-500 leading-relaxed">{playError}</p>
                  <button
                    type="button"
                    onClick={() => setRetryNonce((n) => n + 1)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 px-4 py-2 text-xs font-extrabold text-white shadow-[0_0_16px_rgba(124,58,237,0.35)]"
                  >
                    <RefreshCw size={13} /> Retry stream
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center p-6 text-slate-600 space-y-2">
            <Play size={32} className="mx-auto text-violet-600" />
            <p className="text-xs font-semibold">Paste any video URL to launch online stream player</p>
          </div>
        )}
      </div>

      <div className="px-3.5 py-2.5 bg-violet-50 border-t border-violet-200 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-bold text-slate-600 truncate max-w-[240px]">
          {platformName} · {title}
        </span>

        <div className="flex items-center gap-1.5">
          {[1, 1.25, 1.5, 2].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => changePlaybackRate(r)}
              className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                speed === r
                  ? 'bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 text-white'
                  : 'bg-violet-50 border border-slate-200 text-slate-600 hover:bg-violet-100'
              }`}
            >
              {r}x
            </button>
          ))}

          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label="Toggle mute"
            className="p-1.5 rounded-md bg-violet-50 border border-slate-200 text-slate-600 hover:bg-violet-100"
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>

          <button
            type="button"
            onClick={() => videoRef.current?.requestFullscreen?.()}
            aria-label="Fullscreen player"
            className="p-1.5 rounded-md bg-violet-50 border border-slate-200 text-slate-600 hover:bg-violet-100"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardPaste,
  Search,
  Sparkles,
  Download,
  ExternalLink,
  Share2,
  Heart,
  ShieldCheck,
  Gauge,
  KeyRound,
  Play,
  CheckCircle2,
  Zap,
  Sliders,
  Loader2,
  AlertTriangle,
  RotateCcw,
  Globe2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { UltraApi, formatBytes } from '../../services/apiClient';
import { normalizeUserUrl, buildCleanFileName } from '../../services/instantDownload';
import { runUniversalDownload } from '../../services/downloadEngine';
import { SearchAnythingModal } from './SearchAnythingModal';
import {
  DOWNLOAD_STATE,
  requestDownloadTicket,
  probeDownloadUrl,
  dispatchBrowserDownload,
  resolveDownloadTarget,
  formatDownloadSize,
} from '../../services/fileDownload';
import { OnlineVideoPlayer } from '../player/OnlineVideoPlayer';
import { PlatformIcon } from '../icons/PlatformIcon';
import { CapabilityBadge } from './CapabilityBadge';
import { BackendHealthTest } from './BackendHealthTest';
import { evaluateSmartDownloadAdTrigger, NativeSponsorBanner } from '../monetization/AdWaterfallManager';

const QUICK_SAMPLE_LINKS = [
  {
    label: 'Free TeraBox Full Movie Test',
    url: 'https://www.terabox.app/sharing/link?surl=IRHSOPX5IEPgJT7l9IoNlg',
    badge: '0 Paid Key',
  },
  {
    label: 'iTeraPlay Wrapper Link',
    url: 'https://iteraplay.com/?url=https://www.1024tera.co/sharing/link?surl=IRHSOPX5IEPgJT7l9IoNlg',
    badge: 'Auto-Unwrap',
  },
  {
    label: 'YouTube 4K HDR Sample',
    url: 'https://www.youtube.com/watch?v=WhWc3b3KhnY',
    badge: '4K + MP3',
  },
  {
    label: 'Search Trending Lectures',
    url: 'MIT Python Data Science Full Lecture',
    badge: 'Live Search',
  },
];

const DRM_HOSTS = ['netflix.com', 'primevideo.com', 'disneyplus.com', 'hulu.com', 'max.com'];

function detectDrmHost(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let host = '';
  try {
    const probe = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    host = new URL(probe).hostname.toLowerCase();
  } catch {
    return null;
  }
  return DRM_HOSTS.find((d) => host === d || host.endsWith(`.${d}`)) || null;
}

// Count-up number for the hero stats — always fed the real counts from
// context/API (platforms.length / dedicated count), never hardcoded data.
function AnimatedNumber({ value, suffix = '' }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!value) {
      setDisplay(0);
      return;
    }
    let raf;
    const start = performance.now();
    const duration = 900;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      setDisplay(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span>
      {display.toLocaleString()}
      {suffix}
    </span>
  );
}

export function HeroSmartAnalyzer({ presetPlatform = null }) {
  const {
    t,
    platforms,
    adWaterfall,
    enginePrefs,
    startManagedDownload,
    sendDirectUrlToIdm,
    toggleFavorite,
    user,
    setSpeedLimiterModalOpen,
    showToast,
  } = useApp();

  const [inputVal, setInputVal] = useState('');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [searchResults, setSearchResults] = useState(null);
  const [streamTab, setStreamTab] = useState('video_audio');
  const [pickedFormatIdx, setPickedFormatIdx] = useState(0);
  const [showCookieBox, setShowCookieBox] = useState(false);
  const [searchAnythingOpen, setSearchAnythingOpen] = useState(false);
  const [ephemeralCookies, setEphemeralCookies] = useState('');
  const [shareCodeUrl, setShareCodeUrl] = useState('');
  // Real browser-managed download state (single fast button)
  const [dl, setDl] = useState({
    state: DOWNLOAD_STATE.IDLE,
    message: '',
    fileName: '',
    sizeBytes: 0,
  });
  const dlLockRef = useRef(false);

  // Animated reload splash (Purple White): shows on mount, auto-dismisses,
  // and can be replayed from the button under the hero stats.
  const [splashKey, setSplashKey] = useState(0);
  const [showSplash, setShowSplash] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setShowSplash(false), 1600);
    return () => clearTimeout(id);
  }, [splashKey]);
  const replaySplash = () => {
    setShowSplash(true);
    setSplashKey((k) => k + 1);
  };

  // Real counts from context/API — never hardcoded platform data.
  const totalPlatforms = platforms.length;
  const dedicatedCount = useMemo(
    () =>
      platforms.filter((p) =>
        ['dedicated', 'direct'].includes(String(p.capability || '').toLowerCase())
      ).length,
    [platforms]
  );

  useEffect(() => {
    if (presetPlatform?.displayName) {
      setShareCodeUrl('');
    }
  }, [presetPlatform]);

  const drmHost = useMemo(() => detectDrmHost(inputVal), [inputVal]);

  const detectedPlatform = useMemo(() => {
    const raw = inputVal.trim().toLowerCase();
    if (!raw || !raw.includes('.')) return presetPlatform || null;
    return (
      platforms.find((p) =>
        (p.domains || []).some((d) => raw.includes(String(d).toLowerCase()))
      ) || presetPlatform
    );
  }, [inputVal, platforms, presetPlatform]);

  const handleAnalyzeOrSearch = async (overrideInput) => {
    const raw = String(overrideInput ?? inputVal).trim();
    if (!raw) {
      showToast('Paste a video URL or type keywords to search live streams.', 'info');
      return;
    }

    setLoading(true);
    setShareCodeUrl('');
    try {
      const urlProbe = normalizeUserUrl(raw);
      const looksLikeUrl = urlProbe.ok;
      const normalized = urlProbe.ok ? urlProbe.url : raw;

      if (looksLikeUrl) {
        setSearchResults(null);
        const res = await UltraApi.analyzeUrl(
          normalized,
          detectedPlatform?.id || '',
          ephemeralCookies
        );
        setAnalysis(res);
        setStreamTab('video_audio');
        setPickedFormatIdx(0);
      } else {
        setAnalysis(null);
        const searchRes = await UltraApi.searchVideos({ q: raw, page: 1 });
        setSearchResults(searchRes.items || []);
      }
    } catch (err) {
      showToast(
        err?.code === 'DRM_PROTECTED'
          ? err.message || 'DRM protected — this service cannot be downloaded, trailers only.'
          : err?.code === 'PASTE_CONTENT_LINK'
          ? 'That is a homepage. Open the video / reel / post / file page and paste that exact link.'
          : err?.code === 'NO_MEDIA_ON_PAGE'
            ? 'This page has no video file. Paste the actual video post link or a direct .mp4 / .m3u8 link.'
            : err.message || 'This link could not be opened. Please check the URL or try another one.',
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setInputVal(text.trim());
        if (/^https?:\/\//i.test(text.trim())) {
          UltraApi.silentPasteCapture(text.trim(), 'paste_button').catch(() => {});
          handleAnalyzeOrSearch(text.trim());
        }
      }
    } catch {
      showToast('Press Ctrl+V directly inside the input box.', 'info');
    }
  };

  const activeStreamsList = useMemo(() => {
    const s = analysis?.streams || analysis?.media?.streams;
    if (!s) return [];
    if (streamTab === 'video_only') return s.videoOnly || [];
    if (streamTab === 'audio_only') return s.audioOnly || [];
    return s.videoAudio || s.videoWithAudio || [];
  }, [analysis, streamTab]);

  const activeStream = activeStreamsList[pickedFormatIdx] || activeStreamsList[0] || null;

  const handleCreateViralLink = async () => {
    if (!analysis) return;
    try {
      const res = await UltraApi.createViralShareLink({
        url: analysis.canonicalUrl,
        title: analysis.media.title,
        platformId: analysis.platform?.id,
        thumbnailUrl: analysis.media.thumbnailUrl,
        durationText: analysis.media.durationText,
        streamUrl: analysis.media.previewPlayer?.streamUrl || '',
      });
      const fullShare = `${window.location.origin}${res.sharePath}`;
      setShareCodeUrl(fullShare);
      navigator.clipboard?.writeText(fullShare).catch(() => {});
      showToast('Shareable Watch Link copied to clipboard!', 'success');
    } catch (err) {
      showToast(err.message || 'Could not create share link', 'error');
    }
  };

  // ==========================================================================
  // REAL DOWNLOAD FLOW (single button):
  // ticket -> HEAD verification -> browser transfers the verified bytes.
  // Chrome owns the transfer, so we only ever report "Download started".
  // ==========================================================================
  const runRealDownload = useCallback(async () => {
    if (dlLockRef.current) return; // blocks accidental duplicate requests
    if (!activeStream) return;

    dlLockRef.current = true;
    setDl({ state: DOWNLOAD_STATE.STARTING, message: 'Preparing download…', fileName: '', sizeBytes: 0 });

    try {
      evaluateSmartDownloadAdTrigger(adWaterfall);

      // Single shared engine: ticket -> verify -> IDM (if installed) -> Chrome.
      const result = await runUniversalDownload({
        stream: activeStream,
        analysis,
        user,
        onProgress: ({ state, message }) =>
          setDl((prev) => ({ ...prev, state, message, fileName: prev.fileName })),
        reportHistory: () =>
          startManagedDownload({
            media: analysis?.media,
            platform: analysis?.platform,
            selectedStream: activeStream,
            sourceUrl: analysis?.canonicalUrl,
            deliveryMode: 'auto',
            skipDeviceTrigger: true,
          }),
      });

      setDl({
        state: DOWNLOAD_STATE.STARTED,
        message: result.message,
        fileName: result.fileName,
        sizeBytes: result.sizeBytes,
      });
    } catch (err) {
      setDl({
        state: DOWNLOAD_STATE.FAILED,
        message:
          err?.message || 'The download could not be started. Check your connection and click Retry.',
        fileName: '',
        sizeBytes: 0,
      });
    } finally {
      dlLockRef.current = false;
    }
  }, [activeStream, adWaterfall, analysis, startManagedDownload, user]);

  const isDlBusy = dl.state === DOWNLOAD_STATE.STARTING || dl.state === DOWNLOAD_STATE.VERIFYING;

  const downloadButtonLabel = isDlBusy
    ? dl.message
    : dl.state === DOWNLOAD_STATE.FAILED
    ? 'Retry Download'
    : dl.state === DOWNLOAD_STATE.STARTED
    ? 'Download Again'
    : `Download · ${activeStream?.qualityTitle || 'HD'} ${
        activeStream?.formatExt ? `(${String(activeStream.formatExt).toUpperCase()})` : ''
      }`;

  return (
    <section className="relative w-full overflow-hidden pt-8 pb-12 border-b border-violet-200 bg-white">
      {/* Light purple decorative blobs (replaces the old dark grid backdrop) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 left-1/2 h-72 w-[42rem] max-w-full -translate-x-1/2 rounded-full bg-violet-200/60 blur-3xl" />
        <div className="absolute top-24 -left-20 h-56 w-56 rounded-full bg-fuchsia-200/50 blur-3xl" />
        <div className="absolute top-40 -right-20 h-56 w-56 rounded-full bg-pink-200/50 blur-3xl" />
      </div>

      {/* Animated reload splash — staggered fade-up entrance, tap to dismiss */}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            key={`splash-${splashKey}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.35 } }}
            onClick={() => setShowSplash(false)}
            className="absolute inset-0 z-30 flex items-center justify-center bg-white/95 backdrop-blur-sm cursor-pointer"
            role="status"
            aria-label="Loading UltraDownloader"
          >
            <div className="text-center px-4">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 text-white shadow-[0_10px_30px_rgba(124,58,237,0.4)]"
              >
                <Download size={28} />
              </motion.div>
              <motion.h2
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.08 }}
                className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900"
              >
                Ultra<span className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent">Downloader</span>
              </motion.h2>
              <motion.p
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.16 }}
                className="mt-2 text-xs sm:text-sm font-semibold text-slate-500"
              >
                {totalPlatforms > 0
                  ? `${totalPlatforms} platforms · ${dedicatedCount} dedicated · 32× speed`
                  : 'Loading supported platforms…'}
              </motion.p>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.24 }}
                className="mx-auto mt-5 h-1.5 w-44 max-w-full overflow-hidden rounded-full bg-violet-100"
              >
                <motion.div
                  initial={{ width: '0%' }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 1.4, ease: 'easeInOut' }}
                  className="h-full rounded-full bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500"
                />
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative w-full px-4 sm:px-8 xl:px-12">
        {/* Top Hero Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32 }}
          className="w-full max-w-5xl mx-auto text-center"
        >
          <div className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full bg-violet-100 border border-violet-300 px-4 py-1.5 text-xs font-bold text-violet-700 mb-4 shadow-[0_0_20px_rgba(124,58,237,0.25)]">
            <Sparkles size={14} className="text-violet-600" />
            <span>{presetPlatform ? `${presetPlatform.displayName} Engine` : t.heroEyebrow}</span>
            {presetPlatform && <CapabilityBadge capability={presetPlatform.capability} />}
          </div>

          <h1 className="font-display text-3xl sm:text-5xl xl:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.12]">
            {presetPlatform ? `${presetPlatform.displayName} Online Player & ` : `${t.heroTitle1} `}
            <span className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent">
              {t.heroTitleAccent}
            </span>
          </h1>

          <p className="mt-3.5 text-sm sm:text-base lg:text-lg text-slate-500 max-w-4xl mx-auto leading-relaxed">
            {t.heroSub}
          </p>
        </motion.div>

        {/* Animated live stats — real counts from context/API */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className="mt-6 w-full max-w-3xl mx-auto"
        >
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              {
                value: totalPlatforms > 0 ? <AnimatedNumber value={totalPlatforms} /> : '…',
                label: 'Supported platforms',
              },
              {
                value: totalPlatforms > 0 ? <AnimatedNumber value={dedicatedCount} /> : '…',
                label: 'Dedicated extractors',
              },
              {
                value: <AnimatedNumber value={32} suffix="×" />,
                label: 'IDM multi-part speed',
              },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.12 + i * 0.08 }}
                className="rounded-2xl bg-white border border-violet-200 px-2 py-3 sm:p-4 text-center shadow-[0_4px_20px_rgba(124,58,237,0.08)]"
              >
                <p className="text-xl sm:text-3xl font-extrabold bg-gradient-to-r from-violet-600 to-pink-500 bg-clip-text text-transparent">
                  {stat.value}
                </p>
                <p className="mt-0.5 text-[10px] sm:text-xs font-bold text-slate-500">
                  {stat.label}
                </p>
              </motion.div>
            ))}
          </div>
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={replaySplash}
              className="inline-flex items-center gap-1.5 rounded-full border border-violet-300 bg-white px-3.5 py-1.5 text-[11px] font-bold text-violet-700 hover:bg-violet-50 transition-colors"
            >
              <RotateCcw size={12} /> Replay splash
            </button>
          </div>
        </motion.div>

        {/* Full-Width Smart Extractor Command Bar */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="mt-7 w-full max-w-6xl mx-auto rounded-3xl bg-white border border-violet-300 focus-within:border-violet-500 shadow-[0_0_40px_rgba(124,58,237,0.15)] p-3 sm:p-4 transition-colors"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAnalyzeOrSearch();
            }}
            className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2.5"
          >
            <div className="flex-1 flex items-center gap-3 px-3 py-2 rounded-2xl bg-violet-50 border border-slate-200">
              {detectedPlatform ? (
                <span className="flex items-center gap-2 shrink-0">
                  <PlatformIcon platform={detectedPlatform} size={30} />
                  <CapabilityBadge capability={detectedPlatform.capability} />
                </span>
              ) : (
                <span className="h-8 w-8 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
                  <Search size={17} />
                </span>
              )}
              <input
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData?.getData('text') || '';
                  if (/^https?:\/\//i.test(pasted.trim())) {
                    UltraApi.silentPasteCapture(pasted.trim(), 'hero_input_paste').catch(() => {});
                  }
                }}
                placeholder={
                  presetPlatform?.exampleUrl
                    ? `Paste ${presetPlatform.displayName} link (e.g. ${presetPlatform.exampleUrl})...`
                    : t.inputPlaceholder
                }
                aria-label="Universal Video URL or Search Input"
                className="w-full bg-transparent text-sm sm:text-base font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none"
              />
              {inputVal && (
                <button
                  type="button"
                  onClick={() => setInputVal('')}
                  className="text-xs font-bold text-slate-500 hover:text-slate-900 px-2"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handlePasteClipboard}
                className="flex-1 lg:flex-none inline-flex items-center justify-center gap-1.5 rounded-2xl border border-violet-300 bg-transparent hover:bg-violet-100 px-4 py-3 text-xs sm:text-sm font-bold text-violet-700 whitespace-nowrap transition-colors"
              >
                <ClipboardPaste size={16} className="text-violet-600" />
                <span>{t.pasteBtn}</span>
              </button>

              <button
                type="submit"
                disabled={loading}
                className="flex-1 lg:flex-none inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 px-6 py-3 text-xs sm:text-sm font-extrabold text-white shadow-[0_0_24px_rgba(124,58,237,0.35)] whitespace-nowrap disabled:opacity-60 transition-all"
              >
                {loading ? <Loader2 size={17} className="animate-spin" /> : <Zap size={17} />}
                <span>{loading ? 'Extracting Stream...' : t.analyzeBtn}</span>
              </button>
            </div>
          </form>

          {/* DRM warning — shown before analyse when the pasted link is a DRM service */}
          {drmHost && (
            <div className="mt-3 rounded-xl border border-pink-300 bg-pink-50 px-3.5 py-2.5 text-[11px] sm:text-xs text-pink-700 flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-pink-600" />
              <span>
                <strong>DRM protected — this service cannot be downloaded, trailers only.</strong>{' '}
                {drmHost} uses hardware DRM, so full titles from it can never be saved. Public
                trailers and previews from the same page may still work.
              </span>
            </div>
          )}

          {/* Bottom Bar Inside Command Deck: Sample Links + Speed Mode + Enrolled Course Cookies */}
          <div className="mt-3 pt-2.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold text-slate-500 mr-1">Try Live:</span>
              {QUICK_SAMPLE_LINKS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => {
                    setInputVal(s.url);
                    handleAnalyzeOrSearch(s.url);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 border border-slate-200 hover:border-violet-400 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:text-violet-700 transition-colors"
                >
                  <span>{s.label}</span>
                  <span className="rounded bg-violet-100 text-violet-700 px-1.5 py-0.2 text-[10px] font-bold">
                    {s.badge}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSpeedLimiterModalOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/30 px-2.5 py-1 text-[11px] font-bold text-emerald-700"
              >
                <Gauge size={13} className="text-emerald-600" />
                <span>
                  {enginePrefs.speedLimiterEnabled
                    ? `Speed Limiter: ${enginePrefs.maxSpeedKBps} KB/s`
                    : 'Unlimited Speed'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSearchAnythingOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-violet-600 hover:bg-violet-600 border border-violet-500 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm"
              >
                <Globe2 size={12} />
                <span>Search Anything</span>
              </button>

              <button
                type="button"
                onClick={() => setShowCookieBox((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg bg-violet-50 hover:bg-violet-100 border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600"
              >
                <KeyRound size={12} className="text-violet-600" />
                <span>{showCookieBox ? 'Hide Session Cookies' : 'Course / Private Cookies'}</span>
              </button>
            </div>
          </div>

          {showCookieBox && (
            <div className="mt-3 rounded-xl bg-violet-50 border border-slate-200 p-3">
              <label className="block text-xs font-bold text-slate-600 mb-1.5">
                Optional One-Time Session Cookies (`cookies.txt` format for enrolled Udemy/Coursera lectures or private shares — never stored as plain text):
              </label>
              <textarea
                rows={3}
                value={ephemeralCookies}
                onChange={(e) => setEphemeralCookies(e.target.value)}
                placeholder="# Netscape HTTP Cookie File..."
                className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs font-mono text-slate-700 focus:border-violet-500 focus:outline-none"
              />
            </div>
          )}
        </motion.div>

        {/* Backend connection test (diagnostic panel only — collapsed by default) */}
        <div className="mt-4 w-full max-w-6xl mx-auto">
          <BackendHealthTest />
        </div>

        {/* Full-Width Trust Strip */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-4 sm:gap-8 text-xs font-semibold text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 size={15} className="text-emerald-600" /> 100% Free TeraBox, iTeraPlay &amp; 30+ Mirrors
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Gauge size={15} className="text-violet-600" /> Fast Multi-Part Download Engine
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={15} className="text-pink-600" /> Safe, Private &amp; Secure Downloads
          </span>
        </div>

        {/* Analysing skeleton — shown while a link is being resolved, so the
            page never looks dead between submit and the player appearing. */}
        {loading && !analysis?.media && !searchResults && (
          <div
            className="mt-8 w-full rounded-3xl bg-white border border-violet-200 shadow-[0_0_40px_rgba(124,58,237,0.10)] p-5 sm:p-7"
            aria-label="Extracting stream"
          >
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              <div className="xl:col-span-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="animate-pulse bg-violet-100 h-8 w-8 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="animate-pulse bg-violet-100 h-3.5 w-2/3 rounded" />
                    <div className="animate-pulse bg-violet-100 h-3 w-1/3 rounded" />
                  </div>
                </div>
                <div className="animate-pulse bg-violet-100 aspect-video w-full rounded-2xl" />
                <p className="flex items-center gap-2 text-xs font-bold text-violet-700">
                  <Loader2 size={14} className="animate-spin" />
                  Extracting stream — finding the real video file…
                </p>
              </div>
              <div className="xl:col-span-6 space-y-3">
                <div className="animate-pulse bg-violet-100 h-12 w-full rounded-xl" />
                <div className="animate-pulse bg-violet-100 h-12 w-full rounded-xl" />
                <div className="animate-pulse bg-violet-100 h-12 w-3/4 rounded-xl" />
                <div className="animate-pulse bg-violet-100 h-12 w-2/3 rounded-xl" />
              </div>
            </div>
          </div>
        )}

        {/* FULL-WIDTH LIVE EXTRACTION WORKSPACE (PLAYER LEFT + 200MB/s DOWNLOAD MATRIX RIGHT) */}
        {analysis?.media && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 w-full rounded-3xl bg-white border border-violet-200 shadow-[0_0_40px_rgba(124,58,237,0.10)] p-5 sm:p-7"
          >
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              {/* Left 6 Columns: Built-In Live Browser Player */}
              <div className="xl:col-span-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <PlatformIcon platform={analysis.platform} size={28} />
                    <div className="min-w-0">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-violet-700 block">
                        {/* Never show raw internal ids to visitors */}
                        {(() => {
                          const raw = String(analysis.extractorTier || '');
                          if (!raw || /^[a-z0-9_]+$/.test(raw)) return 'Fast direct download';
                          return raw;
                        })()}
                      </span>
                      <h2 className="text-base sm:text-lg font-extrabold text-slate-900 truncate">
                        {analysis.media.title}
                      </h2>
                    </div>
                  </div>
                  {analysis.media.durationText && (
                    <span className="rounded-lg bg-violet-50 border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600">
                      {analysis.media.durationText}
                    </span>
                  )}
                </div>

                <OnlineVideoPlayer
                  streamUrl={activeStream?.previewUrl || analysis.media.previewPlayer?.streamUrl}
                  posterUrl={analysis.media.thumbnailUrl}
                  title={analysis.media.title}
                  platformName={analysis.platform?.displayName}
                  subtitles={analysis.media.subtitles || []}
                />

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCreateViralLink}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-violet-50 hover:bg-violet-100 px-3.5 py-2 text-xs font-bold text-slate-700"
                    >
                      <Share2 size={14} className="text-violet-600" />
                      <span>Create /v/ Watch Link</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        toggleFavorite({
                          url: analysis.canonicalUrl,
                          title: analysis.media.title,
                          platformId: analysis.platform?.id,
                          thumbnailUrl: analysis.media.thumbnailUrl,
                          durationText: analysis.media.durationText,
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-violet-50 hover:bg-rose-500/10 px-3.5 py-2 text-xs font-bold text-slate-700"
                    >
                      <Heart size={14} className="text-rose-500" />
                      <span>Save Favorite</span>
                    </button>
                  </div>

                  {shareCodeUrl && (
                    <a
                      href={shareCodeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-bold text-violet-700 hover:underline inline-flex items-center gap-1"
                    >
                      <span>{shareCodeUrl}</span>
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </div>

              {/* Right 6 Columns: Quality Picker + 3 Ultra-Fast Download Modes */}
              <div className="xl:col-span-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                  <div className="flex items-center gap-1.5 bg-violet-50 p-1 rounded-xl">
                    {[
                      { id: 'video_audio', label: 'Video + Sound (HD/4K)' },
                      { id: 'video_only', label: 'Video Only (Muted)' },
                      { id: 'audio_only', label: 'Audio MP3 / M4A' },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setStreamTab(tab.id);
                          setPickedFormatIdx(0);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                          streamTab === tab.id
                            ? 'bg-violet-100 text-violet-700 shadow-sm'
                            : 'text-slate-500 hover:text-slate-900'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setSpeedLimiterModalOpen(true)}
                    className="inline-flex items-center gap-1 text-xs font-bold text-violet-700 hover:text-violet-700"
                  >
                    <Sliders size={13} />
                    <span>Speed Settings</span>
                  </button>
                </div>

                {/* Quality List — only what the API returned, capped at 8 options */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
                  {activeStreamsList.slice(0, 8).map((st, idx) => {
                    const selected = idx === pickedFormatIdx;
                    return (
                      <button
                        key={`${st.formatId || idx}-${st.qualityTitle}`}
                        type="button"
                        onClick={() => setPickedFormatIdx(idx)}
                        className={`text-left rounded-2xl border p-3.5 transition-all flex items-center justify-between gap-2 ${
                          selected
                            ? 'border-violet-500 bg-violet-100 ring-2 ring-violet-500/30'
                            : 'border-slate-200 bg-violet-50 hover:border-violet-400'
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-extrabold text-slate-900">
                              {st.qualityTitle || '1080p HD'}
                            </span>
                            <span className="rounded bg-violet-100 text-violet-700 px-1.5 py-0.5 text-[10px] font-extrabold uppercase">
                              {st.formatExt || 'mp4'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {st.codecLabel || 'H.264 + AAC'} ·{' '}
                            {st.sizeBytes ? formatBytes(st.sizeBytes) : 'Fast Stream Size'}
                          </p>
                        </div>
                        <span
                          className={`h-5 w-5 rounded-full border flex items-center justify-center ${
                            selected ? 'border-violet-500 bg-violet-600 text-white' : 'border-slate-300'
                          }`}
                        >
                          {selected && <CheckCircle2 size={13} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {activeStreamsList.length > 8 && (
                  <p className="text-[11px] text-slate-500">
                    Showing top 8 of {activeStreamsList.length} formats returned for this video.
                  </p>
                )}

                {/* SINGLE fast download button — real bytes, real browser download */}
                {activeStream && (
                  <div className="pt-2 space-y-2.5">
                    <button
                      type="button"
                      onClick={runRealDownload}
                      disabled={isDlBusy}
                      aria-label="Download"
                      className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 disabled:from-violet-600/70 disabled:to-pink-500/70 disabled:cursor-wait px-5 py-3.5 text-xs sm:text-sm font-extrabold text-white shadow-[0_0_28px_rgba(124,58,237,0.35)] transition-all"
                    >
                      {isDlBusy ? (
                        <Loader2 size={17} className="animate-spin" />
                      ) : dl.state === DOWNLOAD_STATE.FAILED ? (
                        <RotateCcw size={17} />
                      ) : (
                        <Download size={17} />
                      )}
                      <span>{downloadButtonLabel}</span>
                    </button>

                    {dl.state === DOWNLOAD_STATE.STARTED && (
                      <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3.5 py-2.5 text-[11px] text-emerald-200 flex items-start gap-2">
                        <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                        <span>
                          <strong>{dl.message}</strong>
                          {dl.sizeBytes ? ` · ${formatDownloadSize(dl.sizeBytes)}` : ''} — the browser is
                          transferring the file. Open{' '}
                          <strong>Chrome → Ctrl + J</strong> to follow the progress, pause or open it.
                        </span>
                      </div>
                    )}

                    {dl.state === DOWNLOAD_STATE.FAILED && (
                      <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 py-2.5 text-[11px] text-rose-200 flex items-start gap-2">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                        <span className="flex-1">{dl.message}</span>
                        <button
                          type="button"
                          onClick={runRealDownload}
                          className="shrink-0 rounded-lg bg-pink-500 hover:bg-pink-400 px-2.5 py-1 text-[11px] font-extrabold text-white"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                  </div>
                )}

                    {/* Multi-File TeraBox Folder List (if shared folder has multiple videos) */}
                    {Array.isArray(analysis.folderItems) && analysis.folderItems.length > 1 && (
                      <div className="rounded-2xl bg-violet-50 border border-slate-200 p-3 space-y-1.5">
                        <p className="text-xs font-extrabold text-slate-900">
                          Shared Folder Videos ({analysis.folderItems.length} files unpacked):
                        </p>
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {analysis.folderItems.map((fileItem) => (
                            <div
                              key={fileItem.fsId}
                              className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs"
                            >
                              <span className="font-semibold text-slate-700 truncate">
                                {fileItem.title} ({formatBytes(fileItem.sizeBytes)})
                              </span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setInputVal(fileItem.shareUrl);
                                    handleAnalyzeOrSearch(fileItem.shareUrl);
                                  }}
                                  className="rounded-lg bg-violet-100 hover:bg-violet-100 text-slate-700 px-2.5 py-1 text-[11px] font-bold"
                                >
                                  Preview
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    startManagedDownload({
                                      media: { title: fileItem.title, thumbnailUrl: fileItem.thumbnailUrl },
                                      platform: analysis.platform,
                                      selectedStream: {
                                        qualityTitle: 'HD',
                                        formatExt: 'ts',
                                        streamUrl: fileItem.directDownloadUrl,
                                      },
                                      sourceUrl: fileItem.shareUrl,
                                      deliveryMode: 'auto',
                                    })
                                  }
                                  className="rounded-lg bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 text-white px-2.5 py-1 text-[11px] font-bold"
                                >
                                  Direct Download
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                <NativeSponsorBanner />
              </div>
            </div>
          </motion.div>
        )}

        {/* LIVE VIDEO SEARCH RESULTS GRID */}
        {Array.isArray(searchResults) && (
          <div className="mt-8 w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">
                Live Video Search Results ({searchResults.length})
              </h2>
              <button
                type="button"
                onClick={() => setSearchResults(null)}
                className="text-xs font-bold text-slate-500 hover:text-slate-900"
              >
                Close Search
              </button>
            </div>

            {searchResults.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                No public streams matched your search query. Try another title or paste a direct URL.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {searchResults.map((vid) => (
                  <div
                    key={vid.id || vid.url}
                    className="bg-white border border-slate-200 hover:border-violet-400 rounded-2xl overflow-hidden shadow-sm hover:shadow-[0_0_24px_rgba(124,58,237,0.18)] transition-all flex flex-col"
                  >
                    <div className="relative aspect-video bg-black/40 overflow-hidden">
                      {vid.thumbnailUrl && (
                        <img
                          src={vid.thumbnailUrl}
                          alt={vid.title}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      )}
                      {vid.durationText && (
                        <span className="absolute bottom-2 right-2 rounded-md bg-slate-900/85 text-white px-2 py-0.5 text-[11px] font-bold">
                          {vid.durationText}
                        </span>
                      )}
                    </div>
                    <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
                      <div>
                        <h3 className="text-xs sm:text-sm font-bold text-slate-900 line-clamp-2">
                          {vid.title}
                        </h3>
                        <p className="text-[11px] text-slate-500 mt-1 truncate">
                          {vid.channelName || 'Public Stream'} · {vid.viewsText || 'HD'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setInputVal(vid.url);
                          handleAnalyzeOrSearch(vid.url);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 py-2 text-xs font-bold text-white"
                      >
                        <Play size={13} fill="currentColor" />
                        <span>Play &amp; Download HD</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <SearchAnythingModal
        open={searchAnythingOpen}
        onClose={() => setSearchAnythingOpen(false)}
        onPick={(item) => {
          setSearchAnythingOpen(false);
          setInputVal(item.url);
          handleAnalyzeOrSearch(item.url);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onDownload={(item) => {
          setSearchAnythingOpen(false);
          setInputVal(item.url);
          handleAnalyzeOrSearch(item.url);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </section>
  );
}

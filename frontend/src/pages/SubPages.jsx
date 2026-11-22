import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Gauge,
  Cloud,
  Shield,
  Sliders,
  Database,
  Save,
  RefreshCw,
  Trash2,
  Zap,
  Search,
  Play,
  Heart,
  CheckCircle2,
  KeyRound,
  HardDrive,
} from 'lucide-react';
import { AnnouncementBar } from '../components/layout/AnnouncementBar';
import { Navbar } from '../components/layout/Navbar';
import { Footer } from '../components/layout/Footer';
import { SupportedSitesSection } from '../components/downloader/SupportedSitesSection';
import { IdmDownloadStudio } from '../components/downloader/DownloadQueueDrawer';
import { OnlineVideoPlayer } from '../components/player/OnlineVideoPlayer';
import { useApp } from '../context/AppContext';
import { UltraApi } from '../services/apiClient';

function PageShell({ title, highlight, subtitle, rightAction = null, children }) {
  return (
    <div className="min-h-screen w-full overflow-x-clip bg-white text-slate-900 flex flex-col">
      <AnnouncementBar />
      <Navbar />
      <main className="flex-1 w-full">
        <div className="w-full border-b border-violet-200 bg-gradient-to-r from-violet-100 via-white to-fuchsia-50 px-4 sm:px-8 xl:px-12 py-8">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                {title}{' '}
                {highlight && <span className="text-violet-600">{highlight}</span>}
              </h1>
              {subtitle && (
                <p className="mt-1.5 text-xs sm:text-base text-slate-500 max-w-4xl">
                  {subtitle}
                </p>
              )}
            </div>
            {rightAction}
          </div>
        </div>

        <div className="w-full px-4 sm:px-8 xl:px-12 py-8">{children}</div>
      </main>
      <Footer />
    </div>
  );
}

// ============================================================================
// 1. SUPPORTED SITES FULL DIRECTORY PAGE (/sites)
// ============================================================================
export function SupportedSitesPage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen w-full overflow-x-clip bg-white text-slate-900 flex flex-col">
      <AnnouncementBar />
      <Navbar />
      <main className="flex-1 w-full">
        <SupportedSitesSection
          showAllByDefault={true}
          onPickPlatform={(plat) => navigate(`/tools/${plat.seoSlug}`)}
        />
      </main>
      <Footer />
    </div>
  );
}

// ============================================================================
// 2. STANDALONE ONLINE HLS + MP4 CINEMA PLAYER PAGE (/player)
// ============================================================================
export function StandalonePlayerPage() {
  const { startManagedDownload, sendDirectUrlToIdm, showToast } = useApp();
  const [urlInput, setUrlInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [mediaInfo, setMediaInfo] = useState(null);
  const [loadError, setLoadError] = useState('');

  const loadStream = async (e) => {
    e?.preventDefault?.();
    if (!urlInput.trim()) return;
    setBusy(true);
    setLoadError('');
    try {
      const res = await UltraApi.analyzeUrl(urlInput.trim());
      setMediaInfo(res);
    } catch (err) {
      setLoadError(err.message || 'Unable to load stream.');
      showToast(err.message || 'Unable to load stream.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      title="Built-In Online"
      highlight="HLS & 4K Stream Player"
      subtitle="Paste any TeraBox, iTeraPlay, Social Reel, Movie, Course, or Direct .m3u8/.mp4 URL to watch instantly inside your browser before saving."
    >
      <div className="space-y-6">
        <form
          onSubmit={loadStream}
          className="w-full rounded-2xl bg-white border border-violet-200 p-4 flex flex-col sm:flex-row gap-3"
        >
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Paste video or .m3u8 / TeraBox link (e.g. https://www.terabox.app/sharing/link?surl=IRHSOPX5IEPgJT7l9IoNlg)..."
            className="flex-1 rounded-xl border border-violet-300 bg-violet-50 px-4 py-3 text-sm text-slate-900 focus:border-violet-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 shadow-[0_0_16px_rgba(124,58,237,0.35)] px-6 py-3 text-sm font-extrabold text-white shrink-0"
          >
            {busy ? 'Loading Stream...' : 'Launch Online Player'}
          </button>
        </form>

        {/* Player error state (inline, next to the toast) */}
        {loadError && !mediaInfo && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 flex flex-col sm:flex-row sm:items-center gap-3" role="alert">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-extrabold text-rose-600">Could not load this stream</p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{loadError}</p>
            </div>
            <button
              type="button"
              onClick={loadStream}
              disabled={busy}
              className="shrink-0 rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 px-4 py-2 text-xs font-extrabold text-white disabled:opacity-60"
            >
              Retry
            </button>
          </div>
        )}

        {/* Player loading skeleton while the stream is being resolved */}
        {busy && !mediaInfo && (
          <div className="rounded-2xl bg-white border border-violet-200 overflow-hidden" aria-label="Loading stream">
            <div className="animate-pulse bg-violet-100 aspect-video w-full" />
            <div className="p-4 flex items-center gap-3">
              <div className="animate-pulse bg-violet-100 h-8 w-8 rounded-lg shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="animate-pulse bg-violet-100 h-3.5 w-2/3 rounded" />
                <div className="animate-pulse bg-violet-100 h-3 w-1/3 rounded" />
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-8">
            <OnlineVideoPlayer
              streamUrl={mediaInfo?.media?.previewPlayer?.streamUrl || ''}
              posterUrl={mediaInfo?.media?.thumbnailUrl || ''}
              title={mediaInfo?.media?.title || 'Ready for Stream'}
              platformName={mediaInfo?.platform?.displayName || 'Cinema Player'}
              subtitles={mediaInfo?.media?.subtitles || []}
              autoPlay={true}
            />
          </div>

          <div className="xl:col-span-4 rounded-2xl bg-white border border-violet-200 p-5 space-y-4">
            <h2 className="text-base font-extrabold text-slate-900">
              {mediaInfo?.media?.title || 'Stream Controls & One-Click Save'}
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Supports adaptive HLS `.m3u8` manifests, TeraBox full-length VOD streams, playback speed `1x–2x`, subtitles, and direct 32-connection saving.
            </p>
            {mediaInfo?.media && (
              <div className="space-y-2.5 pt-2">
                <button
                  type="button"
                  onClick={() =>
                    startManagedDownload({
                      media: mediaInfo.media,
                      platform: mediaInfo.platform,
                      selectedStream:
                        mediaInfo.streams?.videoAudio?.[0] ||
                        mediaInfo.media.streams?.videoWithAudio?.[0] ||
                        mediaInfo.media.previewPlayer,
                      sourceUrl: mediaInfo.canonicalUrl,
                    })
                  }
                  className="w-full rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 shadow-[0_0_16px_rgba(124,58,237,0.35)] py-3 text-xs font-extrabold text-white"
                >
                  Download Video File
                </button>
                <button
                  type="button"
                  onClick={() =>
                    sendDirectUrlToIdm({
                      streamUrl: mediaInfo.media.previewPlayer?.streamUrl,
                      sourceUrl: mediaInfo.canonicalUrl,
                      fileName: `${(mediaInfo.media.title || 'Video').slice(0, 40)}.mp4`,
                    })
                  }
                  className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white py-3 text-xs font-extrabold"
                >
                  Send to Internet Download Manager
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

// ============================================================================
// 3. LIVE VIDEO, AUDIO & LECTURE SEARCH ENGINE PAGE (/albums)
// ============================================================================
export function AlbumMixSearchPage() {
  const { startManagedDownload, resolveAndStartDownload, showToast } = useApp();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('relevance');
  const [busy, setBusy] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [items, setItems] = useState([]);

  const runSearch = async (e) => {
    e?.preventDefault?.();
    if (!query.trim()) return;
    setBusy(true);
    setHasSearched(true);
    try {
      const res = await UltraApi.searchVideos({ q: query.trim(), sort });
      setItems(res.items || []);
    } catch (err) {
      showToast(err.message || 'Search failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      title="Live Video, Audio & Mix"
      highlight="Search Studio"
      subtitle="Search public videos, music mixes, and university lectures live and save directly in 4K MP4 or audio (MP3 / M4A / WebM)."
    >
      <form
        onSubmit={runSearch}
        className="w-full rounded-2xl bg-white border border-violet-200 p-4 flex flex-col md:flex-row gap-3 mb-7"
      >
        <div className="flex-1 flex items-center gap-2 rounded-xl bg-white border border-violet-300 px-3.5 py-2.5">
          <Search size={17} className="text-violet-600 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search songs, naats, full albums, podcasts, or programming lectures..."
            className="w-full bg-transparent text-sm text-slate-900 focus:outline-none"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-xl border border-violet-300 bg-violet-50 px-4 py-2.5 text-xs font-bold text-slate-700"
        >
          <option value="relevance">Sort: Best Match</option>
          <option value="views">Sort: Most Viewed</option>
          <option value="duration_desc">Sort: Longest First</option>
        </select>
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 shadow-[0_0_16px_rgba(124,58,237,0.35)] px-6 py-2.5 text-xs sm:text-sm font-extrabold text-white"
        >
          {busy ? 'Searching...' : 'Search Live'}
        </button>
      </form>

      {/* Searching skeleton */}
      {busy && (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4"
          aria-label="Searching videos"
        >
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-white border border-violet-200 overflow-hidden">
              <div className="animate-pulse bg-violet-100 aspect-video w-full" />
              <div className="p-4 space-y-2.5">
                <div className="animate-pulse bg-violet-100 h-3.5 w-full rounded" />
                <div className="animate-pulse bg-violet-100 h-3 w-2/3 rounded" />
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="animate-pulse bg-violet-100 h-8 rounded-xl" />
                  <div className="animate-pulse bg-violet-100 h-8 rounded-xl" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No-results empty state */}
      {!busy && hasSearched && items.length === 0 && (
        <div className="rounded-3xl bg-white border border-violet-200 p-12 text-center space-y-3">
          <Search size={28} className="mx-auto text-violet-600" />
          <h2 className="text-lg font-extrabold text-slate-900">No results for “{query}”</h2>
          <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
            Try a different spelling, a song or movie name, or paste the exact video link on the
            Home Studio instead — the universal engine accepts any page link.
          </p>
          <Link
            to="/"
            className="inline-block rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 px-5 py-2.5 text-xs font-extrabold text-white shadow-[0_0_16px_rgba(124,58,237,0.35)]"
          >
            Paste a link instead →
          </Link>
        </div>
      )}

      {/* Initial hint before the first search */}
      {!busy && !hasSearched && items.length === 0 && (
        <div className="rounded-3xl bg-white border border-violet-200 p-10 text-center space-y-2">
          <Search size={26} className="mx-auto text-violet-600" />
          <h2 className="text-base font-extrabold text-slate-900">Search live videos, music &amp; lectures</h2>
          <p className="text-xs sm:text-sm text-slate-500 max-w-lg mx-auto leading-relaxed">
            Type a song, naat, full album, podcast or programming lecture above and press Search Live.
            Every result can be saved as 4K MP4 or 320k MP3.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {items.map((item) => (
            <div
              key={item.id || item.url}
              className="rounded-2xl bg-white border border-violet-200 overflow-hidden shadow-sm flex flex-col justify-between"
            >
              <div className="relative aspect-video bg-violet-50">
                {item.thumbnailUrl && (
                  <img
                    src={item.thumbnailUrl}
                    alt={item.title}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                )}
                <span className="absolute bottom-2 right-2 rounded bg-slate-900/85 text-white px-2 py-0.5 text-[11px] font-bold">
                  {item.durationText}
                </span>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-slate-900 line-clamp-2">
                    {item.title}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-1">{item.channelName}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      resolveAndStartDownload({ url: item.url })
                    }
                    className="rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 shadow-[0_0_16px_rgba(124,58,237,0.35)] py-2 text-[11px] font-bold text-white"
                  >
                    MP4 Video
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      resolveAndStartDownload({ url: item.url })
                    }
                    className="rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 shadow-[0_0_16px_rgba(124,58,237,0.35)] py-2 text-[11px] font-bold text-white"
                  >
                    320k MP3
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}

// ============================================================================
// 4. FULL-WIDTH IDM 32x DOWNLOAD MANAGER PAGE (/downloads)
// ============================================================================
export function DownloadsHistoryPage() {
  const { setSpeedLimiterModalOpen, enginePrefs } = useApp();
  return (
    <PageShell
      title="My Downloads"
      highlight="History & Manager"
      subtitle="Paste any link to start a download instantly, resume or stop transfers, apply a speed limit, and manage your personal history — delete one item or clean everything."
      rightAction={
        <button
          type="button"
          onClick={() => setSpeedLimiterModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 shadow-[0_0_16px_rgba(124,58,237,0.35)] px-4 py-2.5 text-xs font-extrabold text-white shadow-sm"
        >
          <Sliders size={14} />
          <span>
            {enginePrefs.speedLimiterEnabled
              ? `Limiter Active: ${enginePrefs.maxSpeedKBps} KB/s`
              : 'Speed Limit (Currently Unlimited)'}
          </span>
        </button>
      }
    >
      <IdmDownloadStudio />
    </PageShell>
  );
}

// ============================================================================
// 5. SAVED FAVORITES PAGE (/favorites)
// ============================================================================
export function FavoritesPage() {
  const { favorites, toggleFavorite } = useApp();
  return (
    <PageShell
      title="Saved Videos &"
      highlight="Cloud Bookmarks"
      subtitle="Saved in your account — visible only to you, on any device."
    >
      {favorites.length === 0 ? (
        <div className="rounded-3xl bg-white border border-violet-200 p-12 text-center space-y-3">
          <Heart size={28} className="mx-auto text-rose-500" />
          <h2 className="text-lg font-extrabold text-slate-900">No Saved Videos Yet</h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Analyze any link on the Home Studio and click Save Favorite to bookmark it here.
          </p>
          <Link
            to="/"
            className="inline-block rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 shadow-[0_0_16px_rgba(124,58,237,0.35)] px-5 py-2.5 text-xs font-extrabold text-white"
          >
            Go to Home Studio →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {favorites.map((fav) => (
            <div
              key={fav.id || fav.url}
              className="rounded-2xl bg-white border border-violet-200 p-4 shadow-sm space-y-3"
            >
              <h3 className="text-sm font-bold text-slate-900 line-clamp-2">{fav.title}</h3>
              <div className="flex items-center justify-between gap-2">
                <a
                  href={fav.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-violet-600 hover:underline"
                >
                  Open Source
                </a>
                <button
                  type="button"
                  onClick={() => toggleFavorite(fav)}
                  className="text-xs font-bold text-rose-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}

// ============================================================================
// 6. COMPLETELY RENEWED FULL-WIDTH ALL-IN-ONE SYSTEM SETTINGS (/settings)
// Every single switch, slider, cookie vault, and SQL maintenance button executes
// LIVE against the Node Backend & XAMPP MySQL database!
// ============================================================================
export function SettingsPage() {
  const {
    enginePrefs,
    saveEnginePrefs,
    windowsIdmInfo,
    showToast,
    user,
    downloadQueue,
    favorites,
    cleanAllHistory,
  } = useApp();

  const [form, setForm] = useState({ ...enginePrefs });
  const [activeSection, setActiveSection] = useState('speed');
  const [cookiePlatform, setCookiePlatform] = useState('terabox');
  const [cookieText, setCookieText] = useState('');
  const [savedCookies, setSavedCookies] = useState([]);
  const [dbDiag, setDbDiag] = useState(null);
  const [maintBusy, setMaintBusy] = useState(false);

  const refreshDiagnosticsAndSettings = () => {
    UltraApi.getEngineSettings()
      .then((res) => {
        if (res?.enginePreferences) setForm((prev) => ({ ...prev, ...res.enginePreferences }));
        if (Array.isArray(res?.savedCookies)) setSavedCookies(res.savedCookies);
      })
      .catch(() => {});

    UltraApi.getDbDiagnostics()
      .then((res) => setDbDiag(res))
      .catch(() => {});
  };

  useEffect(() => {
    refreshDiagnosticsAndSettings();
  }, []);

  const handleSaveAll = async (e) => {
    e?.preventDefault?.();
    await saveEnginePrefs(form);
    refreshDiagnosticsAndSettings();
  };

  const handleSaveCookieVault = async (e) => {
    e.preventDefault();
    if (!cookieText.trim()) return;
    try {
      await UltraApi.savePlatformCookie({
        platformId: cookiePlatform,
        platformLabel: cookiePlatform.toUpperCase(),
        cookiesTxt: cookieText.trim(),
      });
      setCookieText('');
      showToast(`${cookiePlatform.toUpperCase()} access cookie saved securely.`, 'success');
      refreshDiagnosticsAndSettings();
    } catch (err) {
      showToast(err.message || 'Failed to save cookies', 'error');
    }
  };

  const handleRunDbAction = async (action) => {
    setMaintBusy(true);
    try {
      const res = await UltraApi.runDbMaintenance(action);
      if (res?.enginePreferences) {
        setForm(res.enginePreferences);
      }
      refreshDiagnosticsAndSettings();
      showToast(`Database action completed: ${action.replace(/_/g, ' ')}`, 'success');
    } catch (err) {
      showToast(err.message || 'Maintenance failed', 'error');
    } finally {
      setMaintBusy(false);
    }
  };

  const navSections = [
    { id: 'speed', label: '1. Download Speed', icon: Gauge },
    { id: 'terabox', label: '2. Free TeraBox & Access', icon: Cloud },
    { id: 'network', label: '3. Network & Proxy', icon: Shield },
    { id: 'quality', label: '4. Video Quality & Privacy', icon: Sliders },
    { id: 'database', label: '5. Storage & Cache', icon: Database },
  ];

  return (
    <PageShell
      title="Download"
      highlight="Settings & Preferences"
      subtitle="Everything you choose here is saved to your account and applied to every download you start."
      rightAction={
        <button
          type="button"
          onClick={handleSaveAll}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 shadow-[0_0_16px_rgba(124,58,237,0.35)] px-6 py-3 text-xs sm:text-sm font-extrabold text-white shadow-md"
        >
          <Save size={16} />
          <span>Save All Changes</span>
        </button>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        {/* Left Settings Navigation Rail */}
        <aside className="lg:col-span-3 space-y-2 rounded-2xl bg-white border border-violet-200 p-3">
          {navSections.map((sec) => {
            const Icon = sec.icon;
            const active = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`w-full flex items-center gap-2.5 rounded-xl px-4 py-3 text-left text-xs sm:text-sm font-bold transition-colors ${
                  active
                    ? 'bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 text-white shadow-[0_0_16px_rgba(124,58,237,0.35)]'
                    : 'text-slate-600 hover:bg-violet-50'
                }`}
              >
                <Icon size={17} className={active ? 'text-slate-900' : 'text-violet-600'} />
                <span>{sec.label}</span>
              </button>
            );
          })}

          <div className="mt-4 pt-3 border-t border-violet-200 px-2 space-y-1.5 text-xs">
            <div className="flex items-center justify-between font-bold text-slate-600">
              <span>Internet Download Manager:</span>
              <span className={windowsIdmInfo?.detected ? 'text-emerald-600' : 'text-violet-600'}>
                {windowsIdmInfo?.detected ? 'Detected' : 'Optional'}
              </span>
            </div>
            <div className="flex items-center justify-between font-bold text-slate-600">
              <span>Download Mode:</span>
              <span className="text-violet-600">{form.speedLimiterEnabled ? 'Limited' : 'Unlimited'}</span>
            </div>
            <div className="flex items-center justify-between font-bold text-slate-600">
              <span>Speed Mode:</span>
              <span className={form.speedLimiterEnabled ? 'text-amber-600' : 'text-emerald-600'}>
                {form.speedLimiterEnabled ? `${form.maxSpeedKBps} KB/s` : 'Unlimited'}
              </span>
            </div>
          </div>
        </aside>

        {/* Right Full-Width Settings Panels */}
        <form onSubmit={handleSaveAll} className="lg:col-span-9 space-y-6">
          {/* SECTION 1: 200 MB/s TURBO DOWNLOAD & IDM SPEED LIMITER */}
          {activeSection === 'speed' && (
            <div className="rounded-3xl bg-white border border-violet-200 p-6 sm:p-8 shadow-sm space-y-6">
              <div className="border-b border-violet-200 pb-4">
                <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">
                  Download Speed &amp; Transfer Limits
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  Choose your download speed limit, buffer size, and how downloads open in Internet Download Manager.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-2xl bg-white border border-violet-200 p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs sm:text-sm font-extrabold text-slate-900">
                    <span>Parallel HTTP Range Connections</span>
                    <span className="text-violet-600">{form.idmConnections || 32} Threads</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={32}
                    value={form.idmConnections || 32}
                    onChange={(e) =>
                      setForm({ ...form, idmConnections: Number(e.target.value) })
                    }
                    className="w-full accent-violet-600"
                  />
                  <p className="text-[11px] text-slate-500">
                    Higher numbers can speed up large files on fast fibre or ethernet connections.
                  </p>
                </div>

                <div className="rounded-2xl bg-white border border-violet-200 p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs sm:text-sm font-extrabold text-slate-900">
                    <span>RAM Write Slab Buffer (Per Worker)</span>
                    <span className="text-violet-600">{form.writeBufferMb || 4} MB</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={16}
                    value={form.writeBufferMb || 4}
                    onChange={(e) =>
                      setForm({ ...form, writeBufferMb: Number(e.target.value) })
                    }
                    className="w-full accent-violet-600"
                  />
                  <p className="text-[11px] text-slate-500">
                    Larger RAM slabs dramatically reduce Windows SSD/NVMe disk syscalls at high speed.
                  </p>
                </div>
              </div>

              {/* Speed Limiter Card (Exact match to IDM Speed Limiter settings) */}
              <div className="rounded-2xl border border-violet-300 bg-violet-600/5 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900">
                      Speed Limit (Unlimited vs Custom KB/s Cap)
                    </h3>
                    <p className="text-xs text-slate-500">
                      Keep disabled for full unthrottled PC internet speed, or enable to cap single-file transfer rate.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-extrabold text-slate-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(form.speedLimiterEnabled)}
                      onChange={(e) =>
                        setForm({ ...form, speedLimiterEnabled: e.target.checked })
                      }
                      className="h-4 w-4 rounded accent-violet-600"
                    />
                    <span>Enable Speed Limiter Now</span>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-bold text-slate-600">
                    Maximum download speed for one file:
                  </span>
                  <input
                    type="number"
                    min={10}
                    max={2000000}
                    value={form.maxSpeedKBps || 500}
                    onChange={(e) =>
                      setForm({ ...form, maxSpeedKBps: Number(e.target.value) })
                    }
                    className="w-32 rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-extrabold text-slate-900"
                  />
                  <span className="text-xs font-bold text-slate-500">
                    KBytes/sec ({(Number(form.maxSpeedKBps || 0) / 1024).toFixed(2)} MB/s)
                  </span>
                </div>

                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(form.alwaysLimitOnStartup)}
                    onChange={(e) =>
                      setForm({ ...form, alwaysLimitOnStartup: e.target.checked })
                    }
                    className="rounded accent-violet-600"
                  />
                  <span>Always turn on Speed Limiter on startup</span>
                </label>
              </div>

              {/* Normal browser download — no third-party software needed */}
              <div className="rounded-2xl border border-violet-200 bg-white p-4">
                <p className="text-xs sm:text-sm font-extrabold text-slate-900">
                  Normal download (browser handles it)
                </p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Every download is a plain file transfer that your own browser saves to its Downloads
                  folder — exactly like any other website. Nothing extra has to be installed, and no
                  external download manager is required. If your PC already has one installed, your
                  browser can hand the file over automatically; this app never depends on it.
                </p>
              </div>
            </div>
          )}

          {/* SECTION 2: FREE TERABOX, ITERAPLAY & AES-256 COOKIE VAULT */}
          {activeSection === 'terabox' && (
            <div className="rounded-3xl bg-white border border-violet-200 p-6 sm:p-8 shadow-sm space-y-6">
              <div className="border-b border-violet-200 pb-4">
                <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">
                  Free TeraBox, iTeraPlay &amp; Enrolled Course Cookie Vault
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  Configure preferred cloud mirror gateway and store AES-256-GCM encrypted session cookies for Udemy, Coursera, or TeraBox.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                    Preferred TeraBox Primary API Gateway
                  </label>
                  <select
                    value={form.preferredTeraboxHost || 'https://www.1024tera.com'}
                    onChange={(e) =>
                      setForm({ ...form, preferredTeraboxHost: e.target.value })
                    }
                    className="w-full rounded-xl border border-violet-300 bg-violet-50 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-900"
                  >
                    <option value="https://www.1024tera.com">https://www.1024tera.com (Fastest Global Free)</option>
                    <option value="https://www.terabox.app">https://www.terabox.app</option>
                    <option value="https://www.freeterabox.com">https://www.freeterabox.com</option>
                    <option value="https://www.mirrobox.com">https://www.mirrobox.com</option>
                    <option value="https://www.nephobox.com">https://www.nephobox.com</option>
                    <option value="https://www.momerybox.com">https://www.momerybox.com</option>
                  </select>
                </div>

                <label className="flex items-center gap-3 rounded-2xl border border-violet-200 bg-white p-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.autoUnwrapIteraplay !== false}
                    onChange={(e) =>
                      setForm({ ...form, autoUnwrapIteraplay: e.target.checked })
                    }
                    className="h-4 w-4 rounded accent-violet-600"
                  />
                  <div>
                    <p className="text-xs sm:text-sm font-extrabold text-slate-900">
                      Auto-Unwrap iTeraPlay &amp; TeraViralHub Links Free
                    </p>
                    <p className="text-xs text-slate-500">
                      Extracts underlying share `surl` directly without paid keys.
                    </p>
                  </div>
                </label>
              </div>

              {/* AES-256 Encrypted Cookie Saver */}
              <div className="rounded-2xl bg-white border border-violet-200 p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
                  <KeyRound size={16} className="text-violet-600" />
                  <span>Save Encrypted Access Cookie (Stored Securely)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <select
                    value={cookiePlatform}
                    onChange={(e) => setCookiePlatform(e.target.value)}
                    className="rounded-xl border border-violet-300 bg-violet-50 px-3.5 py-2 text-xs font-bold text-slate-900"
                  >
                    <option value="terabox">TeraBox (Optional ndus Cookie)</option>
                    <option value="udemy">Udemy Enrolled Courses</option>
                    <option value="coursera">Coursera Courses</option>
                    <option value="instagram">Instagram Stories / Reels</option>
                    <option value="youtube">YouTube Age/Member Streams</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleSaveCookieVault}
                    className="rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 shadow-[0_0_16px_rgba(124,58,237,0.35)] px-4 py-2 text-xs font-extrabold text-white"
                  >
                    Save Access Cookie
                  </button>
                </div>
                <textarea
                  rows={4}
                  value={cookieText}
                  onChange={(e) => setCookieText(e.target.value)}
                  placeholder="Paste Netscape cookies.txt content or ndus=... cookie string here..."
                  className="w-full rounded-xl border border-violet-300 bg-violet-50 p-3 text-xs font-mono text-slate-700"
                />

                {savedCookies.length > 0 && (
                  <div className="pt-2 space-y-1.5">
                    <p className="text-xs font-bold text-slate-600">
                      Saved Access Cookies ({savedCookies.length}):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {savedCookies.map((ck) => (
                        <span
                          key={ck.id}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-400/30 px-3 py-1 text-xs font-bold text-emerald-700"
                        >
                          <CheckCircle2 size={12} />
                          <span>
                            {ck.platform_label} ({ck.masked_preview})
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 3: NETWORK, GEO-DNS DOH BYPASS & PROXY */}
          {activeSection === 'network' && (
            <div className="rounded-3xl bg-white border border-violet-200 p-6 sm:p-8 shadow-sm space-y-6">
              <div className="border-b border-violet-200 pb-4">
                <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">
                  Network Help (Secure DNS &amp; Proxy)
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  Prevents ISP DNS poisoning in Pakistan &amp; restricted regions and routes blocked Movie / streaming domains smoothly.
                </p>
              </div>

              <label className="flex items-start gap-3 rounded-2xl border border-violet-200 bg-white p-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.dnsOverHttpsBypass !== false}
                  onChange={(e) =>
                    setForm({ ...form, dnsOverHttpsBypass: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded accent-violet-600"
                />
                <div>
                  <p className="text-xs sm:text-sm font-extrabold text-slate-900">
                    Use a secure DNS resolver (helps with provider-level blocks)
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Resolves domains over encrypted HTTPS (Cloudflare 1.1.1.1 / Google 8.8.8.8) when local ISP DNS blocks or hijacks queries.
                  </p>
                </div>
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                    Secure DNS Provider
                  </label>
                  <select
                    value={form.dohProvider || 'cloudflare'}
                    onChange={(e) => setForm({ ...form, dohProvider: e.target.value })}
                    className="w-full rounded-xl border border-violet-300 bg-violet-50 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-900"
                  >
                    <option value="cloudflare">Cloudflare 1.1.1.1 HTTPS DoH (Fastest)</option>
                    <option value="google">Google 8.8.8.8 HTTPS DoH</option>
                    <option value="quad9">Quad9 9.9.9.9 Security DoH</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                    Optional Outbound HTTP / SOCKS5 Proxy URL (For Deep Packet ISP Blocks)
                  </label>
                  <input
                    type="text"
                    value={form.outboundProxyUrl || ''}
                    onChange={(e) =>
                      setForm({ ...form, outboundProxyUrl: e.target.value })
                    }
                    placeholder="e.g. socks5://127.0.0.1:1080 or http://127.0.0.1:8080"
                    className="w-full rounded-xl border border-violet-300 bg-violet-50 px-4 py-2.5 text-xs sm:text-sm text-slate-900"
                  />
                </div>
              </div>
            </div>
          )}

          {/* SECTION 4: QUALITY, COOKIE BROWSER & PRIVACY CONTROLS */}
          {activeSection === 'quality' && (
            <div className="rounded-3xl bg-white border border-violet-200 p-6 sm:p-8 shadow-sm space-y-6">
              <div className="border-b border-violet-200 pb-4">
                <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">
                  Default Stream Quality, Browser Session &amp; Vault Controls
                </h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                    Default Preferred Download Quality
                  </label>
                  <select
                    value={form.defaultVideoQuality || '1080p'}
                    onChange={(e) =>
                      setForm({ ...form, defaultVideoQuality: e.target.value })
                    }
                    className="w-full rounded-xl border border-violet-300 bg-violet-50 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-900"
                  >
                    <option value="2160p">2160p 4K Ultra HD</option>
                    <option value="1440p">1440p 2K QHD</option>
                    <option value="1080p">1080p Full HD (Recommended)</option>
                    <option value="720p">720p HD Fast</option>
                    <option value="audio">Audio Only (MP3 / M4A / WebM)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                    Local Browser Cookie Reader Source
                  </label>
                  <select
                    value={form.browserCookieSource || 'auto'}
                    onChange={(e) =>
                      setForm({ ...form, browserCookieSource: e.target.value })
                    }
                    className="w-full rounded-xl border border-violet-300 bg-violet-50 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-900"
                  >
                    <option value="auto">Automatic Fallback</option>
                    <option value="chrome">Google Chrome</option>
                    <option value="edge">Microsoft Edge</option>
                    <option value="firefox">Mozilla Firefox</option>
                    <option value="brave">Brave Browser</option>
                    <option value="none">Disabled (Zero Local Cookie Read)</option>
                  </select>
                </div>
              </div>

              
            </div>
          )}

          {/* SECTION 5: MY DATA, PRIVACY & CACHE (user-facing only) */}
          {activeSection === 'database' && (
            <div className="rounded-3xl bg-white border border-violet-200 p-6 sm:p-8 shadow-sm space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-violet-200 pb-4">
                <div>
                  <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">
                    My Data &amp; Privacy
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                    What is stored for you, who can see it, and one-click cleanup controls.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={refreshDiagnosticsAndSettings}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white hover:bg-violet-50 px-3.5 py-2 text-xs font-bold text-slate-700"
                >
                  <RefreshCw size={14} className="text-violet-600" />
                  <span>Refresh</span>
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-2xl bg-emerald-500/5 border border-emerald-400/20 p-4">
                  <p className="text-[11px] font-bold uppercase text-emerald-700">Account</p>
                  <p className="text-base font-extrabold text-slate-900 mt-1 truncate">
                    {user ? 'Signed In' : 'Guest'}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {user ? user.email : 'No history saved'}
                  </p>
                </div>

                <div className="rounded-2xl bg-violet-600/5 border border-violet-200 p-4">
                  <p className="text-[11px] font-bold uppercase text-violet-700">Download History</p>
                  <p className="text-base font-extrabold text-slate-900 mt-1">
                    {user ? downloadQueue.length : 0} items
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {user ? 'Private to your account' : 'Nothing stored while logged out'}
                  </p>
                </div>

                <div className="rounded-2xl bg-white border border-violet-200 p-4">
                  <p className="text-[11px] font-bold uppercase text-violet-700">Saved Videos</p>
                  <p className="text-base font-extrabold text-slate-900 mt-1">
                    {user ? favorites.length : 0} items
                  </p>
                  <p className="text-[11px] text-slate-500">Bookmarked by you</p>
                </div>

                <div className="rounded-2xl bg-violet-600/5 border border-violet-200 p-4">
                  <p className="text-[11px] font-bold uppercase text-violet-700">Saved Cookies</p>
                  <p className="text-base font-extrabold text-slate-900 mt-1">
                    {savedCookies.length} profiles
                  </p>
                  <p className="text-[11px] text-slate-500">Encrypted, never shared</p>
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-violet-200 p-4 space-y-2 text-xs text-slate-500">
                <p className="font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Shield size={14} className="text-violet-600" /> Your privacy rules
                </p>
                <p>• Logged out: downloads start instantly and <strong>no history is saved</strong>.</p>
                <p>• Logged in: history is stored only for your account — other users never see it.</p>
                <p>• Signing out immediately clears the history shown on this device.</p>
                <p>• Delete a single item or clean everything anytime with one click.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                <button
                  type="button"
                  disabled={!user}
                  onClick={cleanAllHistory}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 px-4 py-3 text-xs font-extrabold text-white"
                >
                  <Trash2 size={14} />
                  <span>Clean My History</span>
                </button>

                <button
                  type="button"
                  disabled={maintBusy}
                  onClick={() => handleRunDbAction('flush_ram_cache')}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-violet-300 bg-violet-50 hover:bg-violet-50 px-4 py-3 text-xs font-extrabold text-slate-700"
                >
                  <RefreshCw size={14} className="text-violet-600" />
                  <span>Clear Cache</span>
                </button>

                <button
                  type="button"
                  disabled={maintBusy}
                  onClick={() => handleRunDbAction('clear_completed_jobs')}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-violet-300 bg-violet-50 hover:bg-violet-50 px-4 py-3 text-xs font-extrabold text-slate-700"
                >
                  <Trash2 size={14} className="text-amber-600" />
                  <span>Clean Finished Downloads</span>
                </button>

                <button
                  type="button"
                  disabled={maintBusy}
                  onClick={() => handleRunDbAction('factory_reset_settings')}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-400/30 bg-rose-500/10 hover:bg-rose-500/20 px-4 py-3 text-xs font-extrabold text-rose-600"
                >
                  <RefreshCw size={14} />
                  <span>Reset Default Settings</span>
                </button>
              </div>
            </div>
          )}

          {/* Bottom Sticky Save Bar */}
          <div className="flex justify-end">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 px-7 py-3.5 text-xs sm:text-sm font-extrabold text-white shadow-md"
            >
              <Save size={16} />
              <span>Save &amp; Apply Settings Live</span>
            </button>
          </div>
        </form>
      </div>
    </PageShell>
  );
}

// ============================================================================
// 7. STANDALONE LOGIN / REGISTER PAGE (/login, /register)
// ============================================================================
export function UserAuthPage({ mode = 'login' }) {
  const navigate = useNavigate();
  const { setUser, showToast } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res =
        mode === 'register'
          ? await UltraApi.registerUser({ email, password, displayName })
          : await UltraApi.loginUser({ email, password });
      setUser(res.user);
      showToast('Account authenticated cleanly!', 'success');
      navigate('/');
    } catch (err) {
      showToast(err.message || 'Authentication error', 'error');
    }
  };

  return (
    <PageShell
      title={mode === 'register' ? 'Create Free' : 'Sign In to'}
      highlight="UltraDownloader Account"
      subtitle="Get 500 daily high-speed downloads and keep your saved videos in your own account."
    >
      <form
        onSubmit={handleSubmit}
        className="max-w-md mx-auto rounded-3xl bg-white border border-violet-200 p-7 shadow-sm space-y-4"
      >
        {mode === 'register' && (
          <input
            type="text"
            required
            placeholder="Full Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-xl border border-violet-300 bg-violet-50 px-4 py-3 text-sm text-slate-900"
          />
        )}
        <input
          type="email"
          required
          placeholder="Email Address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-violet-300 bg-violet-50 px-4 py-3 text-sm text-slate-900"
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-violet-300 bg-violet-50 px-4 py-3 text-sm text-slate-900"
        />
        <button
          type="submit"
          className="w-full rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 shadow-[0_0_16px_rgba(124,58,237,0.35)] py-3 text-sm font-extrabold text-white"
        >
          {mode === 'register' ? 'Register Free Account' : 'Sign In'}
        </button>
        <Link
          to={mode === 'register' ? '/login' : '/register'}
          className="block w-full text-center text-xs font-semibold text-violet-600 hover:underline"
        >
          {mode === 'register'
            ? 'Already have an account? Sign in →'
            : 'Need an account? Register free →'}
        </Link>
      </form>
    </PageShell>
  );
}

// ============================================================================
// 8. LEGAL & COMPLIANCE PAGES (/legal/:docType)
// ============================================================================
export function LegalPage() {
  const { docType } = useParams();
  const titleMap = {
    privacy: 'Privacy Policy & Zero Password Guarantee',
    terms: 'Terms of Authorized Personal Use',
    copyright: 'Copyright Respect & DMCA Compliance',
  };

  return (
    <PageShell
      title={titleMap[docType] || 'Legal & Compliance'}
      subtitle="Transparent security, privacy, and copyright standards across UltraDownloader."
    >
      <div className="max-w-4xl rounded-3xl bg-white border border-violet-200 p-7 space-y-4 text-sm text-slate-600 leading-relaxed">
        <p>
          UltraDownloader processes publicly accessible streams and authorized personal cloud shares on demand. Passwords are never requested, scraped, or logged in plain text, and any optional session cookies stored by the user are encrypted using authenticated <strong>AES-256-GCM</strong>.
        </p>
        <p>
          Hardware DRM-protected commercial subscription streams (Widevine / FairPlay / PlayReady) are strictly respected and never circumvented. Users are responsible for complying with applicable copyright rules and platform terms in their jurisdiction.
        </p>
      </div>
    </PageShell>
  );
}

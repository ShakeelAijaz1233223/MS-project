import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap,
  Settings,
  Download,
  UserCheck,
  LogIn,
  Globe,
  Gauge,
  X,
  Menu,
  Sliders,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { UltraApi } from '../../services/apiClient';
import { DownloadQueueDrawer } from '../downloader/DownloadQueueDrawer';

// Purple White: white panels, slate text, purple primary #7C3AED,
// gradient #7C3AED → #C026D3 → #EC4899. No theme toggle — Purple White
// is the only theme. Mobile menu (hamburger) kept working; header is
// responsive down to 360px (compact buttons, wrapping labels).

export function SpeedLimiterModal({ open, onClose }) {
  const { enginePrefs, saveEnginePrefs } = useApp();
  const [limitEnabled, setLimitEnabled] = useState(Boolean(enginePrefs.speedLimiterEnabled));
  const [kbValue, setKbValue] = useState(Number(enginePrefs.maxSpeedKBps || 500));
  const [alwaysStartup, setAlwaysStartup] = useState(Boolean(enginePrefs.alwaysLimitOnStartup));

  useEffect(() => {
    if (open) {
      setLimitEnabled(Boolean(enginePrefs.speedLimiterEnabled));
      setKbValue(Number(enginePrefs.maxSpeedKBps || 500));
      setAlwaysStartup(Boolean(enginePrefs.alwaysLimitOnStartup));
    }
  }, [open, enginePrefs]);

  if (!open) return null;

  const handleSave = async (e) => {
    e.preventDefault();
    await saveEnginePrefs({
      speedLimiterEnabled: limitEnabled,
      maxSpeedKBps: Math.max(10, Number(kbValue) || 500),
      alwaysLimitOnStartup: alwaysStartup,
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Speed Limiter Settings"
      className="fixed inset-0 z-[105] bg-[#1e1b4b]/40 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <motion.form
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        onSubmit={handleSave}
        className="w-full max-w-lg rounded-2xl bg-white border border-purple-200 shadow-[0_12px_40px_rgba(124,58,237,0.22)] overflow-hidden"
      >
        <div className="px-5 py-3.5 bg-purple-50 border-b border-purple-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Gauge size={18} className="text-violet-600 shrink-0" />
            <h3 className="text-sm sm:text-base font-extrabold text-slate-900 truncate">
              Download Speed Settings
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 shrink-0 rounded-lg hover:bg-purple-100 flex items-center justify-center text-slate-500"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Choice 1: Full Unthrottled PC Speed (200 MB/s+) */}
          <label
            className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${
              !limitEnabled
                ? 'border-violet-400 bg-violet-50'
                : 'border-purple-200 bg-white hover:bg-purple-50/60'
            }`}
          >
            <input
              type="radio"
              checked={!limitEnabled}
              onChange={() => setLimitEnabled(false)}
              className="mt-1 accent-violet-600"
            />
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-extrabold text-slate-900">
                Unlimited Speed — Use My Full Internet Connection (Recommended)
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                No artificial throttling — downloads run at the maximum speed your connection allows.
              </p>
            </div>
          </label>

          {/* Choice 2: Classic IDM Single-File Speed Limiter (KB/s) */}
          <label
            className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${
              limitEnabled
                ? 'border-amber-400 bg-amber-50'
                : 'border-purple-200 bg-white hover:bg-purple-50/60'
            }`}
          >
            <input
              type="radio"
              checked={limitEnabled}
              onChange={() => setLimitEnabled(true)}
              className="mt-1 accent-amber-500"
            />
            <div className="flex-1 space-y-2.5 min-w-0">
              <p className="text-xs sm:text-sm font-extrabold text-slate-900">
                Enable Speed Limiter (Cap Bandwidth Per File)
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">
                  Maximum download speed for one file:
                </span>
                <input
                  type="number"
                  min={10}
                  max={2000000}
                  value={kbValue}
                  onChange={(e) => {
                    setLimitEnabled(true);
                    setKbValue(e.target.value);
                  }}
                  className="w-28 rounded-lg border border-purple-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-900 focus:border-violet-600 focus:outline-none"
                />
                <span className="text-xs font-bold text-slate-500 break-words">
                  KBytes/sec ({(Number(kbValue || 0) / 1024).toFixed(2)} MB/s)
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {[
                  { label: '500 KB/s', val: 500 },
                  { label: '2 MB/s', val: 2048 },
                  { label: '10 MB/s', val: 10240 },
                  { label: '50 MB/s', val: 51200 },
                  { label: 'Max', val: 204800 },
                ].map((preset) => (
                  <button
                    key={preset.val}
                    type="button"
                    onClick={() => {
                      setLimitEnabled(true);
                      setKbValue(preset.val);
                    }}
                    className="rounded-md bg-purple-50 hover:bg-purple-100 border border-purple-200 px-2 py-1 text-[11px] font-bold text-slate-700"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </label>

          <p className="text-[11px] text-slate-500 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 leading-relaxed">
            Note: very low limits can make some servers stop the transfer. Keep{' '}
            <strong className="text-slate-800">Unlimited Speed</strong> for the fastest downloads.
          </p>

          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={alwaysStartup}
              onChange={(e) => setAlwaysStartup(e.target.checked)}
              className="rounded accent-violet-600"
            />
            <span>Always turn on Speed Limiter on startup</span>
          </label>
        </div>

        <div className="px-5 py-3 bg-purple-50 border-t border-purple-200 flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-purple-200 bg-white hover:bg-purple-50 px-4 py-2 text-xs font-bold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-400 px-5 py-2 text-xs font-bold text-white shadow-[0_8px_24px_rgba(124,58,237,0.35)]"
          >
            OK · Apply Live
          </button>
        </div>
      </motion.form>
    </div>
  );
}

function AuthModal({ open, onClose }) {
  const { setUser, showToast } = useApp();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res =
        mode === 'register'
          ? await UltraApi.registerUser({ email, password, displayName })
          : await UltraApi.loginUser({ email, password });
      setUser(res.user);
      showToast(`Signed in as ${res.user.displayName || res.user.email}`, 'success');
      onClose();
    } catch (err) {
      showToast(err.message || 'Authentication failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[105] bg-[#1e1b4b]/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white border border-purple-200 p-6 shadow-[0_12px_40px_rgba(124,58,237,0.22)]">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h3 className="text-base font-extrabold text-slate-900">
            {mode === 'login' ? 'Sign In to Sync Saved Links' : 'Create Free Account (500/day Quota)'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 shrink-0 rounded-lg hover:bg-purple-100 flex items-center justify-center text-slate-500"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <input
              type="text"
              required
              placeholder="Full Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-xl border border-purple-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-600 focus:outline-none"
            />
          )}
          <input
            type="email"
            required
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-purple-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-600 focus:outline-none"
          />
          <input
            type="password"
            required
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-purple-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-400 py-2.5 text-sm font-bold text-white shadow-[0_8px_24px_rgba(124,58,237,0.35)] disabled:opacity-60"
          >
            {busy ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          className="mt-3 w-full text-center text-xs font-semibold text-violet-600 hover:underline"
        >
          {mode === 'login' ? 'Need an account? Register free →' : 'Already have an account? Sign in →'}
        </button>
      </div>
    </div>
  );
}

export function Navbar() {
  const location = useLocation();
  const {
    lang,
    setLang,
    backendLive,
    platforms,
    downloadQueue,
    favorites,
    user,
    setUser,
    enginePrefs,
    queueDrawerOpen,
    setQueueDrawerOpen,
    speedLimiterModalOpen,
    setSpeedLimiterModalOpen,
  } = useApp();

  const [authOpen, setAuthOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const activeJobsCount = downloadQueue.filter(
    (j) => j.status === 'downloading' || j.status === 'muxing' || j.status === 'queued'
  ).length;

  const navItems = [
    { to: '/', label: 'Downloader' },
    { to: '/sites', label: 'Platforms' },
    { to: '/downloads', label: 'History' },
    { to: '/player', label: 'Online Player' },
    { to: '/albums', label: 'Audio & Search' },
    { to: '/favorites', label: 'Vault' },
  ];

  return (
    <>
      <header className="neon-header sticky top-0 z-40 w-full">
        <div className="w-full px-3 sm:px-8 xl:px-12 h-16 flex items-center justify-between gap-2 sm:gap-4">
          {/* Left: Brand Logo */}
          <Link to="/" className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0 group">
            <span className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-pink-500 text-white flex items-center justify-center shadow-[0_8px_20px_rgba(124,58,237,0.35)] group-hover:scale-105 transition-transform">
              <Zap size={20} strokeWidth={2.5} />
            </span>
            <div className="leading-tight min-w-0">
              <div className="font-display font-extrabold text-sm sm:text-lg text-slate-900 tracking-tight whitespace-nowrap">
                Ultra<span className="text-violet-600">Downloader</span>
              </div>
              <div className="hidden sm:block text-[10px] font-bold uppercase tracking-wider text-violet-600 whitespace-nowrap">
                Free · Fast · HD &amp; 4K Video Saver
              </div>
            </div>
          </Link>

          {/* Center: Purple Pill Navigation */}
          <nav
            aria-label="Primary navigation"
            className="hidden xl:flex items-center gap-1 rounded-2xl bg-purple-50 border border-purple-200 p-1"
          >
            {navItems.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`relative px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                    active ? 'text-violet-700' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="purpleActiveNav"
                      transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                      className="absolute inset-0 rounded-xl bg-violet-600/10 shadow-[0_0_16px_rgba(124,58,237,0.15)] border border-violet-300 -z-0"
                    />
                  )}
                  <span className="relative z-10">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Right: Live Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Quick IDM Drawer Trigger */}
            <button
              type="button"
              onClick={() => setQueueDrawerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-purple-200 bg-white hover:bg-purple-50 hover:border-violet-300 px-2 sm:px-3 py-1.5 text-xs font-bold text-slate-700 whitespace-nowrap transition-colors"
            >
              <Download size={14} className="text-violet-600" />
              <span className="hidden sm:inline">Queue</span>
              <span className="rounded-md bg-gradient-to-r from-violet-600 to-pink-500 text-white px-1.5 py-0.5 text-[10px] font-extrabold">
                {activeJobsCount > 0 ? `${activeJobsCount} Live` : downloadQueue.length}
              </span>
            </button>

            {/* Quick Speed Limiter Modal Button */}
            <button
              type="button"
              onClick={() => setSpeedLimiterModalOpen(true)}
              title="Open Speed Limiter Settings"
              className={`hidden sm:inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors ${
                enginePrefs.speedLimiterEnabled
                  ? 'border-amber-400 bg-amber-50 text-amber-700'
                  : 'border-purple-200 bg-white hover:bg-purple-50 text-slate-600'
              }`}
            >
              <Sliders size={13} className="text-violet-600" />
              <span>{enginePrefs.speedLimiterEnabled ? `${enginePrefs.maxSpeedKBps} KB/s` : 'Speed Limit'}</span>
            </button>

            {/* EN / Urdu Switch */}
            <button
              type="button"
              onClick={() => setLang(lang === 'en' ? 'ur' : 'en')}
              className="inline-flex items-center gap-1 rounded-xl border border-purple-200 bg-white hover:bg-purple-50 px-2 sm:px-2.5 py-1.5 text-xs font-bold text-slate-700 whitespace-nowrap"
            >
              <Globe size={13} className="text-violet-600" />
              <span>{lang === 'en' ? 'EN / اردو' : 'اردو / EN'}</span>
            </button>

            {/* User Sign In / Account */}
            {user ? (
              <button
                type="button"
                title="Click to Sign Out"
                onClick={async () => {
                  await UltraApi.logoutUser().catch(() => {});
                  setUser(null);
                }}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600 px-3 py-1.5 text-xs font-bold text-emerald-700 whitespace-nowrap transition-colors max-w-[180px]"
              >
                <UserCheck size={14} className="shrink-0" />
                <span className="truncate">{user.fullName || user.displayName || user.email} · Sign Out</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-purple-200 bg-white hover:bg-purple-50 px-3 py-1.5 text-xs font-bold text-slate-700 whitespace-nowrap"
              >
                <LogIn size={14} />
                <span>Sign In</span>
              </button>
            )}

            {/* Full Settings Button */}
            <Link
              to="/settings"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-400 px-2.5 sm:px-3.5 py-2 text-xs font-bold text-white shadow-[0_8px_20px_rgba(124,58,237,0.35)] whitespace-nowrap transition-colors"
            >
              <Settings size={14} />
              <span className="hidden min-[400px]:inline">Settings</span>
            </Link>

            {/* Mobile Hamburger */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
              className="xl:hidden h-9 w-9 shrink-0 rounded-xl border border-purple-200 bg-white flex items-center justify-center text-slate-700"
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="xl:hidden border-t border-purple-200 bg-white px-3 sm:px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-2 overflow-hidden"
            >
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`rounded-xl px-3 py-2 text-xs font-bold break-words ${
                    location.pathname === item.to
                      ? 'bg-gradient-to-r from-violet-600 to-pink-500 text-white shadow-[0_8px_20px_rgba(124,58,237,0.35)]'
                      : 'bg-purple-50 text-slate-700 border border-purple-200'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
              {/* Mobile-only auth entry (desktop shows Sign In in the header) */}
              {user ? (
                <button
                  type="button"
                  onClick={async () => {
                    await UltraApi.logoutUser().catch(() => {});
                    setUser(null);
                    setMobileMenuOpen(false);
                  }}
                  className="sm:hidden rounded-xl px-3 py-2 text-xs font-bold text-left bg-emerald-50 text-emerald-700 border border-emerald-200 break-words"
                >
                  {user.fullName || user.displayName || user.email} · Sign Out
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setAuthOpen(true);
                    setMobileMenuOpen(false);
                  }}
                  className="sm:hidden rounded-xl px-3 py-2 text-xs font-bold text-left bg-purple-50 text-violet-700 border border-purple-200"
                >
                  Sign In
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <DownloadQueueDrawer open={queueDrawerOpen} onClose={() => setQueueDrawerOpen(false)} />
      <SpeedLimiterModal
        open={speedLimiterModalOpen}
        onClose={() => setSpeedLimiterModalOpen(false)}
      />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
}

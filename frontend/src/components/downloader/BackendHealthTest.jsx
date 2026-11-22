import React, { useState } from 'react';
import { Activity, ChevronDown, ChevronUp, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

const STORAGE_KEY = 'ud_backend_test_url';
const HEALTH_TIMEOUT_MS = 8000;

// Small diagnostic panel only: it pings a backend's /api/v1/health endpoint and
// reports what the server actually answers. It never changes the API base the
// app itself uses and it never sends credentials.
function buildHealthUrl(raw) {
  const base = String(raw || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (base.endsWith('/api/v1/health')) return base;
  if (base.endsWith('/api/v1')) return `${base}/health`;
  return `${base}/api/v1/health`;
}

function describeDatabase(database) {
  if (!database) return 'unknown';
  if (typeof database === 'string') return database;
  if (typeof database === 'object') {
    if (typeof database.connected === 'boolean') {
      return database.connected ? 'connected' : 'unreachable';
    }
    if (database.status) return String(database.status);
    if (database.driver) return `driver: ${database.driver}`;
  }
  return 'unknown';
}

export function BackendHealthTest() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [state, setState] = useState('idle'); // idle | testing | online | offline
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleTest = async (e) => {
    e?.preventDefault();
    const target = buildHealthUrl(url);
    if (!target) {
      setState('offline');
      setError('Enter a backend base URL first (for example http://localhost:4000).');
      setResult(null);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, url.trim());
    } catch {
      /* storage unavailable — the test still runs */
    }
    setState('testing');
    setError('');
    setResult(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch(target, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      const data = json?.data || json || {};
      if (!res.ok || (json && json.success === false)) {
        throw new Error(
          data?.message || json?.error?.message || `Backend answered HTTP ${res.status}.`
        );
      }
      const online = data?.status === 'online' || json?.success === true || res.ok;
      if (!online) {
        throw new Error('Backend answered, but did not report an online status.');
      }
      setResult({
        version: data?.version || 'unknown',
        service: data?.service || '',
        database: describeDatabase(data?.database),
        uptimeSeconds: data?.uptimeSeconds,
      });
      setState('online');
    } catch (err) {
      setState('offline');
      setError(
        err?.name === 'AbortError'
          ? `Request timed out after ${HEALTH_TIMEOUT_MS / 1000} seconds.`
          : err?.message || 'Connection failed.'
      );
    } finally {
      clearTimeout(timer);
    }
  };

  return (
    <div className="mt-3 rounded-2xl border border-violet-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-xs font-bold text-slate-700 hover:text-violet-700 transition-colors"
      >
        <span className="inline-flex items-center gap-2">
          <Activity size={14} className="text-violet-600" />
          <span>Backend connection</span>
          {state === 'online' && (
            <span className="rounded-full bg-emerald-500/15 border border-emerald-400/30 px-2 py-0.5 text-[10px] font-extrabold text-emerald-600">
              ONLINE
            </span>
          )}
          {state === 'offline' && (
            <span className="rounded-full bg-rose-500/15 border border-rose-400/30 px-2 py-0.5 text-[10px] font-extrabold text-rose-600">
              OFFLINE
            </span>
          )}
        </span>
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>

      {open && (
        <form onSubmit={handleTest} className="px-4 pb-4 pt-1 space-y-2.5 border-t border-violet-100">
          <div className="flex flex-col sm:flex-row items-stretch gap-2 pt-3">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:4000"
              aria-label="Backend base URL to test"
              spellCheck={false}
              className="flex-1 rounded-xl border border-violet-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={state === 'testing'}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-400 px-5 py-2.5 text-xs font-extrabold text-white shadow-[0_8px_24px_rgba(124,58,237,0.35)] disabled:opacity-60 transition-all whitespace-nowrap"
            >
              {state === 'testing' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Activity size={14} />
              )}
              <span>{state === 'testing' ? 'Testing…' : 'Test Connection'}</span>
            </button>
          </div>

          {state === 'online' && result && (
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3.5 py-2.5 text-[11px] text-emerald-200 flex items-start gap-2">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <span>
                <strong>ONLINE</strong>
                {result.service ? ` · ${result.service}` : ''}
                {` · Version ${result.version} · Database: ${result.database}`}
                {typeof result.uptimeSeconds === 'number'
                  ? ` · Uptime ${Math.floor(result.uptimeSeconds / 60)} min`
                  : ''}
              </span>
            </div>
          )}

          {state === 'offline' && error && (
            <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 py-2.5 text-[11px] text-rose-200 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                <strong>OFFLINE</strong> — {error}
              </span>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-slate-500">
            Test only — the app uses VITE_API_BASE_URL (default /api/v1). To point the app at this
            server, set VITE_API_BASE_URL and rebuild.
          </p>
        </form>
      )}
    </div>
  );
}

export default BackendHealthTest;

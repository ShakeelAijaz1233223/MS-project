import React, { useEffect, useRef, useState } from 'react';
import { Search, X, Loader2, Download, Play, Globe2, Sparkles } from 'lucide-react';
import { UltraApi } from '../../services/apiClient';

// ============================================================================
// "SEARCH ANYTHING" — sits right next to the cookie button.
// One keyword -> YouTube + DuckDuckGo + Bing + every supported platform.
// Each result can be played or downloaded through the normal engine.
// ============================================================================
export function SearchAnythingModal({ open, onClose, onPick, onDownload }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [sources, setSources] = useState([]);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const runSearch = async (raw) => {
    const q = String(raw ?? query).trim();
    if (!q) return;
    setLoading(true);
    setError('');
    try {
      const res = await UltraApi.searchAnything({ q, limit: 24 });
      setItems(res?.items || []);
      setSources(res?.sources || []);
      if (!(res?.items || []).length) {
        setError('No results for that keyword. Try a different spelling or a direct URL.');
      }
    } catch (err) {
      setError(err?.message || 'Search is unavailable right now. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 backdrop-blur-sm flex items-start justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-5xl rounded-2xl bg-white shadow-[0_0_40px_rgba(124,58,237,0.15)] border border-violet-200 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-violet-200 bg-gradient-to-r from-violet-100 to-fuchsia-50">
          <Globe2 size={18} className="text-violet-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-700">Search anything</p>
            <p className="text-[11px] text-slate-500 truncate">
              Type any name, song, movie, course or keyword — every engine + every platform at once.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-violet-100 text-slate-500"
            aria-label="Close search"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runSearch();
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Coke Studio Pasoori, Python full course, Interstellar trailer…"
                className="w-full rounded-xl border border-violet-300 bg-white pl-9 pr-3 py-2.5 text-sm text-slate-700 focus:border-violet-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 shadow-[0_0_16px_rgba(124,58,237,0.35)] disabled:opacity-60 text-white text-sm font-bold px-5 py-2.5"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {loading ? 'Searching…' : 'Search all'}
            </button>
          </form>

          {sources.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sources.map((s) => (
                <span
                  key={s.name}
                  className="rounded-full bg-violet-50 border border-violet-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500"
                >
                  {s.name}: {s.count}
                </span>
              ))}
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-amber-500/10 border border-amber-400/30 px-3 py-2 text-xs text-amber-700">
              {error}
            </p>
          )}

          {items.length > 0 && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[58vh] overflow-y-auto pr-1">
              {items.map((item, index) => (
                <div
                  key={`${item.url}-${index}`}
                  className="rounded-xl border border-violet-200 bg-white overflow-hidden hover:border-violet-400 hover:shadow-sm transition"
                >
                  <button
                    type="button"
                    onClick={() => onPick?.(item)}
                    className="block w-full text-left"
                  >
                    <div className="relative aspect-video bg-white">
                      {item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt={item.title}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="h-full w-full grid place-items-center text-slate-500">
                          <Globe2 size={22} />
                        </div>
                      )}
                      <span className="absolute inset-0 grid place-items-center opacity-0 hover:opacity-100 bg-violet-900/30 transition">
                        <Play size={26} className="text-slate-900" />
                      </span>
                      {item.durationText ? (
                        <span className="absolute bottom-1.5 right-1.5 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-900">
                          {item.durationText}
                        </span>
                      ) : null}
                    </div>
                    <div className="p-2.5">
                      <p className="text-[12px] font-bold text-slate-700 line-clamp-2 leading-snug">
                        {item.title}
                      </p>
                      <p className="mt-1 text-[10px] font-semibold text-violet-600 truncate">
                        {item.platformName || 'Web'}
                      </p>
                    </div>
                  </button>
                  <div className="px-2.5 pb-2.5 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => onPick?.(item)}
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-violet-50 hover:bg-slate-200 text-slate-600 text-[11px] font-bold py-1.5"
                    >
                      <Play size={12} /> Play
                    </button>
                    <button
                      type="button"
                      onClick={() => onDownload?.(item)}
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-500 shadow-[0_0_16px_rgba(124,58,237,0.35)] text-white text-[11px] font-bold py-1.5"
                    >
                      <Download size={12} /> Download
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SearchAnythingModal;

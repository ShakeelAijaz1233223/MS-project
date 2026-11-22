import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, ShieldAlert, ArrowUpRight, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PlatformIcon } from '../icons/PlatformIcon';
import { CapabilityBadge } from './CapabilityBadge';

// Capability badges come from the `capability` field on each platform object
// (backend bootstrap -> platformDefinitions.js). See
// components/downloader/CapabilityBadge.jsx for the honest mapping + fallback:
// missing/unknown capability is shown as "Sniffer", never "Dedicated".

export function SupportedSitesSection({ onPickPlatform, initialCategory = 'all', showAllByDefault = false }) {
  const { platforms } = useApp();
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [filterText, setFilterText] = useState('');
  const [expanded, setExpanded] = useState(showAllByDefault);
  // 18+ gate (ADULT_GATE): adult cards stay hidden until the user explicitly
  // confirms they are 18+. Confirmation is stored locally only.
  const [adultConfirmed, setAdultConfirmed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('ud_adult_confirmed') === '1'
  );
  const [showAdultDialog, setShowAdultDialog] = useState(false);
  const confirmAdult = () => {
    try { localStorage.setItem('ud_adult_confirmed', '1'); } catch {}
    setAdultConfirmed(true);
    setShowAdultDialog(false);
  };
  const adultTotal = useMemo(() => platforms.filter((x) => x.isAdult || x.category === 'adult' || x.category === 'adult_18').length, [platforms]);

  const counts = useMemo(() => {
    const map = { all: 0, social: 0, video: 0, education: 0, cloud_terabox: 0, web: 0, adult: 0 };
    for (const p of platforms) {
      const isAdult = p.isAdult || p.category === 'adult' || p.category === 'adult_18';
      if (isAdult) { map.adult += 1; if (!adultConfirmed) continue; }
      map.all += 1;
      if (map[p.category] !== undefined) map[p.category] += 1;
    }
    return map;
  }, [platforms, adultConfirmed]);

  const categories = useMemo(() => {
    const base = [
      { id: 'all', label: 'All Mainstream', count: counts.all },
      { id: 'social', label: 'Social Media', count: counts.social },
      { id: 'video', label: 'Streaming · Video · Music', count: counts.video },
      { id: 'education', label: 'Courses & Learning', count: counts.education },
      { id: 'cloud_terabox', label: 'TeraBox & Cloud', count: counts.cloud_terabox },
      { id: 'web', label: 'AI · Search · Shopping · Dev', count: counts.web },
      ...(adultConfirmed ? [{ id: 'adult', label: 'Adult 18+', count: counts.adult }] : []),
    ];
    return base.filter((c) => c.id === 'all' || c.count > 0);
  }, [counts]);

  const filteredPlatforms = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return platforms.filter((p) => {
      const isAdult = p.isAdult || p.category === 'adult' || p.category === 'adult_18';
      if (isAdult && !adultConfirmed) return false; // 18+ gate: hidden until confirmed
      if (activeCategory !== 'all' && p.category !== activeCategory) {
        return false;
      }

      if (!q) return true;
      return (
        p.displayName?.toLowerCase().includes(q) ||
        p.subtitle?.toLowerCase().includes(q) ||
        (p.domains || []).some((d) => String(d).toLowerCase().includes(q))
      );
    });
  }, [platforms, activeCategory, filterText, adultConfirmed]);

  const visiblePlatforms = expanded || filterText.trim() ? filteredPlatforms : filteredPlatforms.slice(0, 60);

  return (
    <section className="w-full bg-white border-b border-violet-200 py-14">
      <div className="w-full px-4 sm:px-8 xl:px-12">
        {/* FULL-WIDTH CLEAR HEADER ROW (100% Fixed Layout — Zero Column Squish!) */}
        <div className="w-full flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-7">
          <div className="flex-1 min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 border border-violet-300 px-3.5 py-1 text-xs font-bold text-violet-700 mb-3">
              <Sparkles size={13} />
              <span>{platforms.length} Live Multi-Engine Adapters · Zero Paid Keys</span>
            </span>

            <h2 className="font-display text-2xl sm:text-3xl xl:text-4xl font-extrabold tracking-tight text-slate-900">
              Supported Websites —{' '}
              <span className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent">
                Social, Movies, Courses &amp; TeraBox
              </span>
            </h2>

            <p className="mt-2 text-sm sm:text-base text-slate-500 max-w-4xl leading-relaxed">
              Click any website card below to load its extractor, online browser player, and{' '}
              <strong className="text-slate-900">fast one-click download engine</strong> instantly.
              Badges are honest: <strong className="text-violet-700">Dedicated</strong> means the
              site has its own resolver, <strong className="text-slate-600">Sniffer</strong>{' '}
              means the universal page sniffer finds the stream, and{' '}
              <strong className="text-pink-600">Metadata only</strong> means no downloadable
              stream is exposed.
            </p>
          </div>

          {/* Wide Right Search Box */}
          <div className="w-full lg:w-[420px] shrink-0">
            <div className="flex items-center gap-2.5 rounded-2xl bg-white border border-slate-200 focus-within:border-violet-500 px-4 py-3 shadow-[0_0_20px_rgba(124,58,237,0.10)]">
              <Search size={17} className="text-violet-600 shrink-0" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder={`Search ${platforms.length} supported sites (YouTube, Udemy, TeraBox, GitHub…)`}
                className="w-full bg-transparent text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none"
              />
              {filterText && (
                <button
                  type="button"
                  onClick={() => setFilterText('')}
                  className="text-xs font-bold text-slate-500 hover:text-slate-900"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 18+ ADULT GATE — Neon Dark styling, same colours/layout */}
        {adultTotal > 0 && !adultConfirmed && (
          <div className="mb-6 rounded-2xl bg-white border border-pink-300 px-4 py-3 flex flex-wrap items-center gap-3">
            <ShieldAlert size={18} className="text-pink-600 shrink-0" />
            <p className="text-xs sm:text-sm text-slate-600 flex-1 min-w-[220px]">
              <strong className="text-slate-900">Adult 18+ ({adultTotal} sites)</strong> — hidden until you confirm you are 18 or older.
            </p>
            <button type="button" onClick={() => setShowAdultDialog(true)} className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 shadow-[0_0_16px_rgba(124,58,237,0.35)]">I am 18+ — Show adult sites</button>
          </div>
        )}
        {showAdultDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-md rounded-2xl bg-white border border-pink-300 p-6 shadow-[0_0_40px_rgba(236,72,153,0.25)]">
              <h3 className="text-lg font-extrabold text-slate-900">Are you 18 or older?</h3>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed">Adult (18+) sites will be shown and labelled 18+. By confirming, you state you are of legal age in your country to view adult content.</p>
              <div className="mt-5 flex gap-3">
                <button type="button" onClick={confirmAdult} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500">Yes, I am 18+</button>
                <button type="button" onClick={() => setShowAdultDialog(false)} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-violet-50 border border-slate-200">No, keep hidden</button>
              </div>
            </div>
          </div>
        )}

        {/* FULL-WIDTH FRAMER MOTION CATEGORY TABS */}
        <div className="flex flex-wrap items-center gap-2 mb-7">
          {categories.map((cat) => {
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setActiveCategory(cat.id);
                  setExpanded(showAllByDefault);
                }}
                className={`relative px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-colors border ${
                  active
                    ? 'text-white border-transparent bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 shadow-[0_0_16px_rgba(124,58,237,0.35)]'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-violet-400 hover:text-violet-700'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="activeWhiteCategoryTab"
                    transition={{ type: 'spring', stiffness: 460, damping: 35 }}
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 -z-0"
                  />
                )}
                <span className="relative z-10">{cat.label}</span>
                <span
                  className={`relative z-10 rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                    active ? 'bg-white/25 text-white' : 'bg-violet-50 text-slate-500'
                  }`}
                >
                  {cat.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Loading skeleton while the bootstrap catalogue is still arriving */}
        {platforms.length === 0 ? (
          <div
            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3.5"
            aria-label="Loading supported sites"
          >
            {Array.from({ length: 16 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="animate-pulse bg-violet-100 h-8 w-8 rounded-lg" />
                  <div className="animate-pulse bg-violet-100 h-4 w-14 rounded-full" />
                </div>
                <div className="animate-pulse bg-violet-100 h-3.5 w-3/4 rounded" />
                <div className="animate-pulse bg-violet-100 h-3 w-full rounded" />
                <div className="animate-pulse bg-violet-100 h-3 w-1/2 rounded" />
              </div>
            ))}
          </div>
        ) : (
        <>
            {/* ULTRA-SMOOTH 120 FPS FULL-WIDTH 8-COLUMN WHITE TAILWIND GRID */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3.5">
              {visiblePlatforms.map((plat) => (
                <div
                  key={plat.id}
                  onClick={() => {
                    onPickPlatform?.(plat);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="group cursor-pointer bg-white border border-slate-200 hover:border-violet-400 rounded-2xl p-4 shadow-sm hover:shadow-[0_0_24px_rgba(124,58,237,0.20)] transition-all duration-150 hover:-translate-y-0.5 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <PlatformIcon platform={plat} size={34} />
                      <CapabilityBadge
                        capability={plat.capability}
                        isAdult={plat.isAdult || plat.category === 'adult'}
                      />
                    </div>

                    <h3 className="text-sm font-extrabold text-slate-900 group-hover:text-violet-700 transition-colors truncate">
                      {plat.displayName}
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2 leading-snug">
                      {plat.subtitle}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px] font-bold">
                    <span className="text-slate-500 truncate max-w-[115px]">
                      {(plat.domains && plat.domains[0]) || 'direct-stream'}
                    </span>
                    <Link
                      to={`/tools/${plat.seoSlug}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-0.5 text-violet-700 hover:text-violet-700 shrink-0"
                    >
                      <span>Open</span>
                      <ArrowUpRight size={12} />
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            {/* Search no-results empty state */}
            {filteredPlatforms.length === 0 && (
              <div className="rounded-2xl bg-white border border-violet-200 p-10 text-center space-y-3">
                <Search size={28} className="mx-auto text-violet-600" />
                <h3 className="text-base font-extrabold text-slate-900">No sites match “{filterText}”</h3>
                <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
                  Try a different spelling or a domain (e.g. youtube.com). Any other website is
                  still accepted by the universal engine — paste its link at the top of the page.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFilterText('');
                    setActiveCategory('all');
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 px-5 py-2.5 text-xs font-extrabold text-white shadow-[0_0_16px_rgba(124,58,237,0.35)]"
                >
                  Clear search &amp; show all sites
                </button>
              </div>
            )}

            {filteredPlatforms.length > visiblePlatforms.length && (
              <div className="mt-8 text-center">
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-white hover:bg-violet-100 border border-slate-200 hover:border-violet-400 px-6 py-3 text-xs sm:text-sm font-extrabold text-slate-700 shadow-sm transition-colors"
                >
                  <span>
                    Show All {filteredPlatforms.length} Platforms in This Tab (+
                    {filteredPlatforms.length - visiblePlatforms.length} More)
                  </span>
                </button>
              </div>
            )}
        </>
        )}
      </div>
    </section>
  );
}

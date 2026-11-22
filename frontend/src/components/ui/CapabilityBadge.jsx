import React from 'react';
import { CheckCircle2, Radar, FileSearch } from 'lucide-react';

// ============================================================================
// Per-platform capability badges — HONEST labels only.
// Source of truth: the `capability` field the backend sends per platform
// (bootstrap -> boot.platforms, built in backend/src/data/platformDefinitions.js
// and passed through by getActivePlatformsFromDb, which spreads the
// definition object). Values the backend uses today:
//   'direct'          — platform has a direct resolver (default for the
//                       mainstream catalogue); shown as "Dedicated".
//   'dedicated'       — explicit dedicated extractor (backend rename of
//                       'direct'); shown as "Dedicated".
//   'generic_sniffer' — no dedicated resolver; the universal page sniffer
//                       finds whatever stream the page exposes (all 48 adult
//                       platforms today); shown as "Sniffer".
//   'metadata_only'   — only title/thumbnail metadata is exposed, no
//                       downloadable stream; shown as "Metadata only".
// Anything missing or unknown falls back to 'generic_sniffer' — never
// invent "Dedicated" for a platform without a resolver.
// ============================================================================

export const CAPABILITY_VALUES = ['dedicated', 'generic_sniffer', 'metadata_only'];

export function normalizeCapability(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'dedicated' || value === 'direct') return 'dedicated';
  if (value === 'metadata_only' || value === 'metadata-only' || value === 'metadata') {
    return 'metadata_only';
  }
  // 'generic_sniffer', missing, or anything unknown: honest sniffer fallback.
  return 'generic_sniffer';
}

export const CAPABILITY_META = {
  dedicated: {
    label: 'Dedicated',
    title: 'Dedicated extractor — this platform has its own resolver.',
    icon: CheckCircle2,
    className:
      'bg-violet-600/10 border-violet-300 text-violet-700',
  },
  generic_sniffer: {
    label: 'Sniffer',
    title: 'Universal sniffer — the page is scanned for whatever stream it exposes.',
    icon: Radar,
    className:
      'bg-white border-violet-200 text-slate-500',
  },
  metadata_only: {
    label: 'Metadata only',
    title: 'Metadata only — title and thumbnail are shown, no downloadable stream.',
    icon: FileSearch,
    className:
      'bg-pink-500/10 border-pink-300 text-pink-600',
  },
};

export function CapabilityBadge({ capability, isAdult = false, className = '' }) {
  const key = normalizeCapability(capability);
  const meta = CAPABILITY_META[key];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.className} ${className}`}
      title={meta.title}
    >
      <Icon size={10} />
      <span>{isAdult ? `18+ · ${meta.label}` : meta.label}</span>
    </span>
  );
}

export default CapabilityBadge;

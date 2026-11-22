import React, { useState, useEffect } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import { ChevronDown, CheckCircle2, AlertTriangle, Info, Zap } from 'lucide-react';

// Purple White ambient backdrop: soft purple/pink glow orbs over the
// white page (GPU-only, zero scroll lag). No grid lines, no cyan.
// Kept the old export name so existing imports keep working.
export function NeonGridBackdrop() {
  const reduce = useReducedMotion();
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-[560px] overflow-hidden -z-10 select-none"
    >
      <div className="neon-grid-bg absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      {!reduce && (
        <>
          <motion.div
            animate={{ x: [0, 48, 0], y: [0, -24, 0] }}
            transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
            className="will-change-transform absolute -top-28 -left-20 h-96 w-96 rounded-full bg-violet-400/25 blur-3xl"
          />
          <motion.div
            animate={{ x: [0, -52, 0], y: [0, 28, 0] }}
            transition={{ duration: 19, repeat: Infinity, ease: 'easeInOut' }}
            className="will-change-transform absolute -top-20 right-0 h-96 w-96 rounded-full bg-pink-400/20 blur-3xl"
          />
          <motion.div
            animate={{ x: [0, 32, 0], y: [0, 20, 0] }}
            transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
            className="will-change-transform absolute top-32 left-1/3 h-72 w-72 rounded-full bg-purple-400/20 blur-3xl"
          />
        </>
      )}
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-transparent to-transparent" />
    </div>
  );
}

// Kept the old export name so existing imports keep working.
export const AnimatedWhiteBackdrop = NeonGridBackdrop;

// Animated reload splash (Purple White). Exported for Team B / main use —
// it is NOT mounted globally here. Usage:
//   const [showSplash, setShowSplash] = useState(true);
//   <SplashScreen visible={showSplash} onComplete={() => setShowSplash(false)} />
// Props: visible (default true) — when it flips to false the splash fades
// out; progress (0-100) — when omitted the bar animates itself 0→100 over
// `duration` ms (default 1600); onComplete — called once when the bar
// finishes (only when progress is uncontrolled); message — small caption
// under the logo (default 'Loading UltraDownloader…').
export function SplashScreen({ visible = true, progress, duration = 1600, onComplete, message = 'Loading UltraDownloader…' }) {
  const reduce = useReducedMotion();
  const [internalProgress, setInternalProgress] = useState(0);
  const controlled = typeof progress === 'number';
  const shown = controlled ? Math.max(0, Math.min(100, progress)) : internalProgress;

  useEffect(() => {
    if (controlled || !visible) return undefined;
    if (reduce) {
      setInternalProgress(100);
      return undefined;
    }
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setInternalProgress(Math.round(t * 100));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else if (onComplete) {
        onComplete();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled, visible, duration, reduce]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="ud-splash"
          role="status"
          aria-label="Loading UltraDownloader"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5 bg-white px-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col items-center gap-4"
          >
            <span className="h-16 w-16 rounded-3xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-pink-500 text-white flex items-center justify-center shadow-[0_12px_32px_rgba(124,58,237,0.4)]">
              <Zap size={32} strokeWidth={2.5} />
            </span>
            <div className="text-center leading-tight">
              <p className="font-display font-extrabold text-2xl text-slate-900 tracking-tight">
                Ultra<span className="ud-gradient-text">Downloader</span>
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500">{message}</p>
            </div>
          </motion.div>
          <div className="w-48 sm:w-56 h-1.5 rounded-full bg-purple-100 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500"
              animate={{ width: `${shown}%` }}
              transition={controlled ? { duration: 0.25 } : { duration: 0.1, ease: 'linear' }}
              style={{ width: `${shown}%` }}
            />
          </div>
          <p className="text-[11px] font-bold text-violet-600 tabular-nums">{shown}%</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Alias export — same component, reload-splash naming.
export const ReloadSplash = SplashScreen;

export function MotionReveal({ children, delay = 0, className = '' }) {
  const shouldReduce = useReducedMotion();
  if (shouldReduce) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.08 }}
      transition={{ duration: 0.3, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`will-change-transform ${className}`}
    >
      {children}
    </motion.div>
  );
}

export function SectionHeading({ eyebrow, title, highlight, subtitle, align = 'left' }) {
  const center = align === 'center';
  return (
    <div className={`mb-6 ${center ? 'text-center mx-auto max-w-4xl' : 'w-full'}`}>
      {eyebrow && (
        <span className="neon-chip inline-flex items-center gap-1.5 px-3.5 py-1 text-xs font-bold tracking-wide text-violet-700 mb-3">
          {eyebrow}
        </span>
      )}
      <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight break-words">
        {title}{' '}
        {highlight && (
          <span className="ud-gradient-text neon-text-glow">
            {highlight}
          </span>
        )}
      </h2>
      {subtitle && (
        <p className={`mt-2 text-sm sm:text-base text-slate-500 leading-relaxed ${center ? 'mx-auto max-w-3xl' : 'max-w-4xl'}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

export function AccordionItem({ question, answer, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="neon-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left text-sm sm:text-base font-bold text-slate-900 hover:bg-purple-50 transition-colors"
      >
        <span className="min-w-0 break-words">{question}</span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-violet-600 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-5 pb-4 pt-2 text-sm text-slate-500 border-t border-purple-200 leading-relaxed">
              {answer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ToastNotification({ toast }) {
  if (!toast) return null;
  const Icon =
    toast.tone === 'error' ? AlertTriangle : toast.tone === 'success' ? CheckCircle2 : Info;
  const ring =
    toast.tone === 'error'
      ? 'border-rose-300 bg-white/95 text-rose-600 shadow-[0_8px_24px_rgba(244,63,94,0.18)]'
      : toast.tone === 'success'
      ? 'border-emerald-300 bg-white/95 text-emerald-700 shadow-[0_8px_24px_rgba(52,211,153,0.18)]'
      : 'border-violet-300 bg-white/95 text-violet-700 shadow-[0_8px_24px_rgba(124,58,237,0.18)]';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      role="status"
      aria-live="polite"
      className={`fixed bottom-5 right-5 z-[95] flex items-center gap-2.5 rounded-xl border px-4 py-3 text-xs sm:text-sm font-semibold shadow-xl backdrop-blur-md max-w-[calc(100vw-2.5rem)] ${ring}`}
    >
      <Icon size={17} className="shrink-0" />
      <span className="break-words">{toast.message}</span>
    </motion.div>
  );
}

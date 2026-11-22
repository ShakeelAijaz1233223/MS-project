import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { AppProvider } from '../context/AppContext';
import { Navbar } from '../components/layout/Navbar';
import {
  CapabilityBadge,
  normalizeCapability,
  CAPABILITY_META,
} from '../components/ui/CapabilityBadge';

describe('Purple White polish — capability badges', () => {
  it('normalizes every backend capability value honestly', () => {
    // Backend values today: 'direct' (default) and 'generic_sniffer';
    // the backend is renaming 'direct' -> 'dedicated' and may add
    // 'metadata_only'. All must map; nothing may invent "Dedicated".
    expect(normalizeCapability('dedicated')).toBe('dedicated');
    expect(normalizeCapability('direct')).toBe('dedicated');
    expect(normalizeCapability('generic_sniffer')).toBe('generic_sniffer');
    expect(normalizeCapability('metadata_only')).toBe('metadata_only');
    expect(normalizeCapability(undefined)).toBe('generic_sniffer');
    expect(normalizeCapability('')).toBe('generic_sniffer');
    expect(normalizeCapability('something-new')).toBe('generic_sniffer');
    expect(CAPABILITY_META.dedicated.label).toBe('Dedicated');
    expect(CAPABILITY_META.generic_sniffer.label).toBe('Sniffer');
    expect(CAPABILITY_META.metadata_only.label).toBe('Metadata only');
  });

  it('renders the three honest badge labels with the right colours', () => {
    const { rerender } = render(<CapabilityBadge capability="dedicated" />);
    expect(screen.getByText('Dedicated')).toBeInTheDocument();
    // Colour classes live on the badge wrapper (the parent span).
    expect(screen.getByText('Dedicated').parentElement.className).toMatch(/text-violet-700/);

    rerender(<CapabilityBadge capability="generic_sniffer" />);
    expect(screen.getByText('Sniffer')).toBeInTheDocument();
    expect(screen.getByText('Sniffer').parentElement.className).toMatch(/text-slate-500/);

    rerender(<CapabilityBadge capability="metadata_only" />);
    expect(screen.getByText('Metadata only')).toBeInTheDocument();
    expect(screen.getByText('Metadata only').parentElement.className).toMatch(/text-pink-600/);

    // Missing capability falls back to Sniffer — never Dedicated.
    rerender(<CapabilityBadge />);
    expect(screen.getByText('Sniffer')).toBeInTheDocument();
    expect(screen.queryByText('Dedicated')).not.toBeInTheDocument();

    rerender(<CapabilityBadge capability="generic_sniffer" isAdult />);
    expect(screen.getByText('18+ · Sniffer')).toBeInTheDocument();
  });
});

describe('Purple White polish — single theme only, no theme toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    cleanup();
  });

  function renderNavbar() {
    return render(
      <MemoryRouter>
        <AppProvider>
          <Navbar />
        </AppProvider>
      </MemoryRouter>
    );
  }

  it('is always Purple White: <html data-theme> is light and there is no theme toggle', async () => {
    renderNavbar();
    // No theme toggle button exists in the single-theme build.
    expect(screen.queryByTestId('theme-toggle')).not.toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('ignores a saved dark theme on load (light stays light)', async () => {
    localStorage.setItem('ud_theme', 'dark');
    renderNavbar();
    expect(screen.queryByTestId('theme-toggle')).not.toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

describe('Purple White polish — page roots are white on every route', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  const routes = [
    '/',
    '/sites',
    '/player',
    '/albums',
    '/downloads',
    '/favorites',
    '/settings',
    '/login',
    '/register',
    '/legal/privacy',
    '/legal/terms',
    '/tools/youtube-video-downloader',
    '/v/abc123',
    '/admin',
    '/wp-admin',
    '/nonexistent-page-xyz',
  ];

  it.each(routes)('route %s renders a Purple White page root (no dark surface)', (route) => {
    window.history.pushState({}, '', route);
    render(<App />);

    const roots = Array.from(document.querySelectorAll('.min-h-screen'));
    expect(roots.length).toBeGreaterThan(0);
    for (const root of roots) {
      const cls = root.classList;
      expect(
        cls.contains('bg-[#05070f]') || cls.contains('bg-[#070B14]') || cls.contains('bg-slate-950'),
        `${route}: page root is dark`
      ).toBe(false);
    }

    // No dark page surface anywhere on the page either
    // (video stages and modal scrims are intentionally dark and are
    // excluded here by their own classes, not by page roots).
    const darkSurfaces = Array.from(document.querySelectorAll('*')).filter(
      (el) =>
        el.classList &&
        (el.classList.contains('bg-[#05070f]') || el.classList.contains('bg-[#070B14]')) &&
        !['BUTTON', 'A'].includes(el.tagName)
    );
    expect(darkSurfaces, `${route}: dark surfaces`).toHaveLength(0);
  });
});

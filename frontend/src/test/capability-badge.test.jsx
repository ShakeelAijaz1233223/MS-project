import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock the app context so the section gets a fixed platform catalogue
// (the real provider would call the live backend bootstrap).
vi.mock('../context/AppContext', () => ({
  useApp: () => ({
    platforms: [
      {
        id: 'youtube',
        displayName: 'YouTube',
        subtitle: '4K/8K video, Shorts, Live, MP3',
        category: 'social',
        accentColor: '#8B5CF6',
        iconKey: 'globe',
        domains: ['youtube.com', 'youtu.be'],
        seoSlug: 'youtube-4k-video-mp3-downloader',
        isAdult: false,
        capability: 'dedicated',
      },
      {
        id: 'somestream',
        displayName: 'SomeStream',
        subtitle: 'Random video pages',
        category: 'video',
        accentColor: '#22D3EE',
        iconKey: 'globe',
        domains: ['somestream.example'],
        seoSlug: 'somestream-video-downloader',
        isAdult: false,
        capability: 'generic_sniffer',
      },
      {
        id: 'metahost',
        displayName: 'MetaHost',
        subtitle: 'Titles and thumbnails only',
        category: 'web',
        accentColor: '#EC4899',
        iconKey: 'globe',
        domains: ['metahost.example'],
        seoSlug: 'metahost-video-downloader',
        isAdult: false,
        capability: 'metadata_only',
      },
      {
        id: 'mystery',
        displayName: 'MysteryTube',
        subtitle: 'No capability field at all',
        category: 'video',
        accentColor: '#22D3EE',
        iconKey: 'globe',
        domains: ['mystery.example'],
        seoSlug: 'mystery-video-downloader',
        isAdult: false,
      },
      {
        id: 'pornhub',
        displayName: 'Pornhub',
        subtitle: '18+ adult tube',
        category: 'adult',
        accentColor: '#DB2777',
        iconKey: 'globe',
        domains: ['pornhub.com'],
        seoSlug: 'pornhub-video-downloader',
        isAdult: true,
        capability: 'generic_sniffer',
      },
    ],
  }),
}));

import { SupportedSitesSection } from '../components/downloader/SupportedSitesSection';

describe('SupportedSitesSection — honest capability badges', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows Dedicated / Sniffer / Metadata only from the backend capability field', () => {
    render(
      <MemoryRouter>
        <SupportedSitesSection showAllByDefault />
      </MemoryRouter>
    );

    // The intro copy also names each label once; badges add one each.
    expect(screen.getAllByText('Dedicated')).toHaveLength(2); // intro + YouTube badge
    // MysteryTube has no capability -> honest Sniffer fallback, never Dedicated.
    expect(screen.getAllByText('Sniffer')).toHaveLength(3); // intro + SomeStream + MysteryTube
    expect(screen.getAllByText('Metadata only')).toHaveLength(2); // intro + MetaHost badge
    // Adult platforms stay hidden behind the 18+ gate by default.
    expect(screen.queryByText('Pornhub')).not.toBeInTheDocument();
  });

  it('shows a no-results empty state with a clear-search action', () => {
    render(
      <MemoryRouter>
        <SupportedSitesSection showAllByDefault />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/Search 5 supported sites/i);
    fireEvent.change(input, { target: { value: 'zzzz-no-such-site' } });

    expect(screen.getByText(/No sites match/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Clear search & show all sites/i));
    expect(screen.getByText('YouTube')).toBeInTheDocument();
  });
});

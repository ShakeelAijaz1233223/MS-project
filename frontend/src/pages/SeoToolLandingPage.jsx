import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AnnouncementBar } from '../components/layout/AnnouncementBar';
import { Navbar } from '../components/layout/Navbar';
import { Footer } from '../components/layout/Footer';
import { HeroSmartAnalyzer } from '../components/downloader/HeroSmartAnalyzer';
import { SupportedSitesSection } from '../components/downloader/SupportedSitesSection';
import { CapabilityBadge, normalizeCapability } from '../components/downloader/CapabilityBadge';
import { useApp } from '../context/AppContext';
import { UltraApi } from '../services/apiClient';

export function SeoToolLandingPage() {
  const { slug } = useParams();
  const { platforms } = useApp();
  const [serverSeoMeta, setServerSeoMeta] = useState(null);

  useEffect(() => {
    let active = true;
    UltraApi.getSeoLanding(slug)
      .then((res) => {
        if (active) setServerSeoMeta(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [slug]);

  const matchedPlatform =
    serverSeoMeta?.platform ||
    platforms.find((p) => p.seoSlug === slug) || {
      id: 'universal_web',
      displayName: (slug || 'video-downloader')
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      subtitle: 'Online Player & Fast One-Click Downloader',
      category: 'video',
      seoSlug: slug,
      exampleUrl: '',
    };

  const capability = normalizeCapability(
    matchedPlatform.capability ?? serverSeoMeta?.platform?.capability
  );

  useEffect(() => {
    const pageTitle =
      serverSeoMeta?.metaTitle ||
      `${matchedPlatform.displayName} Online Player & HD Video Downloader — UltraDownloader`;
    document.title = pageTitle;

    let scriptTag = document.getElementById('ud-jsonld-seo');
    if (!scriptTag) {
      scriptTag = document.createElement('script');
      scriptTag.id = 'ud-jsonld-seo';
      scriptTag.type = 'application/ld+json';
      document.head.appendChild(scriptTag);
    }
    scriptTag.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: `${matchedPlatform.displayName} Video Player & Downloader`,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Web, Android, iOS, Windows, macOS',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    });

    return () => {
      document.title = 'UltraDownloader — Watch & Download Videos Online';
    };
  }, [matchedPlatform, serverSeoMeta]);

  return (
    <div className="min-h-screen w-full overflow-x-clip bg-white text-slate-900 flex flex-col">
      <AnnouncementBar />
      <Navbar />
      <main className="flex-1 w-full">
        <div className="w-full px-4 sm:px-8 xl:px-12 pt-5">
          <div className="rounded-2xl bg-white border border-violet-200 px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm shadow-[0_0_20px_rgba(124,58,237,0.08)]">
            <span className="font-bold text-slate-700 flex flex-wrap items-center gap-2">
              <span>
                {capability === 'dedicated' ? 'Dedicated Live Extractor Ready' : 'Live Extractor Ready'}
                : {matchedPlatform.displayName} ({matchedPlatform.subtitle})
              </span>
              <CapabilityBadge capability={capability} />
            </span>
            <Link to="/" className="text-violet-600 underline font-extrabold whitespace-nowrap">
              Switch to Universal 120+ Sites Mode →
            </Link>
          </div>
        </div>

        <HeroSmartAnalyzer presetPlatform={matchedPlatform} />
        <SupportedSitesSection />
      </main>
      <Footer />
    </div>
  );
}

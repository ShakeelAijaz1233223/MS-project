import dns from 'node:dns/promises';
import net from 'node:net';
import { AppError } from '../utils/errors.js';
import { runtimeEnginePreferences } from '../services/trafficEngine.js';

const FORBIDDEN_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  '::1',
  '[::1]',
  '169.254.169.254',
  '169.254.170.2',
  'metadata.google.internal',
  'metadata.internal',
  'instance-data',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

const DRM_SUBSCRIPTION_DOMAINS = [
  'netflix.com',
  'primevideo.com',
  'disneyplus.com',
  'hulu.com',
  'max.com',
  'hbomax.com',
  'tv.apple.com',
  'peacocktv.com',
];

const dohCache = new Map();
const verifiedHostIpCache = new Map();
let testFixturePort = 0;

export function registerTestFixtureServer(port = 0) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('registerTestFixtureServer is restricted to NODE_ENV=test');
  }
  testFixturePort = Number(port) || 0;
  verifiedHostIpCache.clear();
}

export async function resolvePublicIpViaDoH(hostname) {
  const cached = dohCache.get(hostname);
  if (cached && cached.exp > Date.now()) return cached.ips;

  const endpoints =
    runtimeEnginePreferences.dohProvider === 'google'
      ? [
          `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
        ]
      : [
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
          `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
        ];

  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(4000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const ips = (j.Answer || [])
        .filter((a) => a.type === 1 && net.isIPv4(a.data) && !isPrivateOrReservedIp(a.data))
        .map((a) => a.data);
      if (ips.length > 0) {
        dohCache.set(hostname, { ips, exp: Date.now() + 5 * 60 * 1000 });
        return ips;
      }
    } catch {
      // try fallback DoH resolver
    }
  }
  return [];
}

export function isPrivateOrReservedIp(ip) {
  if (!ip) return true;
  const clean = String(ip).replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();

  if (clean.startsWith('::ffff:')) {
    return isPrivateOrReservedIp(clean.slice(7));
  }

  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map(Number);
    const [a, b, c] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF / TEST-NET-1
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
    if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }

  if (net.isIPv6(clean)) {
    if (clean === '::' || clean === '::1') return true;
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true; // Unique local fc00::/7
    if (clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb')) {
      return true; // Link-local fe80::/10
    }
    if (clean.startsWith('ff')) return true; // Multicast
    if (clean.startsWith('2001:db8:')) return true; // Documentation range
    return false;
  }

  return true;
}

// Auto-heal common WhatsApp/Telegram copy-paste domain typos
export function normalizeCommonMirrorTypos(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  return rawUrl
    .trim()
    .replace(/^(https?:\/\/)ww\.mirrobox\.com\b/i, '$1www.mirrobox.com')
    .replace(/^(https?:\/\/)(?:www\.)?terabox\.ap(?=\/|$|\?)/i, '$1www.terabox.app')
    .replace(/^(https?:\/\/)(?:www\.)?1024tera\.co(?=\/|$|\?)/i, '$1www.1024tera.com')
    .replace(/^(https?:\/\/)(?:www\.)?4funbox\.co(?=\/|$|\?)/i, '$1www.4funbox.com');
}

// Synchronous Fast Layer-1 URL + Private CIDR + Honest Widevine DRM Check
export function validateSafeExternalUrlSync(rawUrl) {
  const healed = normalizeCommonMirrorTypos(rawUrl);
  if (!healed || typeof healed !== 'string' || healed.length > 4096) {
    throw new AppError(400, 'INVALID_URL', 'Please provide a valid HTTP or HTTPS video URL.');
  }

  let parsed;
  try {
    parsed = new URL(healed);
  } catch {
    throw new AppError(400, 'INVALID_URL', 'Malformed URL format. Ensure https:// is included.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new AppError(400, 'INVALID_URL', 'Only http:// and https:// URLs are permitted.');
  }

  if (parsed.username || parsed.password) {
    throw new AppError(400, 'SSRF_BLOCKED', 'Embedded credentials inside URLs are blocked for security.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    FORBIDDEN_HOSTNAMES.has(host) ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
    throw new AppError(
      403,
      'SSRF_BLOCKED',
      'Security Guard (Anti-SSRF): Localhost, internal hosts, and cloud metadata endpoints are strictly forbidden.'
    );
  }

  const bareHost = host.replace(/^\[|\]$/g, '');
  if (net.isIP(bareHost) && isPrivateOrReservedIp(bareHost)) {
    throw new AppError(
      403,
      'SSRF_BLOCKED',
      'Security Guard (Anti-SSRF): Private, loopback, and link-local IP ranges are strictly forbidden.'
    );
  }

  if (DRM_SUBSCRIPTION_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new AppError(
      422,
      'DRM_PROTECTED',
      'Encrypted Hardware DRM Stream (Widevine/PlayReady) — Subscription-encrypted streams cannot be extracted.'
    );
  }

  return parsed;
}

export function getPinnedVerifiedIp(hostname) {
  const clean = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  const cached = verifiedHostIpCache.get(clean);
  if (cached && cached.exp > Date.now()) return cached;
  return null;
}

// Asynchronous Layer-2 DNS-Rebinding Guard WITH Strict Failure Handling & Verified IP Pinning
export async function assertSafeOutboundUrl(rawUrl, { performDnsCheck = true } = {}) {
  const parsed = validateSafeExternalUrlSync(rawUrl);
  const bareHost = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (net.isIP(bareHost)) {
    if (isPrivateOrReservedIp(bareHost)) {
      throw new AppError(
        403,
        'SSRF_BLOCKED',
        'Security Guard (Anti-SSRF): Private, loopback, and link-local IP ranges are strictly forbidden.'
      );
    }
    parsed.verifiedAddress = bareHost;
    parsed.verifiedFamily = net.isIPv6(bareHost) ? 6 : 4;
    return parsed;
  }

  if (!performDnsCheck) {
    return parsed;
  }

  if (
    process.env.NODE_ENV === 'test' &&
    testFixturePort > 0 &&
    (bareHost === 'fixture.example' || bareHost.endsWith('.fixture.example'))
  ) {
    parsed.verifiedAddress = '127.0.0.1';
    parsed.verifiedFamily = 4;
    parsed.fixturePort = testFixturePort;
    return parsed;
  }

  const cached = getPinnedVerifiedIp(bareHost);
  if (cached) {
    parsed.verifiedAddress = cached.address;
    parsed.verifiedFamily = cached.family;
    return parsed;
  }

  let records = [];
  let lookupFailed = false;
  try {
    records = await dns.lookup(bareHost, { all: true });
  } catch {
    lookupFailed = true;
  }

  if (lookupFailed || records.length === 0) {
    if (runtimeEnginePreferences.dnsOverHttpsBypass && bareHost.includes('.')) {
      const dohIps = await resolvePublicIpViaDoH(bareHost);
      if (dohIps.length > 0) {
        const pinned = { address: dohIps[0], family: 4, exp: Date.now() + 60 * 1000 };
        verifiedHostIpCache.set(bareHost, pinned);
        parsed.verifiedAddress = pinned.address;
        parsed.verifiedFamily = 4;
        return parsed;
      }
    }
    throw new AppError(
      502,
      'DNS_RESOLUTION_FAILED',
      `Could not resolve host "${bareHost}" to a reachable public IP address.`
    );
  }

  const hasPrivate = records.some((rec) => isPrivateOrReservedIp(rec.address));
  if (hasPrivate) {
    // Check via Encrypted Cloudflare/Google DoH whether local ISP poisoned DNS to 127.0.0.1/0.0.0.0
    if (runtimeEnginePreferences.dnsOverHttpsBypass && bareHost.includes('.')) {
      const realGlobalIps = await resolvePublicIpViaDoH(bareHost);
      if (realGlobalIps.length > 0 && realGlobalIps.every((ip) => !isPrivateOrReservedIp(ip))) {
        const pinned = { address: realGlobalIps[0], family: 4, exp: Date.now() + 60 * 1000 };
        verifiedHostIpCache.set(bareHost, pinned);
        parsed.verifiedAddress = pinned.address;
        parsed.verifiedFamily = 4;
        return parsed;
      }
    }
    throw new AppError(
      403,
      'SSRF_BLOCKED',
      `DNS Rebinding Blocked: Host ${bareHost} resolved to private/internal IP.`
    );
  }

  const preferred = records.find((r) => r.family === 4) || records[0];
  const pinned = {
    address: preferred.address,
    family: preferred.family || 4,
    exp: Date.now() + 60 * 1000,
  };
  verifiedHostIpCache.set(bareHost, pinned);
  parsed.verifiedAddress = pinned.address;
  parsed.verifiedFamily = pinned.family;
  return parsed;
}

// Create a Node `http`/`https` lookup callback pinned to the verified public IP
export function createPinnedDnsLookup(verifiedAddress, verifiedFamily = 4) {
  return (_hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'object' && options !== null ? options : {};
    if (!verifiedAddress || isPrivateOrReservedIp(verifiedAddress)) {
      return cb(new Error('SSRF_BLOCKED: Unverified or private target IP'));
    }
    if (opts.all) {
      return cb(null, [{ address: verifiedAddress, family: verifiedFamily }]);
    }
    return cb(null, verifiedAddress, verifiedFamily);
  };
}

// Safe outbound fetch that validates initial URL AND re-validates every HTTP redirect hop
// before connecting to the redirect location (prevents 302 -> 127.0.0.1 / metadata SSRF).
export async function safeFetchWithRedirects(
  rawUrl,
  fetchInit = {},
  { maxRedirects = 5, performDnsCheck = true } = {}
) {
  let currentUrl = String(rawUrl || '').trim();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const safeParsed = await assertSafeOutboundUrl(currentUrl, { performDnsCheck });
    const fetchTarget =
      process.env.NODE_ENV === 'test' && safeParsed.fixturePort
        ? `http://127.0.0.1:${safeParsed.fixturePort}${safeParsed.pathname}${safeParsed.search}`
        : safeParsed.toString();
    const mergedHeaders =
      process.env.NODE_ENV === 'test' && safeParsed.fixturePort
        ? { ...(fetchInit.headers || {}), 'X-Fixture-Host': safeParsed.host }
        : fetchInit.headers;
    const response = await fetch(fetchTarget, {
      ...fetchInit,
      ...(mergedHeaders ? { headers: mergedHeaders } : {}),
      redirect: 'manual',
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      response.body?.cancel?.().catch?.(() => {});
      if (!location) {
        return response;
      }
      if (hop === maxRedirects) {
        throw new AppError(502, 'TOO_MANY_REDIRECTS', 'Upstream URL exceeded maximum safe redirect hops.');
      }
      currentUrl = new URL(location, safeParsed.toString()).toString();
      if (response.status === 303 && fetchInit.method && !['GET', 'HEAD'].includes(fetchInit.method)) {
        fetchInit = { ...fetchInit, method: 'GET', body: undefined };
      }
      continue;
    }

    return response;
  }

  throw new AppError(502, 'TOO_MANY_REDIRECTS', 'Upstream URL exceeded maximum safe redirect hops.');
}

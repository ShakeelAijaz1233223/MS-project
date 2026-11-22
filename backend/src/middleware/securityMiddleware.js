import { ENV } from '../config/env.js';
import { sqlQuery, writeSecurityAuditLog } from '../db/database.js';
import { AppError } from '../utils/errors.js';
import {
  verifyPadlockTicket,
  verifyAdminAccessToken,
  verifyUserAccessToken,
} from '../security/cryptoVault.js';

function normalizeIp(rawIp) {
  const clean = String(rawIp || '').trim();
  if (!clean) return '127.0.0.1';
  if (clean === '::1') return '127.0.0.1';
  if (clean.startsWith('::ffff:')) return clean.slice(7);
  return clean;
}

// Safely relies on Express `req.ip` (which only honors X-Forwarded-For from configured
// `trust proxy` peers such as loopback Nginx/Vite, preventing remote header spoofing).
export function resolveClientIp(req) {
  return normalizeIp(req.ip || req.socket?.remoteAddress || '127.0.0.1');
}

function extractAdminToken(req) {
  const headerVal = String(req.headers['x-admin-token'] || '');
  return (
    (headerVal.startsWith('Bearer ') ? headerVal.slice(7) : headerVal) ||
    req.cookies?.ud_admin_jwt ||
    req.query?.adminToken ||
    ''
  );
}

export function attachRequestContext(req, _res, next) {
  req.clientIp = resolveClientIp(req);
  req.websiteProjectId = String(req.headers['x-website-project-id'] || 'site_main_clean');

  // Optional public user JWT resolution
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.cookies?.ud_user_jwt;
  if (bearerToken) {
    try {
      req.user = verifyUserAccessToken(bearerToken);
    } catch {
      req.user = null;
    }
  }

  // Optional super-admin JWT resolution
  const adminToken = extractAdminToken(req);
  if (adminToken) {
    try {
      req.admin = verifyAdminAccessToken(adminToken);
    } catch {
      req.admin = null;
    }
  }

  next();
}

// Layer 2: Optional Admin IP Allowlist Guard
export function enforceAdminIpAllowlist(req, _res, next) {
  if (ENV.ADMIN_IP_ALLOWLIST.length === 0) return next();
  if (ENV.ADMIN_IP_ALLOWLIST.includes(req.clientIp)) return next();
  throw new AppError(403, 'IP_NOT_ALLOWLISTED', 'Access restricted by network IP policy.');
}

// ============================================================================
// LAYER 3: 3-WRONG-ATTEMPTS = AUTOMATIC 30-MINUTE SQL IP LOCKOUT!
// ============================================================================
export async function assertAdminIpNotBanned(ipAddress) {
  const rows = await sqlQuery('SELECT * FROM ip_lockouts WHERE ip_address = ?', [ipAddress]);
  const rec = rows[0];
  if (!rec || !rec.banned_until) return;

  const unlockMs = new Date(rec.banned_until).getTime();
  if (unlockMs > Date.now()) {
    const remainingSeconds = Math.ceil((unlockMs - Date.now()) / 1000);
    throw new AppError(
      429,
      'ADMIN_IP_BANNED_30M',
      `3 Wrong Attempts Detected — Access Locked for ${Math.ceil(remainingSeconds / 60)} Minutes!`,
      {
        unlocksAt: rec.banned_until,
        remainingSeconds,
      }
    );
  }

  // Expired ban -> clean reset
  await sqlQuery(
    'UPDATE ip_lockouts SET failed_attempts = 0, banned_until = NULL, updated_at = ? WHERE ip_address = ?',
    [new Date().toISOString(), ipAddress]
  );
}

export async function recordAdminFailureAndBanOnThirdStrike(ipAddress, userAgent, stage) {
  const rows = await sqlQuery('SELECT * FROM ip_lockouts WHERE ip_address = ?', [ipAddress]);
  const currentAttempts = (rows[0]?.failed_attempts || 0) + 1;
  const now = new Date().toISOString();

  if (currentAttempts >= ENV.ADMIN_MAX_FAILED_ATTEMPTS) {
    const bannedUntil = new Date(Date.now() + ENV.ADMIN_BAN_DURATION_MINUTES * 60 * 1000).toISOString();
    if (rows[0]) {
      await sqlQuery(
        'UPDATE ip_lockouts SET failed_attempts = ?, banned_until = ?, updated_at = ? WHERE ip_address = ?',
        [currentAttempts, bannedUntil, now, ipAddress]
      );
    } else {
      await sqlQuery(
        'INSERT INTO ip_lockouts (ip_address, failed_attempts, banned_until, updated_at) VALUES (?, ?, ?, ?)',
        [ipAddress, currentAttempts, bannedUntil, now]
      );
    }

    await writeSecurityAuditLog('ADMIN_IP_BANNED_30M', ipAddress, userAgent, {
      stage,
      attempts: currentAttempts,
      bannedUntil,
    });

    throw new AppError(
      429,
      'ADMIN_IP_BANNED_30M',
      `3 Wrong Attempts Detected — Access Locked for ${ENV.ADMIN_BAN_DURATION_MINUTES} Minutes & Logged to Security Audit!`,
      {
        unlocksAt: bannedUntil,
        remainingSeconds: ENV.ADMIN_BAN_DURATION_MINUTES * 60,
      }
    );
  }

  if (rows[0]) {
    await sqlQuery(
      'UPDATE ip_lockouts SET failed_attempts = ?, updated_at = ? WHERE ip_address = ?',
      [currentAttempts, now, ipAddress]
    );
  } else {
    await sqlQuery(
      'INSERT INTO ip_lockouts (ip_address, failed_attempts, banned_until, updated_at) VALUES (?, ?, NULL, ?)',
      [ipAddress, currentAttempts, now]
    );
  }

  const remaining = ENV.ADMIN_MAX_FAILED_ATTEMPTS - currentAttempts;
  await writeSecurityAuditLog('ADMIN_AUTH_FAILED', ipAddress, userAgent, {
    stage,
    attemptsRemaining: remaining,
  });

  throw new AppError(
    401,
    'UNAUTHORIZED',
    `Invalid credentials (${remaining} attempt${remaining === 1 ? '' : 's'} remaining before 30-min IP lock).`,
    { attemptsRemaining: remaining }
  );
}

export async function clearAdminIpLockout(ipAddress) {
  await sqlQuery(
    'DELETE FROM ip_lockouts WHERE ip_address = ?',
    [ipAddress]
  );
}

// Require Gate-1 Signed Padlock Ticket before Gate-2 Login can even run!
export function requirePadlockGate1Ticket(req, _res, next) {
  const rawTicket =
    req.headers['x-admin-padlock-ticket'] ||
    req.body?.padlockTicket ||
    req.cookies?.ud_padlock_ticket;

  if (!rawTicket) {
    throw new AppError(401, 'PADLOCK_REQUIRED', 'Gate-1 Digital Padlock PIN verification is required first.');
  }

  try {
    req.padlockClaims = verifyPadlockTicket(rawTicket);
    next();
  } catch {
    throw new AppError(401, 'PADLOCK_REQUIRED', 'Padlock ticket expired or invalid — re-enter PIN.');
  }
}

// Require Full Gate-1 + Gate-2 Signed Super-Admin JWT Token!
export function requireSuperAdminAuth(req, _res, next) {
  if (req.admin) return next();

  const rawToken = extractAdminToken(req);
  if (!rawToken) {
    throw new AppError(401, 'UNAUTHORIZED', 'Super-Admin authentication required.');
  }

  try {
    req.admin = verifyAdminAccessToken(rawToken);
    next();
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Super-Admin session expired or invalid.');
  }
}

export function requireRegisteredUser(req, _res, next) {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Please sign in to access saved account resources.');
  }
  next();
}

export function requireAdminOrRegisteredUser(req, _res, next) {
  if (req.admin || req.user) {
    return next();
  }
  throw new AppError(
    401,
    'AUTH_REQUIRED',
    'Authentication required. Please sign in to your account or authenticate as Super-Admin.'
  );
}

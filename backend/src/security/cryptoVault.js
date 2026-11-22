import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { ENV } from '../config/env.js';

function getMasterKeyBuffer() {
  const hex = String(ENV.AES_256_VAULT_KEY || '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, 'hex');
  }
  return crypto.createHash('sha256').update(hex).digest();
}

// ============================================================================
// REAL AES-256-GCM AUTHENTICATED ENCRYPTION FOR COOKIES VAULT (ZERO PLAINTEXT!)
// ============================================================================
export function encryptVaultSecret(plaintext) {
  const key = getMasterKeyBuffer();
  const iv = crypto.randomBytes(12); // Recommended 96-bit GCM IV
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ivHex: iv.toString('hex'),
    authTagHex: authTag.toString('hex'),
    ciphertextHex: encrypted.toString('hex'),
    maskedPreview: `AES256-GCM::${encrypted.toString('hex').slice(0, 18)}...`,
  };
}

export function decryptVaultSecret({ ivHex, authTagHex, ciphertextHex }) {
  const key = getMasterKeyBuffer();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

// ============================================================================
// BCRYPT HASHING + JWT PADLOCK / ADMIN / USER TOKENS + RFC-6238 TOTP 2FA
// ============================================================================
export async function hashSecret(plain) {
  return bcrypt.hash(String(plain), 12);
}

export async function verifySecretHash(plain, hash) {
  return bcrypt.compare(String(plain), String(hash));
}

export function verifyTotp2FA(tokenInput, totpSecret = ENV.ADMIN_TOTP_SECRET) {
  const cleaned = String(tokenInput || '').trim();

  if (!cleaned) {
    // Blank TOTP is ONLY permitted when non-production explicitly sets ADMIN_REQUIRE_TOTP=false
    return !ENV.IS_PRODUCTION && ENV.ADMIN_REQUIRE_TOTP === false;
  }

  if (!ENV.IS_PRODUCTION && ENV.ADMIN_ALLOW_DEV_TOTP_CODE && cleaned === ENV.ADMIN_ALLOW_DEV_TOTP_CODE) {
    return true;
  }

  if (!/^\d{6}$/.test(cleaned)) {
    return false;
  }

  try {
    return authenticator.check(cleaned, totpSecret || ENV.ADMIN_TOTP_SECRET);
  } catch {
    return false;
  }
}

export function signPadlockTicket(ipAddress) {
  return jwt.sign({ scope: 'padlock_gate_1', ip: ipAddress }, ENV.PADLOCK_TICKET_SECRET, {
    expiresIn: '10m',
  });
}

export function verifyPadlockTicket(ticket) {
  return jwt.verify(String(ticket), ENV.PADLOCK_TICKET_SECRET);
}

export function signAdminAccessToken(admin) {
  return jwt.sign(
    {
      sub: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      role: admin.role || 'super_admin',
      scope: 'super_admin_vault',
    },
    ENV.JWT_ADMIN_SECRET,
    { expiresIn: '8h' }
  );
}

export function generateTotpToken(totpSecret = ENV.ADMIN_TOTP_SECRET) {
  return authenticator.generate(totpSecret || ENV.ADMIN_TOTP_SECRET);
}

export function verifyAdminAccessToken(token) {
  return jwt.verify(String(token), ENV.JWT_ADMIN_SECRET);
}

export function signUserAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      scope: 'registered_user',
    },
    ENV.JWT_USER_SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyUserAccessToken(token) {
  return jwt.verify(String(token), ENV.JWT_USER_SECRET);
}

// Sanitize Custom Admin SVG Markup (Prevents stored XSS `<script>`, `onload=`, `javascript:`)
export function sanitizeCustomSvg(rawSvg) {
  if (!rawSvg || typeof rawSvg !== 'string') return '';
  const trimmed = rawSvg.trim();
  if (!trimmed.toLowerCase().startsWith('<svg')) return '';
  return trimmed
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?>[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:(['"]).*?\1|[^\s>]+)/gi, '')
    .replace(/(?:javascript|vbscript|data\s*:\s*text\/html)\s*:/gi, '');
}

// Sanitize Custom Ad Slot HTML Markup (Prevents stored XSS in AdSlot `custom` mode)
export function sanitizeCustomAdHtml(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return '';
  return rawHtml
    .replace(/<(script|iframe|object|embed|applet|meta|link|style|form|base)[\s\S]*?>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|applet|meta|link|style|form|base)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z0-9_-]+\s*=\s*(?:(['"])[\s\S]*?\1|[^\s>]+)/gi, '')
    .replace(/\s(href|src|xlink:href|formaction)\s*=\s*(['"]?)\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^'">\s]*\2/gi, '')
    .trim();
}

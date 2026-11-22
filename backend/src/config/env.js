import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
export const BACKEND_ROOT = path.resolve(path.dirname(__filename), '../..');

dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const rawOrigins = process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173';

// Production must never boot with repository-known development secrets.
const productionSecretNames = [
  'JWT_ADMIN_SECRET',
  'JWT_USER_SECRET',
  'PADLOCK_TICKET_SECRET',
  'DOWNLOAD_TICKET_SECRET',
  'AES_256_VAULT_KEY',
  'ADMIN_TOTP_SECRET',
  'ADS_HASH_SALT',
];
if (isProduction) {
  const missingSecrets = productionSecretNames.filter((name) => !String(process.env[name] || '').trim());
  if (missingSecrets.length) {
    throw new Error(`Production startup blocked: configure unique secrets for: ${missingSecrets.join(', ')}`);
  }
  const weakOrPlaceholderSecrets = productionSecretNames.filter((name) => {
    const value = String(process.env[name] || '').trim();
    const minimumLength = name === 'ADMIN_TOTP_SECRET' ? 16 : 32;
    return value.length < minimumLength || /replace|placeholder|example|change_in_prod/i.test(value);
  });
  if (weakOrPlaceholderSecrets.length) {
    throw new Error(`Production startup blocked: replace weak or placeholder values for: ${weakOrPlaceholderSecrets.join(', ')}`);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(String(process.env.AES_256_VAULT_KEY || ''))) {
    throw new Error('Production startup blocked: AES_256_VAULT_KEY must be exactly 32 random bytes encoded as 64 hexadecimal characters.');
  }
  const knownDefaults = [
    'ultradownloader_v10_superadmin_jwt_secret_key_change_in_prod_998877',
    'ultradownloader_v10_public_user_jwt_secret_key_change_in_prod_445566',
    'ultradownloader_v10_gate1_padlock_ticket_secret_key_112233',
    '7f9a8b2c4d6e1f3a5b7c9d0e2f4a6b8c1d3e5f7a9b0c2d4e6f8a0b1c3d5e7f9a',
    'JBSWY3DPEHPK3PXP',
  ];
  const reusedDefaults = productionSecretNames.filter((name) => knownDefaults.includes(String(process.env[name] || '')));
  if (reusedDefaults.length) {
    throw new Error(`Production startup blocked: replace known development secrets for: ${reusedDefaults.join(', ')}`);
  }
}

function parseTrustProxy(raw) {
  const val = String(raw ?? 'false').trim();
  if (!val || val === 'false') return false;
  if (val === 'true') return true;
  if (/^\d+$/.test(val)) return Number(val);
  return val;
}

export const ENV = {
  NODE_ENV: nodeEnv,
  IS_PRODUCTION: isProduction,
  PORT: Number(process.env.PORT || 4000),
  HOST: process.env.HOST || '0.0.0.0',
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL || 'http://localhost:5173',
  TRUST_PROXY: parseTrustProxy(process.env.TRUST_PROXY),
  CORS_ORIGINS: rawOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  // XAMPP MySQL Connection (Default XAMPP: 127.0.0.1:3306, user=root, password="")
  DB_HOST: process.env.DB_HOST || '127.0.0.1',
  DB_PORT: Number(process.env.DB_PORT || 3306),
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD ?? '',
  DB_NAME: process.env.DB_NAME || 'ultradownloader_db',

  // Storage Directories
  VAULT_STORAGE_DIR: path.resolve(
    BACKEND_ROOT,
    process.env.VAULT_STORAGE_DIR || './storage/vault'
  ),
  TEMP_EPHEMERAL_DIR: path.resolve(
    BACKEND_ROOT,
    process.env.TEMP_EPHEMERAL_DIR || './storage/tmp'
  ),

  EXTRACTOR_TIMEOUT_MS: Number(process.env.EXTRACTOR_TIMEOUT_MS || 25000),
  DOWNLOAD_TICKET_TTL_SECONDS: Number(process.env.DOWNLOAD_TICKET_TTL_SECONDS || 7200),

  JWT_ADMIN_SECRET: process.env.JWT_ADMIN_SECRET || (isProduction ? '' : 'ultradownloader_v10_superadmin_jwt_secret_key_change_in_prod_998877'),
  JWT_USER_SECRET: process.env.JWT_USER_SECRET || (isProduction ? '' : 'ultradownloader_v10_public_user_jwt_secret_key_change_in_prod_445566'),
  PADLOCK_TICKET_SECRET: process.env.PADLOCK_TICKET_SECRET || (isProduction ? '' : 'ultradownloader_v10_gate1_padlock_ticket_secret_key_112233'),
  AES_256_VAULT_KEY: process.env.AES_256_VAULT_KEY || (isProduction ? '' : '7f9a8b2c4d6e1f3a5b7c9d0e2f4a6b8c1d3e5f7a9b0c2d4e6f8a0b1c3d5e7f9a'),
  ADMIN_TOTP_SECRET: process.env.ADMIN_TOTP_SECRET || (isProduction ? '' : 'JBSWY3DPEHPK3PXP'),
  DOWNLOAD_TICKET_SECRET: process.env.DOWNLOAD_TICKET_SECRET || (isProduction ? '' : ''),
  ADS_HASH_SALT: process.env.ADS_HASH_SALT || (isProduction ? '' : ''),

  // Production-safe 2FA controls:
  // - Production ALWAYS requires real 6-digit RFC-6238 TOTP and disables dev codes.
  // - Non-production requires TOTP by default unless ADMIN_REQUIRE_TOTP=false is explicitly set.
  ADMIN_REQUIRE_TOTP: isProduction
    ? true
    : String(process.env.ADMIN_REQUIRE_TOTP ?? 'true').toLowerCase() !== 'false',
  ADMIN_ALLOW_DEV_TOTP_CODE: isProduction
    ? ''
    : String(process.env.ADMIN_ALLOW_DEV_TOTP_CODE || '').trim(),

  ADMIN_IP_ALLOWLIST: (process.env.ADMIN_IP_ALLOWLIST || '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean),
  ADMIN_MAX_FAILED_ATTEMPTS: Number(process.env.ADMIN_MAX_FAILED_ATTEMPTS || 3),
  ADMIN_BAN_DURATION_MINUTES: Number(process.env.ADMIN_BAN_DURATION_MINUTES || 30),

  GUEST_DAILY_DOWNLOAD_LIMIT: Number(process.env.GUEST_DAILY_DOWNLOAD_LIMIT || 50),
  USER_DAILY_DOWNLOAD_LIMIT: Number(process.env.USER_DAILY_DOWNLOAD_LIMIT || 500),
};

import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { BACKEND_ROOT } from '../src/config/env.js';

const REQUIRED_ENV = {
  JWT_ADMIN_SECRET: 'A'.repeat(64),
  JWT_USER_SECRET: 'B'.repeat(64),
  PADLOCK_TICKET_SECRET: 'C'.repeat(64),
  DOWNLOAD_TICKET_SECRET: 'D'.repeat(64),
  AES_256_VAULT_KEY: 'a'.repeat(64),
  ADMIN_TOTP_SECRET: 'MFRGGZDFMZTWQ2LK',
  ADS_HASH_SALT: 'E'.repeat(64),
};

function importProductionConfig(overrides = {}) {
  return spawnSync(
    process.execPath,
    ['--input-type=module', '-e', "await import('./src/config/env.js')"],
    {
      cwd: BACKEND_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ...Object.fromEntries(Object.keys(REQUIRED_ENV).map((key) => [key, ''])),
        ...overrides,
      },
    }
  );
}

describe('Production environment secret validation', () => {
  it('refuses to boot when required production secrets are missing', () => {
    const result = importProductionConfig();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Production startup blocked');
    expect(result.stderr).toContain('JWT_ADMIN_SECRET');
    expect(result.stderr).toContain('ADS_HASH_SALT');
  });

  it('refuses known or placeholder secrets', () => {
    const result = importProductionConfig({
      ...REQUIRED_ENV,
      JWT_ADMIN_SECRET: 'replace_with_64_char_random_admin_jwt_secret_in_production',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('weak or placeholder');
  });

  it('loads when all required production secrets are strong and configured', () => {
    const result = importProductionConfig(REQUIRED_ENV);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('Production startup blocked');
  });
});

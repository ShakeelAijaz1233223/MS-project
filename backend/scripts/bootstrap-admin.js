import crypto from 'node:crypto';
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise.js';
import { authenticator } from 'otplib';
import { ENV } from '../src/config/env.js';

function ask(label, { secret = false } = {}) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(new Error('Run this bootstrap command in an interactive terminal.'));
      return;
    }
    process.stdout.write(label);
    if (!secret) {
      const rl = readline.createInterface({ input, output: process.stdout });
      rl.question('', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    let value = '';
    const previousRawMode = input.isRaw;
    const finish = (error) => {
      input.removeListener('data', onData);
      input.setRawMode(Boolean(previousRawMode));
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (buffer) => {
      for (const char of buffer.toString('utf8')) {
        if (char === '\u0003') {
          finish(new Error('Bootstrap cancelled.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          finish();
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          process.stdout.write('\b \b');
          continue;
        }
        if (char >= ' ' && char !== '\u007f') {
          value += char;
          process.stdout.write('*');
        }
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function main() {
  console.log('\nUltraDownloader — first administrator bootstrap');
  console.log('This command only works when the admin_users table is empty.\n');

  const fullName = await ask('Full name: ');
  const username = await ask('Username: ');
  const email = (await ask('Email: ')).toLowerCase();
  const password = await ask('Strong password (hidden): ', { secret: true });
  const pin = await ask('Separate keypad PIN (minimum 8 digits, hidden): ', { secret: true });

  if (fullName.length < 2 || username.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid name, username (3+ characters), and email address.');
  }
  if (password.length < 14) throw new Error('Administrator password must be at least 14 characters.');
  if (!/^\d{8,20}$/.test(pin) || pin === password) throw new Error('Keypad PIN must contain 8–20 digits and must differ from your password.');

  const passwordHash = await bcrypt.hash(password, 12);
  const pinHash = await bcrypt.hash(pin, 12);
  const totpSecret = authenticator.generateSecret();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const connection = await mysql.createConnection({
    host: ENV.DB_HOST,
    port: ENV.DB_PORT,
    user: ENV.DB_USER,
    password: ENV.DB_PASSWORD,
    database: ENV.DB_NAME,
    charset: 'utf8mb4',
    connectTimeout: 10000,
  });

  try {
    const [lockRows] = await connection.execute(
      'SELECT GET_LOCK(?, 10) AS acquired',
      ['ultradownloader_first_admin_bootstrap']
    );
    if (Number(lockRows[0]?.acquired) !== 1) {
      throw new Error('Could not acquire the first-admin bootstrap lock. Retry shortly.');
    }
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT id FROM admin_users LIMIT 1 FOR UPDATE');
    if (rows.length !== 0) {
      await connection.rollback();
      throw new Error('An administrator already exists. Refusing to create another bootstrap super-admin.');
    }
    await connection.execute(
      `INSERT INTO admin_users
        (id, username, email, full_name, password_hash, pin_hash, totp_secret, role, last_login_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'super_admin', NULL, ?)`,
      [id, username, email, fullName, passwordHash, pinHash, totpSecret, now]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    await connection.execute('SELECT RELEASE_LOCK(?)', ['ultradownloader_first_admin_bootstrap']).catch(() => {});
    await connection.end();
  }

  console.log('\nAdministrator created successfully.');
  console.log('TOTP secret (store securely): ' + totpSecret);
  console.log('Authenticator provisioning URI: ' + authenticator.keyuri(email, 'UltraDownloader', totpSecret));
  console.log('\nSave the TOTP secret in your authenticator now. It will not be shown again.');
}

main().catch((error) => {
  console.error('\nAdministrator bootstrap failed: ' + error.message);
  process.exitCode = 1;
});

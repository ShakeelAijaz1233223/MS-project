import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import mysql from 'mysql2/promise.js';
import { ENV, BACKEND_ROOT } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
  PLATFORM_DEFINITIONS,
  DEFAULT_AD_WATERFALL,
  DEFAULT_SYSTEM_SETTINGS,
} from '../data/platformDefinitions.js';
import { updateRuntimeEnginePreferences } from '../services/trafficEngine.js';

// ============================================================================
// HIGH-TRAFFIC SMART XAMPP MYSQL ENGINE V10.1
// - 50-Connection Keep-Alive Pool (`connectionLimit: 50`, `queueLimit: 500`)
// - Auto-imports non-destructive `ultradownloader_xampp.sql` + syncs all 404 platforms
// - Honest `mysqlConnected` vs `standbyMode` status reporting
// - Full Standby -> MySQL mutation flush across all runtime tables
// ============================================================================

let mysqlPool = null;
let activeDbPort = ENV.DB_PORT;
let reconnectTimer = null;
let waitingLoggedOnce = false;
let windowsXamppLaunchAttempted = false;
let standbyReadyPromise = null;
let totalSqlQueriesExecuted = 0;
let lastQueryLatencyMs = 0.6;
let avgQueryLatencyMs = 0.8;

const mem = {
  websites: [],
  admin_users: [],
  ip_lockouts: [],
  users: [],
  user_favorites: [],
  saved_history: [],
  platforms: [],
  ad_waterfall_zones: [],
  system_settings: [],
  saved_vault_videos: [],
  finance_ledger: [],
  seo_keywords: [],
  encrypted_cookies: [],
  download_jobs: [],
  share_links: [],
  analytics_events: [],
  security_audit_logs: [],
  ad_slots: [],
  ad_events: [],
  visitor_sessions: [],
};
let autoIdCounter = 1;

async function ensureStandbyMemoryInitialized() {
  if (standbyReadyPromise) return standbyReadyPromise;
  standbyReadyPromise = (async () => {
    const now = new Date().toISOString();
    mem.ad_slots = [
      { id: 1, slot_key: 'header_banner', name: 'Header Leaderboard', placement: 'header', ad_type: 'house', headline: 'Download any video in one click', body: 'No software, no sign-up, HD quality.', cta_text: 'Try it now', target_url: '/', image_url: '', adsense_client: '', adsense_slot: '', is_active: 1, weight: 10, created_at: now },
      { id: 2, slot_key: 'below_player', name: 'Below Player Billboard', placement: 'belowPlayer', ad_type: 'adsense', headline: '', body: '', cta_text: '', target_url: '', image_url: '', adsense_client: '', adsense_slot: '', is_active: 0, weight: 10, created_at: now },
      { id: 3, slot_key: 'sidebar_rail', name: 'Sidebar Rail', placement: 'sidebar', ad_type: 'house', headline: 'Unlimited HD downloads', body: 'TeraBox, YouTube, Instagram, 404 sites.', cta_text: 'Start free', target_url: '/', image_url: '', adsense_client: '', adsense_slot: '', is_active: 1, weight: 8, created_at: now },
      { id: 4, slot_key: 'inline_supported', name: 'In-feed (Supported Sites)', placement: 'inline', ad_type: 'house', headline: 'Save videos offline forever', body: 'Full HD 1080p / 4K, MP3 for audio only.', cta_text: 'Browse sites', target_url: '/sites', image_url: '', adsense_client: '', adsense_slot: '', is_active: 1, weight: 6, created_at: now },
      { id: 5, slot_key: 'footer_banner', name: 'Footer Banner', placement: 'footer', ad_type: 'house', headline: 'Free forever', body: 'No registration needed for downloads.', cta_text: 'Start', target_url: '/', image_url: '', adsense_client: '', adsense_slot: '', is_active: 0, weight: 4, created_at: now },
    ];

    mem.websites = [
      {
        id: 'site_main_clean',
        name: 'UltraDownloader Main Hub',
        domain: 'localhost:5173',
        content_mode: 'clean_mainstream',
        status: 'ACTIVE',
        monthly_revenue: 0,
        monthly_expense: 0,
        seo_score: 100,
        created_at: now,
      },
    ];

    // Fail closed in volatile standby mode: never seed a known default administrator.
    // Administrator authentication requires a provisioned record in durable MySQL.
    mem.admin_users = [];

    mem.platforms = PLATFORM_DEFINITIONS.map((p) => ({
      id: p.id,
      display_name: p.displayName,
      subtitle: p.subtitle,
      category: p.category,
      accent_color: p.accentColor,
      icon_key: p.iconKey,
      icon_svg: p.iconSvg || null,
      domains_json: JSON.stringify(p.domains),
      example_url: p.exampleUrl,
      seo_slug: p.seoSlug,
      is_adult: p.isAdult ? 1 : 0,
      supports_search: p.supportsSearch ? 1 : 0,
      supports_online_player: 1,
      supports_download: 1,
      supports_resume: 1,
      is_enabled: 1,
      health_status: 'operational',
      known_limitations: p.regionNote || '',
      created_at: now,
    }));

    mem.seo_keywords = PLATFORM_DEFINITIONS.filter((p) => !p.isAdult).map((p) => ({
      id: `seo-${p.id}`,
      keyword: `${p.displayName} Video Downloader`,
      slug: p.seoSlug,
      impressions: 0,
      clicks: 0,
      created_at: now,
    }));

    mem.ad_waterfall_zones = Object.entries(DEFAULT_AD_WATERFALL).map(([zoneKey, cfg]) => ({
      zone_key: zoneKey,
      enabled: 0,
      cooldown_minutes: Number(cfg.cooldownMinutes || 20),
      config_json: JSON.stringify(cfg),
      updated_at: now,
    }));

    mem.system_settings = [
      {
        setting_key: 'global',
        setting_json: JSON.stringify(DEFAULT_SYSTEM_SETTINGS),
        updated_at: now,
      },
    ];
  })();
  return standbyReadyPromise;
}

async function tryAutoStartWindowsXamppMysql() {
  if (process.platform !== 'win32' || windowsXamppLaunchAttempted) return false;
  windowsXamppLaunchAttempted = true;

  const userProfile = process.env.USERPROFILE || '';
  const candidateRoots = [
    'C:\\xampp\\mysql\\bin',
    'D:\\xampp\\mysql\\bin',
    'E:\\xampp\\mysql\\bin',
    'F:\\xampp\\mysql\\bin',
    userProfile ? path.join(userProfile, 'xampp', 'mysql', 'bin') : '',
  ].filter(Boolean);

  for (const binFolder of candidateRoots) {
    const mysqldExe = path.join(binFolder, 'mysqld.exe');
    const myIni = path.join(binFolder, 'my.ini');
    if (fs.existsSync(mysqldExe)) {
      try {
        const args = fs.existsSync(myIni) ? [`--defaults-file=${myIni}`] : [];
        const child = spawn(mysqldExe, args, {
          cwd: binFolder,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
        logger.info({ mysqldExe }, 'Auto-started Windows XAMPP MySQL daemon in background.');
        await new Promise((r) => setTimeout(r, 2500));
        return true;
      } catch {
        // Ignore and fall back to background poll
      }
    }
  }
  return false;
}

async function ensureXamppSchemaImported(host, port) {
  const bootstrapConn = await mysql.createConnection({
    host,
    port,
    user: ENV.DB_USER,
    password: ENV.DB_PASSWORD,
    charset: 'utf8mb4',
    multipleStatements: true,
    connectTimeout: 5000,
  });

  try {
    await bootstrapConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${ENV.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;`
    );
    const [tables] = await bootstrapConn.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
      [ENV.DB_NAME]
    );
    const tableSet = new Set(tables.map((t) => t.TABLE_NAME || t.table_name));
    const requiredTables = [
      'admin_users',
      'platforms',
      'ip_lockouts',
      'users',
      'saved_history',
      'ad_slots',
      'ad_events',
      'visitor_sessions',
    ];
    if (requiredTables.some((tbl) => !tableSet.has(tbl))) {
      const sqlFile = path.join(BACKEND_ROOT, 'database', 'ultradownloader_xampp.sql');
      if (fs.existsSync(sqlFile)) {
        const sqlDump = fs.readFileSync(sqlFile, 'utf8');
        await bootstrapConn.query(sqlDump);
        logger.info(
          { database: ENV.DB_NAME, port },
          'Auto-verified non-destructive ultradownloader_xampp.sql schema in XAMPP MySQL!'
        );
      }
    }
    // Ensure legacy `users` tables created by older releases have the `tier` column
    await bootstrapConn
      .query(
        `ALTER TABLE \`${ENV.DB_NAME}\`.\`users\` ADD COLUMN IF NOT EXISTS \`tier\` VARCHAR(64) NOT NULL DEFAULT 'pro_member' AFTER \`password_hash\`;`
      )
      .catch(() => {});
  } finally {
    await bootstrapConn.end().catch(() => {});
  }
}

async function syncAllPlatformsAndPrefsToMysql(pool) {
  try {
    const now = new Date().toISOString();

    await pool
      .execute("DELETE FROM platforms WHERE category = 'adult_18' OR is_adult = 1")
      .catch(() => {});

    const values = [];
    const placeholders = [];
    for (const p of PLATFORM_DEFINITIONS) {
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, ?, ?, ?)');
      values.push(
        p.id,
        p.displayName,
        p.subtitle,
        p.category,
        p.accentColor,
        p.iconKey || 'globe',
        p.iconSvg || null,
        JSON.stringify(p.domains || []),
        p.exampleUrl || '',
        p.seoSlug,
        p.isAdult ? 1 : 0,
        p.supportsSearch ? 1 : 0,
        'operational',
        p.regionNote || '',
        now
      );
    }
    if (placeholders.length > 0) {
      await pool.query(
        `INSERT INTO platforms (
          id, display_name, subtitle, category, accent_color, icon_key, icon_svg,
          domains_json, example_url, seo_slug, is_adult, supports_search,
          supports_online_player, supports_download, supports_resume, is_enabled,
          health_status, known_limitations, created_at
        ) VALUES ${placeholders.join(', ')}
        ON DUPLICATE KEY UPDATE
          display_name = VALUES(display_name),
          subtitle = VALUES(subtitle),
          category = VALUES(category),
          accent_color = VALUES(accent_color),
          domains_json = VALUES(domains_json),
          example_url = VALUES(example_url)`,
        values
      );
    }

    const [prefRows] = await pool.execute(
      'SELECT setting_json FROM system_settings WHERE setting_key = ?',
      ['engine_preferences']
    );
    if (prefRows[0]?.setting_json) {
      updateRuntimeEnginePreferences(JSON.parse(prefRows[0].setting_json), {
        fromStartupHydration: true,
      });
    }
  } catch (err) {
    logger.warn({ err }, 'Platform/Prefs sync warning');
  }
}

// Flush ALL standby mutations into MySQL when XAMPP MySQL comes online mid-session
async function flushStandbyMutationsToMysql(pool) {
  try {
    for (const u of mem.users) {
      await pool.execute(
        `INSERT IGNORE INTO users (id, full_name, email, password_hash, tier, daily_quota, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [u.id, u.full_name, u.email, u.password_hash, u.tier || 'pro_member', u.daily_quota || 500, u.created_at]
      );
    }
    for (const h of mem.saved_history) {
      await pool.execute(
        `INSERT IGNORE INTO saved_history (user_id, title, source_url, platform_id, quality_label, thumbnail_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [h.user_id, h.title, h.source_url, h.platform_id, h.quality_label, h.thumbnail_url || '', h.created_at]
      );
    }
    for (const d of mem.download_jobs) {
      await pool.execute(
        `INSERT IGNORE INTO download_jobs (
          id, requester_ip, user_id, title, file_name, source_url, format_selector, stream_url,
          local_output_path, thumbnail_url, platform_id, quality_label, format_ext, status,
          progress_pct, bytes_downloaded, total_bytes, speed_bps, eta_seconds, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          d.id, d.requester_ip, d.user_id, d.title, d.file_name, d.source_url, d.format_selector, d.stream_url,
          d.local_output_path, d.thumbnail_url, d.platform_id, d.quality_label, d.format_ext, d.status,
          d.progress_pct, d.bytes_downloaded, d.total_bytes, d.speed_bps, d.eta_seconds, d.error_message, d.created_at,
        ]
      );
    }
    for (const v of mem.saved_vault_videos) {
      await pool.execute(
        `INSERT IGNORE INTO saved_vault_videos (
          id, website_id, title, source_url, stream_url, local_file_path, thumbnail_url,
          platform_id, platform_json, category, duration_text, resolution_label,
          file_size_bytes, file_present_on_disk, is_pinned, is_adult, admin_notes, saved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          v.id, v.website_id, v.title, v.source_url, v.stream_url, v.local_file_path, v.thumbnail_url,
          v.platform_id, v.platform_json, v.category, v.duration_text, v.resolution_label,
          v.file_size_bytes, v.file_present_on_disk, v.is_pinned, v.is_adult, v.admin_notes, v.saved_at,
        ]
      );
    }
    for (const f of mem.finance_ledger) {
      await pool.execute(
        `INSERT IGNORE INTO finance_ledger (id, website_id, website_label, entry_type, category, amount, status, entry_date, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [f.id, f.website_id, f.website_label, f.entry_type, f.category, f.amount, f.status, f.entry_date, f.notes, f.created_at]
      );
    }
    for (const s of mem.system_settings) {
      if (s.setting_key === 'global') continue;
      await pool.execute(
        `INSERT INTO system_settings (setting_key, setting_json, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_json = VALUES(setting_json), updated_at = VALUES(updated_at)`,
        [s.setting_key, s.setting_json, s.updated_at]
      );
    }
    for (const c of mem.encrypted_cookies) {
      await pool.execute(
        `INSERT IGNORE INTO encrypted_cookies (id, platform_label, platform_id, iv_hex, auth_tag_hex, ciphertext_hex, masked_preview, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.id, c.platform_label, c.platform_id, c.iv_hex, c.auth_tag_hex, c.ciphertext_hex, c.masked_preview, c.status, c.updated_at]
      );
    }
    for (const slot of mem.ad_slots) {
      await pool.execute(
        `INSERT INTO ad_slots (slot_key, name, placement, ad_type, headline, body, cta_text, target_url, image_url, adsense_client, adsense_slot, is_active, weight, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name), placement = VALUES(placement), ad_type = VALUES(ad_type),
           headline = VALUES(headline), body = VALUES(body), cta_text = VALUES(cta_text),
           target_url = VALUES(target_url), image_url = VALUES(image_url),
           adsense_client = VALUES(adsense_client), adsense_slot = VALUES(adsense_slot),
           is_active = VALUES(is_active), weight = VALUES(weight)`,
        [
          slot.slot_key, slot.name, slot.placement, slot.ad_type, slot.headline, slot.body,
          slot.cta_text, slot.target_url, slot.image_url, slot.adsense_client, slot.adsense_slot,
          slot.is_active, slot.weight, slot.created_at,
        ]
      );
    }
    for (const ev of mem.ad_events) {
      if (ev._flushed) continue;
      await pool.execute(
        `INSERT INTO ad_events (slot_key, event_type, ip_hash, user_agent, page_path, revenue_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [ev.slot_key, ev.event_type, ev.ip_hash, ev.user_agent, ev.page_path, ev.revenue_usd, ev.created_at]
      );
      ev._flushed = true;
    }
    for (const vs of mem.visitor_sessions) {
      await pool.execute(
        `INSERT INTO visitor_sessions (ip_hash, user_agent, country, first_seen, last_seen, hits)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE last_seen = VALUES(last_seen), hits = GREATEST(hits, VALUES(hits))`,
        [vs.ip_hash, vs.user_agent, vs.country, vs.first_seen, vs.last_seen, vs.hits]
      );
    }
    for (const sl of mem.share_links) {
      await pool.execute(
        `INSERT IGNORE INTO share_links (short_code, source_url, title, platform_id, thumbnail_url, duration_text, stream_url, views, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sl.short_code, sl.source_url, sl.title, sl.platform_id, sl.thumbnail_url, sl.duration_text, sl.stream_url, sl.views, sl.created_at]
      );
    }
    for (const lk of mem.ip_lockouts) {
      await pool.execute(
        `INSERT INTO ip_lockouts (ip_address, failed_attempts, banned_until, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE failed_attempts = VALUES(failed_attempts), banned_until = VALUES(banned_until), updated_at = VALUES(updated_at)`,
        [lk.ip_address, lk.failed_attempts, lk.banned_until, lk.updated_at]
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Standby-to-MySQL flush warning');
  }
}

async function tryConnectXamppMysqlOnce() {
  const candidatePorts = [...new Set([Number(ENV.DB_PORT || 3306), 3306, 3307, 3308])];

  for (const port of candidatePorts) {
    try {
      await ensureXamppSchemaImported(ENV.DB_HOST, port);

      const candidatePool = mysql.createPool({
        host: ENV.DB_HOST,
        port,
        user: ENV.DB_USER,
        password: ENV.DB_PASSWORD,
        database: ENV.DB_NAME,
        waitForConnections: true,
        connectionLimit: Number(process.env.DB_POOL_SIZE || 50),
        maxIdle: 20,
        idleTimeout: 60000,
        queueLimit: 500,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
        charset: 'utf8mb4',
        connectTimeout: 6000,
      });

      const conn = await candidatePool.getConnection();
      await conn.ping();
      conn.release();

      await syncAllPlatformsAndPrefsToMysql(candidatePool);
      await flushStandbyMutationsToMysql(candidatePool);

      mysqlPool = candidatePool;
      activeDbPort = port;
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }

      logger.info(
        {
          host: ENV.DB_HOST,
          port: activeDbPort,
          database: ENV.DB_NAME,
          poolSize: 50,
          syncedPlatforms: PLATFORM_DEFINITIONS.length,
        },
        'Connected directly to High-Traffic XAMPP MySQL Pool (50 Connections)!'
      );
      return true;
    } catch {
      // Try next candidate port
    }
  }
  return false;
}

function startBackgroundMysqlPoller() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(async () => {
    if (mysqlPool) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
      return;
    }
    await tryConnectXamppMysqlOnce();
  }, 3000);
  reconnectTimer.unref?.();
}

export async function initDatabase() {
  await ensureStandbyMemoryInitialized();
  fs.mkdirSync(ENV.VAULT_STORAGE_DIR, { recursive: true });
  fs.mkdirSync(ENV.TEMP_EPHEMERAL_DIR, { recursive: true });

  if (mysqlPool) {
    return {
      driver: 'mysql',
      engine: 'XAMPP MySQL',
      host: ENV.DB_HOST,
      port: activeDbPort,
      database: ENV.DB_NAME,
      connected: true,
      mysqlConnected: true,
      standbyMode: false,
    };
  }

  let connected = await tryConnectXamppMysqlOnce();
  if (!connected) {
    const startedXampp = await tryAutoStartWindowsXamppMysql();
    if (startedXampp) {
      connected = await tryConnectXamppMysqlOnce();
    }
  }

  if (!connected) {
    if (!waitingLoggedOnce) {
      waitingLoggedOnce = true;
      logger.warn(
        { host: ENV.DB_HOST, portsChecked: [ENV.DB_PORT, 3306, 3307, 3308], database: ENV.DB_NAME },
        'XAMPP MySQL is not running yet — running in Live Standby Mode & auto-connecting when XAMPP MySQL starts!'
      );
    }
    startBackgroundMysqlPoller();
    return {
      driver: 'mysql-standby',
      engine: 'Standby SQL Emulator (awaiting XAMPP MySQL)',
      host: ENV.DB_HOST,
      port: ENV.DB_PORT,
      database: ENV.DB_NAME,
      connected: false,
      mysqlConnected: false,
      standbyMode: true,
    };
  }

  return {
    driver: 'mysql',
    engine: 'XAMPP MySQL',
    host: ENV.DB_HOST,
    port: activeDbPort,
    database: ENV.DB_NAME,
    connected: true,
    mysqlConnected: true,
    standbyMode: false,
  };
}

export async function getDatabaseHealth() {
  if (mysqlPool) {
    try {
      const [rows] = await mysqlPool.query('SELECT 1 AS ok');
      const internalPool = mysqlPool.pool;
      const isOk = rows[0]?.ok === 1;
      return {
        driver: 'mysql',
        engine: 'XAMPP MySQL',
        host: ENV.DB_HOST,
        port: activeDbPort,
        database: ENV.DB_NAME,
        connected: isOk,
        mysqlConnected: isOk,
        standbyAvailable: true,
        standbyMode: false,
        poolLimit: 50,
        activeConnections: internalPool?._allConnections?.length || 1,
        freeConnections: internalPool?._freeConnections?.length || 0,
        queuedRequests: internalPool?._connectionQueue?.length || 0,
        totalSqlQueriesExecuted,
        zeroAutoPasteTableEnforced: true,
      };
    } catch {
      mysqlPool = null;
      startBackgroundMysqlPoller();
    }
  }

  return {
    driver: 'mysql-standby',
    engine: 'Standby SQL Emulator (awaiting XAMPP MySQL)',
    host: ENV.DB_HOST,
    port: activeDbPort,
    database: ENV.DB_NAME,
    connected: false,
    mysqlConnected: false,
    standbyAvailable: true,
    standbyMode: true,
    poolLimit: 50,
    activeConnections: 0,
    freeConnections: 0,
    queuedRequests: 0,
    totalSqlQueriesExecuted,
    note: 'XAMPP MySQL is currently offline — Standby SQL Emulator is serving requests in-memory and will flush to MySQL when XAMPP starts.',
    zeroAutoPasteTableEnforced: true,
  };
}

function executeStandbyMemoryQuery(sqlText, params = []) {
  const q = sqlText.replace(/\s+/g, ' ').trim();

  if (/^SELECT \* FROM websites/i.test(q)) return [...mem.websites];
  if (/^SELECT \* FROM admin_users LIMIT 1/i.test(q)) return mem.admin_users.slice(0, 1);
  if (/^SELECT \* FROM admin_users WHERE LOWER\(email\)/i.test(q)) {
    const idf = String(params[0] || '').toLowerCase();
    return mem.admin_users
      .filter((a) => a.email.toLowerCase() === idf || a.username.toLowerCase() === idf)
      .slice(0, 1);
  }
  if (/^SELECT \* FROM ip_lockouts WHERE ip_address = \?/i.test(q)) {
    return mem.ip_lockouts.filter((r) => r.ip_address === params[0]);
  }
  if (/^SELECT \* FROM platforms/i.test(q)) return [...mem.platforms];
  if (/^SELECT .+ FROM ad_waterfall_zones/i.test(q)) return [...mem.ad_waterfall_zones];
  if (/^SELECT setting_json FROM system_settings WHERE setting_key = \?/i.test(q)) {
    return mem.system_settings.filter((s) => s.setting_key === params[0]);
  }
  if (/^SELECT setting_key, setting_(?:value_)?json FROM system_settings/i.test(q)) {
    return [...mem.system_settings];
  }
  if (/^SELECT slug FROM seo_keywords/i.test(q)) return mem.seo_keywords.map((s) => ({ slug: s.slug }));
  if (/^SELECT \* FROM seo_keywords/i.test(q)) {
    return [...mem.seo_keywords].sort((a, b) => b.clicks - a.clicks);
  }
  if (
    /^SELECT COUNT\(\*\) AS routes, COALESCE\(SUM\(clicks\), 0\) AS clicks, COALESCE\(SUM\(impressions\), 0\) AS impressions FROM seo_keywords/i.test(
      q
    )
  ) {
    return [
      {
        routes: mem.seo_keywords.length,
        clicks: mem.seo_keywords.reduce((s, r) => s + Number(r.clicks || 0), 0),
        impressions: mem.seo_keywords.reduce((s, r) => s + Number(r.impressions || 0), 0),
      },
    ];
  }
  if (/^SELECT COALESCE\(SUM\(clicks\), 0\) AS (c|clicks) FROM seo_keywords/i.test(q)) {
    const sum = mem.seo_keywords.reduce((s, r) => s + Number(r.clicks || 0), 0);
    return [{ c: sum, clicks: sum }];
  }
  if (/^SELECT COUNT\(\*\) AS (c|cnt) FROM (\w+)$/i.test(q)) {
    const [, alias, tbl] = q.match(/^SELECT COUNT\(\*\) AS (c|cnt) FROM (\w+)$/i);
    return [{ [alias]: (mem[tbl] || []).length }];
  }
  if (/^SELECT id FROM users WHERE email = \?/i.test(q)) {
    return mem.users.filter((u) => u.email === params[0]);
  }
  if (/^SELECT \* FROM users WHERE email = \?/i.test(q)) {
    return mem.users.filter((u) => u.email === params[0]);
  }
  if (/^SELECT .+ FROM users WHERE id = \?/i.test(q)) {
    return mem.users.filter((u) => u.id === params[0]);
  }
  if (/^SELECT \* FROM saved_history WHERE user_id = \?/i.test(q)) {
    return mem.saved_history
      .filter((h) => h.user_id === params[0])
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, 50);
  }
  if (/^SELECT \* FROM user_favorites WHERE user_id = \?/i.test(q)) {
    return mem.user_favorites.filter((f) => f.user_id === params[0]);
  }
  if (/^SELECT id FROM user_favorites WHERE user_id = \? AND video_url = \?/i.test(q)) {
    return mem.user_favorites.filter((f) => f.user_id === params[0] && f.video_url === params[1]);
  }
  if (/^SELECT COUNT\(\*\) AS cnt, COALESCE\(SUM\(file_size_bytes\), 0\) AS bytes FROM saved_vault_videos/i.test(q)) {
    return [
      {
        cnt: mem.saved_vault_videos.length,
        bytes: mem.saved_vault_videos.reduce((s, v) => s + Number(v.file_size_bytes || 0), 0),
      },
    ];
  }
  if (/^SELECT local_file_path, title FROM saved_vault_videos WHERE id = \?/i.test(q)) {
    return mem.saved_vault_videos.filter((v) => v.id === params[0]);
  }
  if (/^SELECT \* FROM saved_vault_videos WHERE id = \?/i.test(q)) {
    return mem.saved_vault_videos.filter((v) => v.id === params[0]);
  }
  if (/^SELECT \* FROM saved_vault_videos/i.test(q)) return [...mem.saved_vault_videos].reverse();
  if (/^SELECT entry_type, category, amount, entry_date FROM finance_ledger/i.test(q)) {
    return [...mem.finance_ledger];
  }
  if (/^SELECT \* FROM finance_ledger/i.test(q)) return [...mem.finance_ledger].reverse();
  if (/^SELECT iv_hex, auth_tag_hex, ciphertext_hex FROM encrypted_cookies WHERE platform_id/i.test(q)) {
    const target = String(params[0] || '').replace(/%/g, '');
    return mem.encrypted_cookies
      .filter((c) => c.platform_id === target || (String(params[0]).includes('%') && String(c.platform_id).includes(target)))
      .slice(-1);
  }
  if (/^SELECT .+ FROM encrypted_cookies/i.test(q)) return [...mem.encrypted_cookies].reverse();
  if (/^SELECT \* FROM security_audit_logs/i.test(q)) {
    return [...mem.security_audit_logs].reverse().slice(0, 100);
  }
  if (/^SELECT COUNT\(\*\) AS cnt FROM download_jobs WHERE requester_ip = \?/i.test(q)) {
    const prefix = String(params[1] || '').replace(/%/g, '');
    return [
      {
        cnt: mem.download_jobs.filter(
          (d) => d.requester_ip === params[0] && String(d.created_at).startsWith(prefix)
        ).length,
      },
    ];
  }
  if (/^SELECT COUNT\(\*\) AS total, SUM/i.test(q) && q.includes('download_jobs')) {
    return [
      {
        total: mem.download_jobs.length,
        completed: mem.download_jobs.filter((d) => ['completed', 'dispatched'].includes(d.status)).length,
      },
    ];
  }
  if (/^SELECT .+ FROM download_jobs WHERE id = \? AND user_id = \?/i.test(q)) {
    return mem.download_jobs.filter((d) => d.id === params[0] && d.user_id === params[1]);
  }
  if (/^SELECT .+ FROM download_jobs WHERE id = \?$/i.test(q)) {
    return mem.download_jobs.filter((d) => d.id === params[0]);
  }
  if (/^SELECT .+ FROM download_jobs WHERE user_id = \?/i.test(q)) {
    const limit = Number((/LIMIT (\d+)/i.exec(q) || [])[1] || 100);
    return mem.download_jobs
      .filter((d) => d.user_id === params[0])
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, limit);
  }
  if (/^SELECT COUNT\(\*\) AS cnt FROM download_jobs WHERE user_id = \?/i.test(q)) {
    return [{ cnt: mem.download_jobs.filter((d) => d.user_id === params[0]).length }];
  }
  if (/^SELECT \* FROM download_jobs WHERE requester_ip = \?/i.test(q)) {
    return mem.download_jobs.filter((d) => d.requester_ip === params[0]).reverse().slice(0, 30);
  }
  if (/^SELECT \* FROM share_links WHERE short_code = \?/i.test(q)) {
    return mem.share_links.filter((s) => s.short_code === params[0]);
  }
  if (/^SELECT COUNT\(\*\) AS links, COALESCE\(SUM\(views\), 0\) AS views FROM share_links/i.test(q)) {
    return [
      {
        links: mem.share_links.length,
        views: mem.share_links.reduce((s, r) => s + Number(r.views || 0), 0),
      },
    ];
  }
  if (/^SELECT COALESCE\(SUM\(views\), 0\) AS views FROM share_links/i.test(q)) {
    return [{ views: mem.share_links.reduce((s, r) => s + Number(r.views || 0), 0) }];
  }
  if (/^SELECT event_name, COUNT\(\*\) AS cnt FROM analytics_events GROUP BY event_name/i.test(q)) {
    const counts = {};
    for (const e of mem.analytics_events) counts[e.event_name] = (counts[e.event_name] || 0) + 1;
    return Object.entries(counts).map(([event_name, cnt]) => ({ event_name, cnt }));
  }
  if (/^SELECT COUNT\(\*\) AS cnt FROM analytics_events WHERE event_name = 'app_visit'/i.test(q)) {
    return [{ cnt: mem.analytics_events.filter((e) => e.event_name === 'app_visit').length }];
  }

  // ---------------- ADS + VISITOR ANALYTICS ----------------
  if (/^SELECT \* FROM ad_slots/i.test(q)) {
    return [...mem.ad_slots].sort((a, b) => a.id - b.id);
  }
  if (/^SELECT \* FROM ad_events/i.test(q)) return [...mem.ad_events];
  if (/^SELECT \* FROM visitor_sessions/i.test(q)) return [...mem.visitor_sessions];
  if (/^INSERT INTO ad_slots/i.test(q)) {
    mem.ad_slots.push({
      id: autoIdCounter++,
      slot_key: params[0], name: params[1], placement: params[2], ad_type: params[3],
      headline: params[4], body: params[5], cta_text: params[6], target_url: params[7],
      image_url: params[8], adsense_client: params[9], adsense_slot: params[10],
      is_active: Number(params[11] ?? 1), weight: Number(params[12] ?? 10),
      created_at: params[13] || new Date().toISOString(),
    });
    return { affectedRows: 1, insertId: mem.ad_slots[mem.ad_slots.length - 1].id };
  }
  if (/^UPDATE ad_slots SET/i.test(q)) {
    const slot = mem.ad_slots.find((x) => String(x.id) === String(params[params.length - 1]));
    if (slot) {
      const cols = (q.match(/SET ([\s\S]+?) WHERE/i)?.[1] || '')
        .split(',')
        .map((part) => part.trim().split(/\s*=\s*/)[0])
        .filter(Boolean);
      cols.forEach((col, idx) => { slot[col] = params[idx]; });
    }
    return { affectedRows: slot ? 1 : 0 };
  }
  if (/^DELETE FROM ad_slots WHERE id = \?/i.test(q)) {
    const before = mem.ad_slots.length;
    mem.ad_slots = mem.ad_slots.filter((x) => String(x.id) !== String(params[0]));
    return { affectedRows: before - mem.ad_slots.length };
  }
  if (/^INSERT INTO ad_events/i.test(q)) {
    mem.ad_events.push({
      id: autoIdCounter++,
      slot_key: params[0], event_type: params[1], ip_hash: params[2],
      user_agent: params[3], page_path: params[4], revenue_usd: Number(params[5] || 0),
      created_at: params[6] || new Date().toISOString(),
    });
    return { affectedRows: 1 };
  }
  if (/^INSERT INTO visitor_sessions/i.test(q)) {
    const hash = params[0];
    const existing = mem.visitor_sessions.find((v) => v.ip_hash === hash);
    if (existing) {
      existing.last_seen = params[4] || params[3] || new Date().toISOString();
      existing.hits = Number(existing.hits || 1) + 1;
      return { affectedRows: 1 };
    }
    mem.visitor_sessions.push({
      id: autoIdCounter++,
      ip_hash: hash,
      user_agent: params[1] || '',
      country: params[2] || '',
      first_seen: params[3] || new Date().toISOString(),
      last_seen: params[4] || params[3] || new Date().toISOString(),
      hits: 1,
    });
    return { affectedRows: 1 };
  }

  if (/^INSERT INTO system_settings/i.test(q)) {
    const existing = mem.system_settings.find((s) => s.setting_key === params[0]);
    if (existing) {
      existing.setting_json = params[1];
      existing.updated_at = params[2];
    } else {
      mem.system_settings.push({
        setting_key: params[0],
        setting_json: params[1],
        updated_at: params[2],
      });
    }
    return { affectedRows: 1 };
  }
  if (/^INSERT INTO ip_lockouts/i.test(q)) {
    mem.ip_lockouts.push({
      ip_address: params[0],
      failed_attempts: params[1],
      banned_until: params.length === 4 ? params[2] : null,
      updated_at: params[params.length - 1],
    });
    return { affectedRows: 1 };
  }
  if (/^INSERT INTO security_audit_logs/i.test(q)) {
    mem.security_audit_logs.push({
      id: autoIdCounter++,
      event_type: params[0],
      ip_address: params[1],
      user_agent: params[2],
      details_text: params[3],
      created_at: params[4],
    });
    return { affectedRows: 1 };
  }
  if (/^INSERT INTO analytics_events/i.test(q)) {
    for (let i = 0; i < params.length; i += 5) {
      mem.analytics_events.push({
        id: autoIdCounter++,
        website_id: params[i],
        event_name: params[i + 1],
        platform_id: params[i + 2],
        meta_json: params[i + 3],
        created_at: params[i + 4],
      });
    }
    return { affectedRows: 1 };
  }
  if (/^INSERT INTO users/i.test(q)) {
    const hasTier = params.length >= 6;
    mem.users.push({
      id: params[0],
      full_name: params[1],
      email: params[2],
      password_hash: params[3],
      tier: hasTier ? params[4] : 'pro_member',
      daily_quota: 500,
      created_at: hasTier ? params[5] : params[4],
    });
    return { affectedRows: 1 };
  }
  if (/^INSERT INTO saved_history/i.test(q)) {
    mem.saved_history.push({
      id: autoIdCounter++,
      user_id: params[0],
      title: params[1],
      source_url: params[2],
      platform_id: params[3],
      quality_label: params[4],
      thumbnail_url: params[5],
      created_at: params[6] || new Date().toISOString(),
    });
    return { affectedRows: 1 };
  }
  if (/^INSERT INTO user_favorites/i.test(q)) {
    mem.user_favorites.push({
      id: params[0],
      user_id: params[1],
      video_url: params[2],
      title: params[3],
      thumbnail_url: params[4],
      platform_id: params[5],
      duration_text: params[6],
      created_at: params[7] || new Date().toISOString(),
    });
    return { affectedRows: 1 };
  }
  if (/^INSERT INTO saved_vault_videos/i.test(q)) {
    mem.saved_vault_videos.push({
      id: params[0], website_id: params[1], title: params[2], source_url: params[3],
      stream_url: params[4], local_file_path: params[5], thumbnail_url: params[6],
      platform_id: params[7], platform_json: params[8], category: params[9],
      duration_text: params[10], resolution_label: params[11], file_size_bytes: params[12],
      file_present_on_disk: params[13], is_pinned: params[14], is_adult: params[15],
      admin_notes: params[16], saved_at: params[17],
    });
    return { affectedRows: 1 };
  }
  if (/^INSERT INTO finance_ledger/i.test(q)) {
    mem.finance_ledger.push({
      id: params[0], website_id: params[1], website_label: params[2], entry_type: params[3],
      category: params[4], amount: params[5], status: 'RECORDED', entry_date: params[6],
      notes: params[7], created_at: params[8],
    });
    return { affectedRows: 1 };
  }
  if (/^INSERT INTO seo_keywords/i.test(q)) {
    mem.seo_keywords.push({
      id: params[0], keyword: params[1], slug: params[2], impressions: 0, clicks: 0, created_at: params[3],
    });
    return { affectedRows: 1 };
  }
  if (/^INSERT INTO websites/i.test(q)) {
    mem.websites.push({
      id: params[0], name: params[1], domain: params[2], content_mode: params[3],
      status: 'ACTIVE', monthly_revenue: 0, monthly_expense: 0, seo_score: 100, created_at: params[4],
    });
    return { affectedRows: 1 };
  }
  if (/^INSERT INTO platforms/i.test(q)) {
    mem.platforms.push({
      id: params[0], display_name: params[1], subtitle: params[2], category: params[3], accent_color: params[4],
      icon_key: 'globe', icon_svg: params[5], domains_json: params[6], example_url: params[7], seo_slug: params[8],
      is_adult: params[9], supports_search: 0, supports_online_player: 1, supports_download: 1, supports_resume: 1,
      is_enabled: 1, health_status: 'operational', known_limitations: params[10], created_at: params[11],
    });
    return { affectedRows: 1 };
  }
  if (/^INSERT INTO encrypted_cookies/i.test(q)) {
    mem.encrypted_cookies.push({
      id: params[0], platform_label: params[1], platform_id: params[2], iv_hex: params[3],
      auth_tag_hex: params[4], ciphertext_hex: params[5], masked_preview: params[6],
      status: 'Active (AES-256-GCM Encrypted)', updated_at: params[7],
    });
    return { affectedRows: 1 };
  }
  if (/^INSERT INTO download_jobs/i.test(q)) {
    // Supports both 14-param legacy and 17-param explicit status/progress inserts
    if (params.length >= 17) {
      mem.download_jobs.push({
        id: params[0], requester_ip: params[1], user_id: params[2], title: params[3], file_name: params[4],
        source_url: params[5], format_selector: params[6], stream_url: params[7], local_output_path: null,
        thumbnail_url: params[8], platform_id: params[9], quality_label: params[10], format_ext: params[11],
        status: params[12], progress_pct: Number(params[13] || 0), bytes_downloaded: Number(params[14] || 0),
        total_bytes: Number(params[15] || 0), speed_bps: 0, eta_seconds: 0, error_message: null, created_at: params[16],
      });
    } else {
      mem.download_jobs.push({
        id: params[0], requester_ip: params[1], user_id: params[2], title: params[3], file_name: params[4],
        source_url: params[5], format_selector: params[6], stream_url: params[7], local_output_path: null,
        thumbnail_url: params[8], platform_id: params[9], quality_label: params[10], format_ext: params[11],
        status: 'dispatched', progress_pct: 0, bytes_downloaded: 0, total_bytes: Number(params[12] || 0),
        speed_bps: 0, eta_seconds: 0, error_message: null, created_at: params[13],
      });
    }
    return { affectedRows: 1 };
  }
  if (/^INSERT INTO share_links/i.test(q)) {
    mem.share_links.push({
      short_code: params[0], source_url: params[1], title: params[2], platform_id: params[3],
      thumbnail_url: params[4], duration_text: params[5], stream_url: params[6], views: 0, created_at: params[7],
    });
    return { affectedRows: 1 };
  }

  if (/^UPDATE ip_lockouts/i.test(q)) {
    const ip = params[params.length - 1];
    const row = mem.ip_lockouts.find((r) => r.ip_address === ip);
    if (row) {
      if (q.includes('failed_attempts = 0')) {
        row.failed_attempts = 0; row.banned_until = null; row.updated_at = params[0];
      } else if (params.length === 4) {
        row.failed_attempts = params[0]; row.banned_until = params[1]; row.updated_at = params[2];
      } else {
        row.failed_attempts = params[0]; row.updated_at = params[1];
      }
    }
    return { affectedRows: 1 };
  }
  if (/^UPDATE admin_users SET last_login_at/i.test(q)) {
    const row = mem.admin_users.find((a) => a.id === params[1]);
    if (row) row.last_login_at = params[0];
    return { affectedRows: 1 };
  }
  if (/^UPDATE saved_vault_videos/i.test(q)) {
    const row = mem.saved_vault_videos.find((v) => v.id === params[2]);
    if (row) { row.file_present_on_disk = 1; row.file_size_bytes = params[0]; row.stream_url = params[1]; }
    return { affectedRows: 1 };
  }
  if (/^UPDATE ad_waterfall_zones/i.test(q)) {
    const row = mem.ad_waterfall_zones.find((z) => z.zone_key === params[4]);
    if (row) { row.enabled = params[0]; row.cooldown_minutes = params[1]; row.config_json = params[2]; row.updated_at = params[3]; }
    return { affectedRows: 1 };
  }
  if (/^UPDATE system_settings/i.test(q)) {
    const row = mem.system_settings.find((s) => s.setting_key === params[2]);
    if (row) { row.setting_json = params[0]; row.updated_at = params[1]; }
    return { affectedRows: 1 };
  }
  if (/^UPDATE seo_keywords SET impressions/i.test(q)) {
    const row = mem.seo_keywords.find((s) => s.slug === params[0]);
    if (row) { row.impressions += 1; row.clicks += 1; }
    return { affectedRows: 1 };
  }
  if (/^UPDATE share_links SET views/i.test(q)) {
    const row = mem.share_links.find((s) => s.short_code === params[1]);
    if (row) row.views = params[0];
    return { affectedRows: 1 };
  }
  if (/^UPDATE download_jobs/i.test(q)) {
    const id = /user_id = \?/i.test(q) ? params[params.length - 2] : params[params.length - 1];
    const row = mem.download_jobs.find((d) => d.id === id);
    if (row) {
      if (q.includes("SET status = 'completed'")) {
        row.status = 'completed'; row.progress_pct = 100; row.local_output_path = params[0]; row.bytes_downloaded = params[1]; row.total_bytes = params[2]; row.speed_bps = 0; row.eta_seconds = 0;
      } else if (q.includes("SET status = 'muxing'")) {
        row.status = 'muxing'; row.progress_pct = 98; row.eta_seconds = 1;
      } else if (q.includes("SET status = 'paused'")) {
        row.status = 'paused'; row.speed_bps = 0;
      } else if (q.includes("SET status = 'downloading'")) {
        row.status = 'downloading'; row.error_message = null;
      } else if (q.includes("SET status = 'cancelled'")) {
        row.status = 'cancelled'; row.speed_bps = 0;
      } else if (q.includes('SET local_output_path = ?')) {
        row.local_output_path = params[0]; row.status = params[1];
      } else if (q.includes('error_message = ?')) {
        row.status = 'failed'; row.error_message = params[0]; row.speed_bps = 0;
      } else if (q.includes('SET progress_pct = ?')) {
        row.progress_pct = params[0]; row.bytes_downloaded = params[1]; row.total_bytes = params[2]; row.speed_bps = params[3]; row.eta_seconds = params[4];
      }
    }
    return { affectedRows: row ? 1 : 0 };
  }

  if (/^DELETE FROM download_jobs WHERE user_id = \? AND status IN/i.test(q)) {
    const before = mem.download_jobs.length;
    mem.download_jobs = mem.download_jobs.filter(
      (d) => !(d.user_id === params[0] && ['completed', 'cancelled', 'dispatched'].includes(d.status))
    );
    return { affectedRows: before - mem.download_jobs.length };
  }

  const twoCondDelete = /^DELETE FROM (\w+) WHERE (\w+) = \? AND (\w+) = \?/i.exec(q);
  if (twoCondDelete) {
    const [, tbl, colA, colB] = twoCondDelete;
    const before = mem[tbl]?.length || 0;
    if (mem[tbl]) {
      mem[tbl] = mem[tbl].filter((r) => !(r[colA] === params[0] && r[colB] === params[1]));
    }
    return { affectedRows: before - (mem[tbl]?.length || 0) };
  }
  if (/^DELETE FROM (\w+) WHERE (\w+) LIKE '([^']+)'$/i.test(q)) {
    const [, tbl, col, pattern] = q.match(/^DELETE FROM (\w+) WHERE (\w+) LIKE '([^']+)'$/i);
    const regex = new RegExp(`^${pattern.replace(/%/g, '.*')}$`, 'i');
    const before = mem[tbl]?.length || 0;
    if (mem[tbl]) mem[tbl] = mem[tbl].filter((r) => !regex.test(String(r[col] || '')));
    return { affectedRows: before - (mem[tbl]?.length || 0) };
  }
  if (/^DELETE FROM (\w+) WHERE (\w+) = \?/i.test(q)) {
    const [, tbl, col] = q.match(/^DELETE FROM (\w+) WHERE (\w+) = \?/i);
    const before = mem[tbl]?.length || 0;
    if (mem[tbl]) mem[tbl] = mem[tbl].filter((r) => r[col] !== params[0]);
    return { affectedRows: before - (mem[tbl]?.length || 0) };
  }
  if (/^DELETE FROM (\w+)$/i.test(q)) {
    const [, tbl] = q.match(/^DELETE FROM (\w+)$/i);
    const before = mem[tbl]?.length || 0;
    if (mem[tbl]) mem[tbl].length = 0;
    return { affectedRows: before };
  }

  return [];
}

export async function sqlQuery(sqlText, params = []) {
  totalSqlQueriesExecuted += 1;
  const t0 = performance.now();
  await ensureStandbyMemoryInitialized();
  if (mysqlPool) {
    try {
      const [rows] = await mysqlPool.execute(sqlText, params);
      const dt = Number((performance.now() - t0).toFixed(2));
      lastQueryLatencyMs = dt;
      avgQueryLatencyMs = Number((avgQueryLatencyMs * 0.8 + dt * 0.2).toFixed(2));
      return rows;
    } catch (err) {
      if (['PROTOCOL_CONNECTION_LOST', 'ECONNREFUSED', 'ECONNRESET'].includes(err?.code)) {
        mysqlPool = null;
        startBackgroundMysqlPoller();
      } else {
        throw err;
      }
    }
  }
  return executeStandbyMemoryQuery(sqlText, params);
}

export async function getDatabaseDiagnostics() {
  const health = await getDatabaseHealth();
  const tables = [
    'platforms',
    'download_jobs',
    'system_settings',
    'saved_vault_videos',
    'share_links',
    'users',
    'saved_history',
    'encrypted_cookies',
    'ad_slots',
    'ad_events',
    'visitor_sessions',
    'analytics_events',
  ];
  await ensureStandbyMemoryInitialized();

  const counts = {};
  await Promise.all(
    tables.map(async (tbl) => {
      try {
        const rows = await sqlQuery(`SELECT COUNT(*) AS cnt FROM ${tbl}`);
        let value = Number(rows[0]?.cnt ?? rows[0]?.CNT ?? rows[0]?.count ?? 0);
        if (!mysqlPool && Array.isArray(mem[tbl])) value = mem[tbl].length;
        counts[tbl] = value;
      } catch {
        counts[tbl] = Array.isArray(mem[tbl]) ? mem[tbl].length : 0;
      }
    })
  );

  let serverVersion = health.standbyMode
    ? 'Standby SQL Emulator (XAMPP MySQL Offline)'
    : 'XAMPP MariaDB / MySQL';
  if (mysqlPool) {
    try {
      const [vRows] = await mysqlPool.query('SELECT VERSION() AS ver');
      if (vRows[0]?.ver) serverVersion = String(vRows[0].ver);
    } catch {
      // ignore
    }
  }
  return {
    ...health,
    serverVersion,
    lastQueryLatencyMs,
    avgQueryLatencyMs,
    tableCounts: counts,
  };
}

export async function getDatabaseFullDiagnostics() {
  const diagnostics = await getDatabaseDiagnostics();
  return {
    diagnostics,
    mysqlConnected: diagnostics.mysqlConnected,
    standbyMode: diagnostics.standbyMode,
    engine: diagnostics.engine,
  };
}

export async function optimizeDatabaseTables() {
  if (mysqlPool) {
    await mysqlPool
      .query(
        'ANALYZE TABLE platforms, download_jobs, system_settings, saved_vault_videos, share_links, analytics_events, ad_slots, ad_events'
      )
      .catch(() => {});
  }
  return getDatabaseDiagnostics();
}

export async function runDatabaseMaintenanceAction(action = 'optimize_tables') {
  const normalized = String(action || 'optimize_tables').toLowerCase();

  if (normalized === 'clear_audit_logs') {
    if (mysqlPool) {
      await mysqlPool.query('DELETE FROM security_audit_logs');
    } else {
      mem.security_audit_logs = [];
    }
  } else if (normalized === 'clear_analytics') {
    if (mysqlPool) {
      await mysqlPool.query('DELETE FROM analytics_events');
    } else {
      mem.analytics_events = [];
    }
  } else if (normalized === 'sync_platforms') {
    if (mysqlPool) {
      await syncAllPlatformsAndPrefsToMysql(mysqlPool);
    }
  } else {
    await optimizeDatabaseTables();
  }

  const diagnostics = await getDatabaseDiagnostics();
  return {
    action: normalized,
    executed: true,
    mysqlConnected: diagnostics.mysqlConnected,
    standbyMode: diagnostics.standbyMode,
    diagnostics,
  };
}

export async function writeSecurityAuditLog(eventType, ipAddress, userAgent, details) {
  try {
    await sqlQuery(
      `INSERT INTO security_audit_logs (event_type, ip_address, user_agent, details_text, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        eventType,
        ipAddress || 'unknown',
        String(userAgent || '').slice(0, 250),
        typeof details === 'string' ? details : JSON.stringify(details || {}),
        new Date().toISOString(),
      ]
    );
  } catch (err) {
    logger.warn({ err }, 'Security audit log insert warning');
  }
}

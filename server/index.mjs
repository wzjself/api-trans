import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = Number(process.env.PORT || 3000);
const DIST_DIR = path.join(__dirname, '..', 'dist');
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'change-me-token-secret';
const APP_BASE_URL = process.env.APP_BASE_URL || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'wzjself';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'wzj147258';
const ADMIN_INITIAL_BALANCE = Number(process.env.ADMIN_INITIAL_BALANCE || 1000000);
const USER_INITIAL_BALANCE = Number(process.env.USER_INITIAL_BALANCE || 100000);

const MYSQL_HOST = process.env.MYSQL_HOST || 'host.docker.internal';
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'wzjself';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'api_trans';

app.use(express.json({ limit: '100mb' }));

const pool = mysql.createPool({
  host: MYSQL_HOST,
  port: MYSQL_PORT,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix = '') {
  return `${prefix}${crypto.randomBytes(12).toString('hex')}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, encoded = '') {
  const [salt, original] = encoded.split(':');
  if (!salt || !original) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(original));
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token = '') {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (payload.exp && payload.exp < Date.now()) return null;
  return payload;
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return {
    uid: rest.uid,
    email: rest.email,
    role: rest.role,
    balance: Number(rest.balance || 0),
    usedQuota: Number(rest.used_quota || 0),
    requestCount: Number(rest.request_count || 0),
    quotaType: rest.quota_type || 'none',
    dailyQuota: Number(rest.daily_quota || 0),
    quotaExpiresAt: rest.quota_expires_at,
    createdAt: rest.created_at,
    updatedAt: rest.updated_at,
  };
}

function parseModelsJson(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    }
  }
  if (typeof value === 'object') {
    if (Buffer.isBuffer(value)) {
      try {
        const parsed = JSON.parse(value.toString('utf8'));
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
      } catch {
        return [];
      }
    }
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }
  return [];
}

async function query(sql, params = {}) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function getSetting(key, fallback = null) {
  const rows = await query('SELECT setting_value FROM settings WHERE setting_key = :key LIMIT 1', { key });
  if (!rows.length) return fallback;
  const rawValue = rows[0].setting_value;
  if (rawValue == null) return fallback;
  if (Buffer.isBuffer(rawValue)) {
    try {
      return JSON.parse(rawValue.toString('utf8'));
    } catch {
      return fallback;
    }
  }
  if (typeof rawValue === 'string') {
    try {
      return JSON.parse(rawValue);
    } catch {
      return fallback;
    }
  }
  if (typeof rawValue === 'object') {
    return rawValue;
  }
  return fallback;
}

async function setSetting(key, value) {
  await query(
    `INSERT INTO settings (setting_key, setting_value, updated_at)
     VALUES (:key, :value, NOW())
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
    { key, value: JSON.stringify(value) }
  );
}

async function getUserByUid(uid) {
  const rows = await query('SELECT * FROM users WHERE uid = :uid LIMIT 1', { uid });
  return rows[0] || null;
}

async function getUserByEmail(email) {
  const rows = await query('SELECT * FROM users WHERE email = :email LIMIT 1', { email });
  return rows[0] || null;
}

async function getEnabledProviders() {
  const rows = await query('SELECT * FROM upstream_providers WHERE enabled = 1 ORDER BY updated_at DESC, created_at DESC');
  return rows;
}

async function getProviderRouting(modelHint = '') {
  const settings = await getSetting('system', {});
  const defaultModel = settings.defaultModel || '';
  const requestedModel = String(modelHint || defaultModel || '').trim();
  const providers = await getEnabledProviders();
  if (!providers.length) return { provider: null, model: requestedModel, providers: [] };

  if (!requestedModel) {
    return { provider: providers[0], model: '', providers };
  }

  const matched = providers.find((row) => {
    const models = parseModelsJson(row.models_json);
    return models.includes(requestedModel);
  });

  return { provider: matched || providers[0], model: requestedModel, providers };
}

async function ensureColumn(tableName, columnName, alterSql) {
  const rows = await query(
    `SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { schema: MYSQL_DATABASE, table: tableName, column: columnName }
  );
  if (Number(rows[0]?.count || 0) === 0) {
    await query(alterSql);
  }
}

async function ensureSchema() {
  await query(`CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    uid VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(191) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role ENUM('admin','user') NOT NULL DEFAULT 'user',
    balance BIGINT NOT NULL DEFAULT 0,
    used_quota BIGINT NOT NULL DEFAULT 0,
    request_count BIGINT NOT NULL DEFAULT 0,
    quota_type ENUM('none','daily','monthly','permanent') NOT NULL DEFAULT 'none',
    daily_quota BIGINT NOT NULL DEFAULT 0,
    quota_expires_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS api_keys (
    id VARCHAR(64) PRIMARY KEY,
    uid VARCHAR(64) NOT NULL,
    name VARCHAR(191) NOT NULL,
    api_key VARCHAR(191) NOT NULL UNIQUE,
    status ENUM('active','revoked') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_api_keys_uid (uid),
    CONSTRAINT fk_api_keys_user FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS usage_logs (
    id VARCHAR(64) PRIMARY KEY,
    uid VARCHAR(64) NOT NULL,
    model VARCHAR(191) NULL,
    provider_id VARCHAR(64) NULL,
    tokens BIGINT NOT NULL DEFAULT 0,
    request_path VARCHAR(191) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_usage_uid_created (uid, created_at),
    CONSTRAINT fk_usage_user FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS consume_logs (
    id VARCHAR(64) PRIMARY KEY,
    uid VARCHAR(64) NOT NULL,
    api_key_id VARCHAR(64) NULL,
    provider_id VARCHAR(64) NULL,
    model VARCHAR(191) NULL,
    request_path VARCHAR(191) NULL,
    prompt_tokens BIGINT NOT NULL DEFAULT 0,
    completion_tokens BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    consumed_quota BIGINT NOT NULL DEFAULT 0,
    status_code INT NOT NULL DEFAULT 0,
    success TINYINT(1) NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_consume_uid_created (uid, created_at),
    CONSTRAINT fk_consume_user FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS redemption_codes (
    code VARCHAR(64) PRIMARY KEY,
    type ENUM('permanent','daily','monthly') NOT NULL,
    value BIGINT NOT NULL DEFAULT 0,
    duration_days INT NOT NULL DEFAULT 0,
    is_used TINYINT(1) NOT NULL DEFAULT 0,
    used_by VARCHAR(64) NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS settings (
    setting_key VARCHAR(64) PRIMARY KEY,
    setting_value JSON NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`CREATE TABLE IF NOT EXISTS upstream_providers (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(191) NOT NULL,
    base_url VARCHAR(500) NOT NULL,
    api_key TEXT NULL,
    models_json JSON NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await ensureColumn('users', 'used_quota', 'ALTER TABLE users ADD COLUMN used_quota BIGINT NOT NULL DEFAULT 0');
  await ensureColumn('users', 'request_count', 'ALTER TABLE users ADD COLUMN request_count BIGINT NOT NULL DEFAULT 0');

  const admin = await getUserByEmail(ADMIN_EMAIL);
  const adminHash = hashPassword(ADMIN_PASSWORD);
  if (!admin) {
    await query(
      `INSERT INTO users (uid, email, password_hash, role, balance, quota_type, daily_quota)
       VALUES (:uid, :email, :password_hash, 'admin', :balance, 'none', 0)`,
      {
        uid: 'admin-123',
        email: ADMIN_EMAIL,
        password_hash: adminHash,
        balance: ADMIN_INITIAL_BALANCE,
      }
    );
  } else {
    await query(
      `UPDATE users SET password_hash = :password_hash, role = 'admin', updated_at = NOW() WHERE email = :email`,
      { password_hash: adminHash, email: ADMIN_EMAIL }
    );
  }

  const currentSettings = await getSetting('system', null);
  if (!currentSettings) {
    await setSetting('system', {
      guideLink: '',
      announcement: '',
      appBaseUrl: APP_BASE_URL,
      defaultModel: '',
    });
  } else {
    await setSetting('system', {
      guideLink: currentSettings.guideLink || '',
      announcement: currentSettings.announcement || '',
      appBaseUrl: APP_BASE_URL || currentSettings.appBaseUrl || '',
      defaultModel: currentSettings.defaultModel || currentSettings.activeModel || '',
    });
  }

  const welcomeCode = await query('SELECT code FROM redemption_codes WHERE code = :code', { code: 'WELCOME666' });
  if (!welcomeCode.length) {
    await query(
      `INSERT INTO redemption_codes (code, type, value, duration_days, is_used) VALUES ('WELCOME666', 'permanent', 50000, 0, 0)`
    );
  }
}

async function authMiddleware(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
    const token = auth.slice(7);
    const payload = verifyToken(token);
    if (!payload?.uid) return res.status(401).json({ error: 'Invalid token' });
    const user = await getUserByUid(payload.uid);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function adminMiddleware(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

async function getQuotaStatus(user) {
  if (!user) return { type: 'none', remaining: 0 };
  if (user.quota_type === 'daily' || user.quota_type === 'monthly') {
    if (user.quota_expires_at && new Date(user.quota_expires_at).getTime() < Date.now()) {
      await query(
        `UPDATE users SET quota_type = 'none', daily_quota = 0, quota_expires_at = NULL WHERE uid = :uid`,
        { uid: user.uid }
      );
      user.quota_type = 'none';
      user.daily_quota = 0;
      user.quota_expires_at = null;
      return { type: 'none', remaining: Number(user.balance || 0) };
    }
    const todayRows = await query(
      `SELECT COALESCE(SUM(tokens),0) AS total FROM usage_logs
       WHERE uid = :uid
         AND DATE(CONVERT_TZ(created_at, '+00:00', '+08:00')) = DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR)`,
      { uid: user.uid }
    );
    const usedToday = Number(todayRows[0]?.total || 0);
    return { type: user.quota_type, remaining: Math.max(0, Number(user.daily_quota || 0) - usedToday) };
  }
  return { type: 'permanent', remaining: Math.max(0, Number(user.balance || 0)) };
}

async function chargeUser(user, tokens, model = 'unknown', providerId = null, requestPath = null, promptTokens = 0, completionTokens = 0, apiKeyId = null, statusCode = 200, success = 1, errorMessage = null) {
  const amount = Math.max(0, Number(tokens || 0));
  const quota = await getQuotaStatus(user);
  if (quota.remaining < amount) {
    throw new Error(`额度不足，剩余 ${quota.remaining} Tokens`);
  }
  if (!(quota.type === 'daily' || quota.type === 'monthly')) {
    await query(
      'UPDATE users SET balance = GREATEST(balance - :amount, 0), used_quota = used_quota + :amount, request_count = request_count + 1 WHERE uid = :uid',
      { amount, uid: user.uid }
    );
  } else {
    await query(
      'UPDATE users SET used_quota = used_quota + :amount, request_count = request_count + 1 WHERE uid = :uid',
      { amount, uid: user.uid }
    );
  }
  await query(
    `INSERT INTO usage_logs (id, uid, model, provider_id, tokens, request_path)
     VALUES (:id, :uid, :model, :provider_id, :tokens, :request_path)`,
    {
      id: randomId('log_'),
      uid: user.uid,
      model,
      provider_id: providerId,
      tokens: amount,
      request_path: requestPath,
    }
  );
  await query(
    `INSERT INTO consume_logs (id, uid, api_key_id, provider_id, model, request_path, prompt_tokens, completion_tokens, total_tokens, consumed_quota, status_code, success, error_message)
     VALUES (:id, :uid, :api_key_id, :provider_id, :model, :request_path, :prompt_tokens, :completion_tokens, :total_tokens, :consumed_quota, :status_code, :success, :error_message)`,
    {
      id: randomId('consume_'),
      uid: user.uid,
      api_key_id: apiKeyId,
      provider_id: providerId,
      model,
      request_path: requestPath,
      prompt_tokens: Number(promptTokens || 0),
      completion_tokens: Number(completionTokens || 0),
      total_tokens: amount,
      consumed_quota: amount,
      status_code: Number(statusCode || 0),
      success: success ? 1 : 0,
      error_message: errorMessage,
    }
  );
}

async function recordRequestOnly(user, apiKeyId, providerId, model, requestPath, statusCode = 0, success = 0, errorMessage = null) {
  await query(
    'UPDATE users SET request_count = request_count + 1 WHERE uid = :uid',
    { uid: user.uid }
  );
  await query(
    `INSERT INTO consume_logs (id, uid, api_key_id, provider_id, model, request_path, prompt_tokens, completion_tokens, total_tokens, consumed_quota, status_code, success, error_message)
     VALUES (:id, :uid, :api_key_id, :provider_id, :model, :request_path, 0, 0, 0, 0, :status_code, :success, :error_message)`,
    {
      id: randomId('consume_'),
      uid: user.uid,
      api_key_id: apiKeyId,
      provider_id: providerId,
      model,
      request_path: requestPath,
      status_code: Number(statusCode || 0),
      success: success ? 1 : 0,
      error_message: errorMessage,
    }
  );
}

function extractUsageFromPayload(json, fallbackModel = 'unknown') {
  const model = json?.model || fallbackModel || 'unknown';
  const usage = json?.usage || {};
  let promptTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0);
  let completionTokens = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0);
  let totalTokens = Number(usage?.total_tokens ?? (promptTokens + completionTokens) ?? 0);

  if (json?.message?.usage) {
    promptTokens = Number(json.message.usage?.input_tokens ?? promptTokens);
    completionTokens = Number(json.message.usage?.output_tokens ?? completionTokens);
    totalTokens = Number(json.message.usage?.total_tokens ?? (promptTokens + completionTokens));
  }

  if (json?.type === 'message_start' && json?.message?.usage) {
    promptTokens = Number(json.message.usage?.input_tokens ?? promptTokens);
    totalTokens = Number(promptTokens + completionTokens);
  }

  if (json?.type === 'message_delta' && json?.usage) {
    completionTokens = Number(json.usage?.output_tokens ?? completionTokens);
    totalTokens = Number(promptTokens + completionTokens);
  }

  if (json?.response?.usage) {
    promptTokens = Number(json.response.usage?.input_tokens ?? promptTokens);
    completionTokens = Number(json.response.usage?.output_tokens ?? completionTokens);
    totalTokens = Number(json.response.usage?.total_tokens ?? (promptTokens + completionTokens));
  }

  return { model, promptTokens, completionTokens, totalTokens };
}

async function findUserByApiKey(key) {
  const rows = await query(
    `SELECT ak.id, ak.uid, ak.name, ak.api_key, ak.status, u.*
     FROM api_keys ak
     JOIN users u ON ak.uid = u.uid
     WHERE ak.api_key = :key AND ak.status = 'active'
     LIMIT 1`,
    { key }
  );
  if (!rows.length) return null;
  return rows[0];
}

app.get('/api/health', async (_req, res) => {
  const routing = await getProviderRouting();
  res.json({
    ok: true,
    appBaseUrl: APP_BASE_URL || null,
    mysql: true,
    upstreamConfigured: Boolean(routing.provider?.base_url),
    activeProvider: routing.provider ? { id: routing.provider.id, name: routing.provider.name } : null,
    activeModel: routing.model || '',
    enabledProviders: routing.providers.length,
  });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: '账号和密码必填' });
  const existing = await getUserByEmail(email);
  if (existing) return res.status(409).json({ error: '账号已存在' });
  const uid = randomId('user_');
  await query(
    `INSERT INTO users (uid, email, password_hash, role, balance, quota_type, daily_quota)
     VALUES (:uid, :email, :password_hash, 'user', :balance, 'none', 0)`,
    { uid, email, password_hash: hashPassword(password), balance: USER_INITIAL_BALANCE }
  );
  const user = await getUserByUid(uid);
  const token = signToken({ uid, exp: Date.now() + 30 * 24 * 3600 * 1000 });
  res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '账号或密码错误' });
  }
  const token = signToken({ uid: user.uid, exp: Date.now() + 30 * 24 * 3600 * 1000 });
  res.json({ token, user: sanitizeUser(user) });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const fresh = await getUserByUid(req.user.uid);
  res.json({ user: sanitizeUser(fresh) });
});

app.get('/api/settings', async (_req, res) => {
  const system = await getSetting('system', {});
  res.json(system || {});
});

app.put('/api/settings', authMiddleware, adminMiddleware, async (req, res) => {
  const current = await getSetting('system', {});
  const nextValue = { ...current, ...(req.body || {}) };
  await setSetting('system', nextValue);
  res.json(nextValue);
});

app.get('/api/admin/providers', authMiddleware, adminMiddleware, async (_req, res) => {
  const rows = await query('SELECT * FROM upstream_providers ORDER BY created_at DESC');
  const system = await getSetting('system', {});
  res.json({
    providers: rows.map((row) => ({
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      apiKey: row.api_key,
      enabled: Boolean(row.enabled),
      models: parseModelsJson(row.models_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    defaultModel: system.defaultModel || '',
  });
});

app.post('/api/admin/providers/fetch-models', authMiddleware, adminMiddleware, async (req, res) => {
  const baseUrl = String(req.body?.baseUrl || '').replace(/\/$/, '');
  const apiKey = String(req.body?.apiKey || '');
  if (!baseUrl) return res.status(400).json({ error: 'baseUrl is required' });

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    });
    const text = await response.text();
    let models = [];
    try {
      const json = JSON.parse(text);
      models = Array.isArray(json?.data) ? json.data.map((item) => item.id).filter(Boolean) : [];
    } catch {}
    res.json({ ok: response.ok, status: response.status, models, raw: text.slice(0, 5000) });
  } catch (error) {
    res.status(502).json({ error: 'Fetch models failed', detail: String(error) });
  }
});

app.post('/api/admin/providers', authMiddleware, adminMiddleware, async (req, res) => {
  const body = req.body || {};
  const id = body.id || randomId('prov_');
  const models = Array.isArray(body.models) ? body.models : [];
  await query(
    `INSERT INTO upstream_providers (id, name, base_url, api_key, models_json, enabled)
     VALUES (:id, :name, :base_url, :api_key, :models_json, :enabled)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       base_url = VALUES(base_url),
       api_key = VALUES(api_key),
       models_json = VALUES(models_json),
       enabled = VALUES(enabled),
       updated_at = NOW()`,
    {
      id,
      name: body.name || '未命名渠道',
      base_url: String(body.baseUrl || '').replace(/\/$/, ''),
      api_key: body.apiKey || '',
      models_json: JSON.stringify(models),
      enabled: body.enabled === false ? 0 : 1,
    }
  );
  const rows = await query('SELECT * FROM upstream_providers WHERE id = :id LIMIT 1', { id });
  const row = rows[0];
  res.json({
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    enabled: Boolean(row.enabled),
    models: parseModelsJson(row.models_json),
  });
});

app.delete('/api/admin/providers/:id', authMiddleware, adminMiddleware, async (req, res) => {
  await query('DELETE FROM upstream_providers WHERE id = :id', { id: req.params.id });
  res.json({ ok: true });
});

app.put('/api/admin/providers/:id/enabled', authMiddleware, adminMiddleware, async (req, res) => {
  await query('UPDATE upstream_providers SET enabled = :enabled WHERE id = :id', { id: req.params.id, enabled: req.body?.enabled ? 1 : 0 });
  res.json({ ok: true });
});

app.put('/api/admin/default-model', authMiddleware, adminMiddleware, async (req, res) => {
  const current = await getSetting('system', {});
  const nextValue = {
    ...current,
    defaultModel: req.body?.defaultModel || '',
  };
  await setSetting('system', nextValue);
  res.json(nextValue);
});

app.get('/api/users/me/api-keys', authMiddleware, async (req, res) => {
  const rows = await query(
    'SELECT id, name, api_key AS `key`, status, created_at AS createdAt FROM api_keys WHERE uid = :uid ORDER BY created_at DESC',
    { uid: req.user.uid }
  );
  res.json(rows);
});

app.post('/api/users/me/api-keys', authMiddleware, async (req, res) => {
  const requestedName = String(req.body?.name || '').trim();
  const autoName = `key-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(2).toString('hex')}`;
  const record = {
    id: randomId('key_'),
    uid: req.user.uid,
    name: requestedName || autoName,
    api_key: `sk-live-${crypto.randomBytes(18).toString('hex')}`,
  };
  await query(
    `INSERT INTO api_keys (id, uid, name, api_key, status) VALUES (:id, :uid, :name, :api_key, 'active')`,
    record
  );
  res.json({ id: record.id, name: record.name, key: record.api_key, status: 'active', createdAt: nowIso() });
});

app.delete('/api/api-keys/:id', authMiddleware, async (req, res) => {
  await query('DELETE FROM api_keys WHERE id = :id AND uid = :uid', { id: req.params.id, uid: req.user.uid });
  res.json({ ok: true });
});

app.get('/api/users/me/logs', authMiddleware, async (req, res) => {
  const limit = Number(req.query.limit || 50);
  const rows = await query(
    `SELECT id, model, tokens, created_at AS timestamp FROM usage_logs WHERE uid = :uid ORDER BY created_at DESC LIMIT ${Math.min(limit, 500)}`,
    { uid: req.user.uid }
  );
  res.json(rows);
});

app.get('/api/users/me/consume-logs', authMiddleware, async (req, res) => {
  const limit = Number(req.query.limit || 50);
  const rows = await query(
    `SELECT id, model, request_path AS requestPath, prompt_tokens AS promptTokens, completion_tokens AS completionTokens, total_tokens AS totalTokens, consumed_quota AS consumedQuota, status_code AS statusCode, success, error_message AS errorMessage, created_at AS createdAt
     FROM consume_logs WHERE uid = :uid ORDER BY created_at DESC LIMIT ${Math.min(limit, 500)}`,
    { uid: req.user.uid }
  );
  res.json(rows);
});

app.get('/api/admin/platform-summary', authMiddleware, adminMiddleware, async (_req, res) => {
  const [userRow] = await query('SELECT COUNT(*) AS totalUsers FROM users');
  const [keyRow] = await query('SELECT COUNT(*) AS totalApiKeys FROM api_keys WHERE status = "active"');
  const [usageRow] = await query('SELECT COUNT(*) AS totalRequests, COALESCE(SUM(tokens),0) AS totalTokens FROM usage_logs');
  const [todayRow] = await query(`SELECT COALESCE(SUM(tokens),0) AS todayTokens
    FROM usage_logs
    WHERE DATE(CONVERT_TZ(created_at, '+00:00', '+08:00')) = DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR)`);
  const [rpmRow] = await query('SELECT COUNT(*) AS rpm FROM usage_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)');
  const [tpmRow] = await query('SELECT COALESCE(SUM(tokens),0) AS tpm FROM usage_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)');
  res.json({
    totalUsers: Number(userRow?.totalUsers || 0),
    totalApiKeys: Number(keyRow?.totalApiKeys || 0),
    totalRequests: Number(usageRow?.totalRequests || 0),
    totalTokens: Number(usageRow?.totalTokens || 0),
    todayTokens: Number(todayRow?.todayTokens || 0),
    rpm: Number(rpmRow?.rpm || 0),
    tpm: Number(tpmRow?.tpm || 0),
  });
});

app.get('/api/admin/platform-trend', authMiddleware, adminMiddleware, async (_req, res) => {
  const rows = await query(`
    WITH RECURSIVE days AS (
      SELECT DATE_SUB(DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR), INTERVAL 13 DAY) AS d
      UNION ALL
      SELECT DATE_ADD(d, INTERVAL 1 DAY) FROM days WHERE d < DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR)
    )
    SELECT
      DATE_FORMAT(days.d, '%m-%d') AS day,
      COALESCE(COUNT(ul.id), 0) AS requests,
      COALESCE(SUM(ul.tokens), 0) AS tokens
    FROM days
    LEFT JOIN usage_logs ul ON DATE(CONVERT_TZ(ul.created_at, '+00:00', '+08:00')) = days.d
    GROUP BY days.d
    ORDER BY days.d ASC
  `);
  res.json(rows.map((row) => ({
    day: row.day,
    requests: Number(row.requests || 0),
    tokens: Number(row.tokens || 0),
  })));
});

app.post('/api/users/me/logs/simulate', authMiddleware, async (req, res) => {
  const { tokens = 1000, model = 'gpt-4-turbo' } = req.body || {};
  try {
    await chargeUser(req.user, tokens, model, null, 'simulate');
    const fresh = await getUserByUid(req.user.uid);
    res.json({ ok: true, user: sanitizeUser(fresh) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/redeem', authMiddleware, async (req, res) => {
  const { code } = req.body || {};
  const rows = await query('SELECT * FROM redemption_codes WHERE code = :code LIMIT 1', { code });
  const item = rows[0];
  if (!item || Number(item.is_used) === 1) return res.status(400).json({ error: '无效或已使用的兑换码' });
  if (item.type === 'permanent') {
    await query('UPDATE users SET balance = balance + :value WHERE uid = :uid', { value: Number(item.value || 0), uid: req.user.uid });
  } else {
    const currentUser = await getUserByUid(req.user.uid);
    const hasActiveQuotaCard = currentUser
      && ['daily', 'monthly'].includes(String(currentUser.quota_type || ''))
      && currentUser.quota_expires_at
      && new Date(currentUser.quota_expires_at).getTime() > Date.now();

    if (hasActiveQuotaCard) {
      const mergedQuotaType = (currentUser.quota_type === 'monthly' || item.type === 'monthly') ? 'monthly' : 'daily';
      const mergedDailyQuota = Math.max(Number(currentUser.daily_quota || 0), Number(item.value || 0));
      await query(
        `UPDATE users
         SET quota_type = :quota_type,
             daily_quota = :daily_quota,
             quota_expires_at = TIMESTAMP(DATE(DATE_ADD(quota_expires_at, INTERVAL :duration_days DAY)), '23:59:59')
         WHERE uid = :uid`,
        {
          quota_type: mergedQuotaType,
          daily_quota: mergedDailyQuota,
          duration_days: Number(item.duration_days || 30),
          uid: req.user.uid,
        }
      );
    } else {
      await query(
        `UPDATE users SET quota_type = :quota_type, daily_quota = :daily_quota,
         quota_expires_at = TIMESTAMP(DATE(DATE_ADD(NOW(), INTERVAL :duration_days DAY)), '23:59:59') WHERE uid = :uid`,
        {
          quota_type: item.type,
          daily_quota: Number(item.value || 0),
          duration_days: Number(item.duration_days || 30),
          uid: req.user.uid,
        }
      );
    }
  }
  await query(
    'UPDATE redemption_codes SET is_used = 1, used_by = :uid, used_at = NOW() WHERE code = :code',
    { uid: req.user.uid, code }
  );
  const fresh = await getUserByUid(req.user.uid);
  res.json({ ok: true, user: sanitizeUser(fresh) });
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  const quotaType = String(req.query.quotaType || '').trim();
  const allowedQuotaTypes = new Set(['daily', 'monthly', 'permanent', 'none']);
  const whereClause = allowedQuotaTypes.has(quotaType) ? 'WHERE u.quota_type = :quotaType' : '';
  const rows = await query(`
    SELECT
      u.uid,
      u.email,
      u.role,
      u.balance,
      u.quota_type AS quotaType,
      u.daily_quota AS dailyQuota,
      u.quota_expires_at AS quotaExpiresAt,
      u.created_at AS createdAt,
      u.updated_at AS updatedAt,
      COALESCE(SUM(ul.tokens),0) AS totalUsedTokens,
      COUNT(DISTINCT ak.id) AS apiKeyCount
    FROM users u
    LEFT JOIN usage_logs ul ON ul.uid = u.uid
    LEFT JOIN api_keys ak ON ak.uid = u.uid AND ak.status = 'active'
    ${whereClause}
    GROUP BY u.uid, u.email, u.role, u.balance, u.quota_type, u.daily_quota, u.quota_expires_at, u.created_at, u.updated_at
    ORDER BY u.created_at DESC
  `, allowedQuotaTypes.has(quotaType) ? { quotaType } : {});
  res.json(rows.map((row) => ({
    ...row,
    balance: Number(row.balance || 0),
    dailyQuota: Number(row.dailyQuota || 0),
    totalUsedTokens: Number(row.totalUsedTokens || 0),
    apiKeyCount: Number(row.apiKeyCount || 0),
  })));
});

app.patch('/api/admin/users/:uid/balance', authMiddleware, adminMiddleware, async (req, res) => {
  await query('UPDATE users SET balance = :balance WHERE uid = :uid', { balance: Number(req.body?.balance || 0), uid: req.params.uid });
  const user = await getUserByUid(req.params.uid);
  res.json(sanitizeUser(user));
});

app.delete('/api/admin/users/:uid', authMiddleware, adminMiddleware, async (req, res) => {
  if (req.user.uid === req.params.uid) {
    return res.status(400).json({ error: '不能删除当前登录管理员账号' });
  }
  await query('DELETE FROM users WHERE uid = :uid', { uid: req.params.uid });
  res.json({ ok: true });
});

app.get('/api/admin/codes', authMiddleware, adminMiddleware, async (_req, res) => {
  const rows = await query('SELECT * FROM redemption_codes ORDER BY created_at DESC');
  res.json(rows.map((row) => ({
    code: row.code,
    type: row.type,
    value: Number(row.value || 0),
    durationDays: Number(row.duration_days || 0),
    isUsed: Boolean(row.is_used),
    createdAt: row.created_at,
    usedBy: row.used_by,
    usedAt: row.used_at,
  })));
});

app.post('/api/admin/codes', authMiddleware, adminMiddleware, async (req, res) => {
  const body = req.body || {};
  const count = Math.max(1, Math.min(200, Number(body.count || 1)));
  const type = body.type || 'permanent';
  const defaultValue = type === 'permanent' ? 1000 : 150000000;
  const defaultDuration = type === 'daily' ? 1 : type === 'monthly' ? 30 : 0;
  const value = Number(body.value ?? defaultValue);
  const durationDays = Number(body.durationDays ?? defaultDuration);
  const createdAt = nowIso();
  const created = [];

  for (let i = 0; i < count; i++) {
    const code = count === 1 && body.code
      ? body.code
      : `NX-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    await query(
      `INSERT INTO redemption_codes (code, type, value, duration_days, is_used)
       VALUES (:code, :type, :value, :duration_days, 0)`,
      {
        code,
        type,
        value,
        duration_days: durationDays,
      }
    );
    created.push({ code, type, value, durationDays, isUsed: false, createdAt });
  }

  res.json(count === 1 ? created[0] : { items: created, count: created.length });
});

app.delete('/api/admin/codes/:code', authMiddleware, adminMiddleware, async (req, res) => {
  await query('DELETE FROM redemption_codes WHERE code = :code', { code: req.params.code });
  res.json({ ok: true });
});

app.get('/v1/models', async (_req, res) => {
  const routing = await getProviderRouting();
  const provider = routing.provider;
  if (!provider) {
    return res.json({ object: 'list', data: [{ id: 'unconfigured', object: 'model', owned_by: 'local' }] });
  }

  const localModels = parseModelsJson(provider.models_json);

  if (localModels.length > 0) {
    return res.json({ object: 'list', data: localModels.map((m) => ({ id: m, object: 'model', owned_by: provider.name })) });
  }

  try {
    const response = await fetch(`${provider.base_url.replace(/\/$/, '')}/models`, {
      headers: {
        'Content-Type': 'application/json',
        ...(provider.api_key ? { Authorization: `Bearer ${provider.api_key}` } : {}),
      },
    });
    const text = await response.text();
    res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(text);
  } catch (error) {
    res.status(502).json({ error: 'Upstream unavailable', detail: String(error) });
  }
});

app.post('/api/users/me/api-keys/:id/test-models', authMiddleware, async (req, res) => {
  const rows = await query('SELECT * FROM api_keys WHERE id = :id AND uid = :uid LIMIT 1', { id: req.params.id, uid: req.user.uid });
  const keyRecord = rows[0];
  if (!keyRecord) return res.status(404).json({ error: 'API key not found' });

  const routing = await getProviderRouting();
  const provider = routing.provider;
  if (!provider?.base_url) return res.status(503).json({ error: 'No enabled upstream provider configured' });

  try {
    const response = await fetch(`${APP_BASE_URL.replace(/\/$/, '')}/v1/models`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${keyRecord.api_key}`,
      },
    });
    const text = await response.text();
    let models = [];
    try {
      const json = JSON.parse(text);
      models = Array.isArray(json?.data) ? json.data.map((item) => item.id).filter(Boolean) : [];
    } catch {}
    res.json({ ok: response.ok, status: response.status, models, raw: text.slice(0, 5000) });
  } catch (error) {
    res.status(502).json({ error: 'Test request failed', detail: String(error) });
  }
});

app.all(/^\/v1\/(.+)/, async (req, res) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing API key' });
  const apiKey = auth.slice(7);
  const found = await findUserByApiKey(apiKey);
  if (!found) return res.status(401).json({ error: 'Invalid API key' });

  const routing = await getProviderRouting(req.body?.model || '');
  const provider = routing.provider;
  const activeModel = routing.model;
  const requestPath = `/v1/${req.params[0] || ''}`;
  const requestedModel = req.body?.model || activeModel || 'unknown';
  if (!provider?.base_url) {
    await recordRequestOnly(found, found.id, null, requestedModel, requestPath, 503, 0, 'No enabled upstream provider configured');
    return res.status(503).json({ error: 'No enabled upstream provider configured' });
  }

  const user = await getUserByUid(found.uid);
  const quota = await getQuotaStatus(user);
  if (quota.remaining <= 0) {
    await recordRequestOnly(user, found.id, provider.id, requestedModel, requestPath, 402, 0, 'Quota exhausted');
    return res.status(402).json({ error: 'Quota exhausted' });
  }

  const proxyPath = req.params[0] || '';
  const target = `${String(provider.base_url).replace(/\/$/, '')}/${proxyPath}`;
  const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
  if (activeModel && !body.model) body.model = activeModel;
  const wantsStream = Boolean(body?.stream) || String(req.headers.accept || '').includes('text/event-stream');

  try {
    const response = await fetch(target, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(provider.api_key ? { Authorization: `Bearer ${provider.api_key}` } : {}),
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(body),
    });
    const contentType = response.headers.get('content-type') || 'application/json';

    if (wantsStream && response.body) {
      res.status(response.status);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let aggregate = { model: requestedModel, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let rawError = null;
      const decoder = new TextDecoder();

      for await (const chunk of response.body) {
        const textChunk = decoder.decode(chunk, { stream: true });
        res.write(textChunk);
        const lines = textChunk.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const parsed = extractUsageFromPayload(json, aggregate.model);
            aggregate = {
              model: parsed.model || aggregate.model,
              promptTokens: Math.max(aggregate.promptTokens, parsed.promptTokens || 0),
              completionTokens: Math.max(aggregate.completionTokens, parsed.completionTokens || 0),
              totalTokens: Math.max(aggregate.totalTokens, parsed.totalTokens || 0),
            };
          } catch {
            rawError = rawError || payload.slice(0, 500);
          }
        }
      }
      res.end();

      if (aggregate.totalTokens > 0) {
        await chargeUser(user, aggregate.totalTokens, aggregate.model, provider.id, requestPath, aggregate.promptTokens, aggregate.completionTokens, found.id, response.status, response.ok ? 1 : 0, null);
      } else {
        await recordRequestOnly(user, found.id, provider.id, aggregate.model, requestPath, response.status, response.ok ? 1 : 0, rawError);
      }
      return;
    }

    const textResp = await response.text();
    let usageRecorded = false;
    if (response.ok && contentType.includes('application/json')) {
      try {
        const json = JSON.parse(textResp);
        const parsed = extractUsageFromPayload(json, requestedModel);
        if (parsed.totalTokens > 0) {
          await chargeUser(
            user,
            parsed.totalTokens,
            parsed.model,
            provider.id,
            requestPath,
            parsed.promptTokens,
            parsed.completionTokens,
            found.id,
            response.status,
            1,
            null
          );
          usageRecorded = true;
        }
      } catch {
      }
    }

    if (!usageRecorded) {
      await recordRequestOnly(
        user,
        found.id,
        provider.id,
        requestedModel,
        requestPath,
        response.status,
        response.ok ? 1 : 0,
        response.ok ? null : textResp.slice(0, 500)
      );
    }

    res.status(response.status).type(contentType).send(textResp);
  } catch (error) {
    await recordRequestOnly(user, found.id, provider.id, requestedModel, requestPath, 502, 0, String(error));
    res.status(502).json({ error: 'Proxy failed', detail: String(error) });
  }
});

app.get('/healthz', async (_req, res) => {
  try {
    await query('SELECT 1 AS ok');
    res.json({ ok: true, service: 'api-trans', time: nowIso() });
  } catch (error) {
    res.status(503).json({ ok: false, error: String(error) });
  }
});

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/api\/|\/v1\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error', detail: String(error?.message || error) });
});

await ensureSchema();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`api-trans listening on 0.0.0.0:${PORT}`);
  console.log(`admin user: ${ADMIN_EMAIL}`);
});

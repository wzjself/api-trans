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
const GENERATED_IMAGES_DIR = path.join(__dirname, '..', 'data', 'generated-images');
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

app.set('trust proxy', true);
app.use(express.json({ limit: '100mb' }));
fs.mkdirSync(GENERATED_IMAGES_DIR, { recursive: true });

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

function randomInviteCode() {
  return `INV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
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

function getClientFingerprint(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || req.ip || req.socket?.remoteAddress || 'unknown');
  const ip = String(rawIp).split(',')[0].trim().replace(/^::ffff:/, '');
  const device = String(req.headers['x-device-id'] || req.headers['x-client-id'] || req.headers['user-agent'] || 'unknown').slice(0, 255);
  return { ip, device, key: `${ip}__${device}` };
}

async function getLoginGuardState(req) {
  const { ip, device, key } = getClientFingerprint(req);
  const rows = await query('SELECT * FROM auth_guards WHERE guard_type = :guard_type AND guard_key = :guard_key LIMIT 1', {
    guard_type: 'login',
    guard_key: key,
  });
  return { row: rows[0] || null, ip, device, key };
}

async function recordLoginFailure(req) {
  const { row, ip, device, key } = await getLoginGuardState(req);
  const failedCount = Number(row?.failed_count || 0) + 1;
  const blockedUntil = failedCount >= 10 ? new Date(Date.now() + 10 * 60 * 1000) : null;
  await query(
    `INSERT INTO auth_guards (guard_type, guard_key, ip, device, failed_count, blocked_until, register_count, first_register_at, banned_until)
     VALUES ('login', :guard_key, :ip, :device, :failed_count, :blocked_until, 0, NULL, NULL)
     ON DUPLICATE KEY UPDATE ip = VALUES(ip), device = VALUES(device), failed_count = :failed_count, blocked_until = :blocked_until, updated_at = NOW()`,
    {
      guard_key: key,
      ip,
      device,
      failed_count: failedCount,
      blocked_until: blockedUntil,
    }
  );
  return { failedCount, blockedUntil };
}

async function clearLoginFailures(req) {
  const { key } = await getLoginGuardState(req);
  await query('UPDATE auth_guards SET failed_count = 0, blocked_until = NULL, updated_at = NOW() WHERE guard_type = :guard_type AND guard_key = :guard_key', {
    guard_type: 'login',
    guard_key: key,
  });
}

async function ensureLoginAllowed(req) {
  const { row } = await getLoginGuardState(req);
  if (!row?.blocked_until) return;
  const blockedUntil = new Date(row.blocked_until).getTime();
  if (blockedUntil > Date.now()) {
    const remainMinutes = Math.ceil((blockedUntil - Date.now()) / 60000);
    const error = new Error(`登录失败次数过多，请 ${remainMinutes} 分钟后再试`);
    error.statusCode = 429;
    throw error;
  }
}

async function getRegisterGuardState(req) {
  const { ip, device, key } = getClientFingerprint(req);
  const rows = await query('SELECT * FROM auth_guards WHERE guard_type = :guard_type AND guard_key = :guard_key LIMIT 1', {
    guard_type: 'register',
    guard_key: key,
  });
  return { row: rows[0] || null, ip, device, key };
}

async function ensureRegisterAllowed(req) {
  const { row } = await getRegisterGuardState(req);
  if (!row?.banned_until) return;
  if (new Date(row.banned_until).getTime() > Date.now()) {
    const error = new Error('该 IP/设备注册过于频繁，已被禁止注册');
    error.statusCode = 429;
    throw error;
  }
}

async function recordRegisterSuccess(req) {
  const { row, ip, device, key } = await getRegisterGuardState(req);
  const now = Date.now();
  const firstRegisterAt = row?.first_register_at ? new Date(row.first_register_at).getTime() : null;
  const withinWindow = firstRegisterAt && now - firstRegisterAt <= 60 * 60 * 1000;
  const registerCount = withinWindow ? Number(row?.register_count || 0) + 1 : 1;
  const nextFirstRegisterAt = withinWindow ? new Date(firstRegisterAt) : new Date(now);
  const bannedUntil = registerCount > 10 ? new Date(now + 3650 * 24 * 60 * 60 * 1000) : null;

  await query(
    `INSERT INTO auth_guards (guard_type, guard_key, ip, device, failed_count, blocked_until, register_count, first_register_at, banned_until)
     VALUES ('register', :guard_key, :ip, :device, 0, NULL, :register_count, :first_register_at, :banned_until)
     ON DUPLICATE KEY UPDATE ip = VALUES(ip), device = VALUES(device), register_count = :register_count, first_register_at = :first_register_at, banned_until = :banned_until, updated_at = NOW()`,
    {
      guard_key: key,
      ip,
      device,
      register_count: registerCount,
      first_register_at: nextFirstRegisterAt,
      banned_until: bannedUntil,
    }
  );
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
    inviteCode: rest.invite_code || '',
    inviterUid: rest.inviter_uid || null,
    quotaType: rest.quota_type || 'none',
    dailyQuota: Number(rest.daily_quota || 0),
    quotaExpiresAt: rest.quota_expires_at,
    createdAt: rest.created_at,
    updatedAt: rest.updated_at,
  };
}

async function getTodayUsedTokens(uid) {
  if (!uid) return 0;
  const rows = await query(
    `SELECT COALESCE(SUM(tokens),0) AS total FROM usage_logs
     WHERE uid = :uid
       AND DATE(CONVERT_TZ(created_at, '+00:00', '+08:00')) = DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR)`,
    { uid }
  );
  return Number(rows[0]?.total || 0);
}

async function sanitizeUserWithToday(user) {
  const sanitized = sanitizeUser(user);
  if (!sanitized) return null;
  return {
    ...sanitized,
    usedToday: await getTodayUsedTokens(sanitized.uid),
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

function getFirstConfiguredModel(provider) {
  const models = parseModelsJson(provider?.models_json);
  return models[0] || '';
}

function clampImageCount(value) {
  return Math.max(1, Math.min(4, Number(value || 1) || 1));
}

function getImageOutputCount(json, fallbackCount = 1) {
  const items = Array.isArray(json?.data) ? json.data : [];
  if (items.length > 0) return items.length;
  return clampImageCount(fallbackCount);
}

function getGeneratedImageUrl(filename) {
  const relativePath = `/generated-images/${filename}`;
  return APP_BASE_URL ? `${APP_BASE_URL.replace(/\/$/, '')}${relativePath}` : relativePath;
}

function getExtensionFromContentType(contentType = '') {
  const normalized = String(contentType).toLowerCase();
  if (normalized.includes('image/png')) return '.png';
  if (normalized.includes('image/jpeg') || normalized.includes('image/jpg')) return '.jpg';
  if (normalized.includes('image/webp')) return '.webp';
  if (normalized.includes('image/gif')) return '.gif';
  if (normalized.includes('image/svg+xml')) return '.svg';
  return '.png';
}

function getExtensionFromUrl(sourceUrl = '') {
  try {
    const pathname = new URL(sourceUrl).pathname || '';
    const ext = path.extname(pathname);
    return ext && ext.length <= 5 ? ext : '';
  } catch {
    return '';
  }
}

function resolveUpstreamImageUrl(sourceUrl, providerBaseUrl = '') {
  const raw = String(sourceUrl || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!providerBaseUrl) return raw;
  try {
    return new URL(raw, providerBaseUrl.endsWith('/') ? providerBaseUrl : `${providerBaseUrl}/`).toString();
  } catch {
    return raw;
  }
}

async function stageImageBuffer(buffer, extension = '.png') {
  const safeExtension = extension && extension.startsWith('.') ? extension : '.png';
  const filename = `${randomId('img_')}${safeExtension}`;
  const filePath = path.join(GENERATED_IMAGES_DIR, filename);
  await fs.promises.writeFile(filePath, buffer);
  return getGeneratedImageUrl(filename);
}

async function stageImageFromUrl(sourceUrl, providerBaseUrl = '') {
  const resolvedUrl = resolveUpstreamImageUrl(sourceUrl, providerBaseUrl);
  if (!resolvedUrl) return '';

  const response = await fetch(resolvedUrl);
  if (!response.ok) {
    throw new Error(`Fetch image failed: HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const arrayBuffer = await response.arrayBuffer();
  const extension = getExtensionFromUrl(resolvedUrl) || getExtensionFromContentType(contentType);
  return stageImageBuffer(Buffer.from(arrayBuffer), extension);
}

async function stageImageFromBase64(value, mimeType = 'image/png') {
  const buffer = Buffer.from(String(value || ''), 'base64');
  return stageImageBuffer(buffer, getExtensionFromContentType(mimeType));
}

async function normalizeImageResponseData(json, options = {}) {
  const { providerBaseUrl = '' } = options;
  const items = Array.isArray(json?.data) ? json.data : [];
  const normalized = await Promise.all(items.map(async (item) => {
    if (item?.url) {
      try {
        const stagedUrl = await stageImageFromUrl(item.url, providerBaseUrl);
        return {
          url: stagedUrl || resolveUpstreamImageUrl(item.url, providerBaseUrl),
          revised_prompt: item.revised_prompt || null,
          file_id: item.file_id || null,
        };
      } catch {
        return {
          url: resolveUpstreamImageUrl(item.url, providerBaseUrl),
          revised_prompt: item.revised_prompt || null,
          file_id: item.file_id || null,
        };
      }
    }
    if (item?.b64_json) {
      try {
        const stagedUrl = await stageImageFromBase64(item.b64_json, item.mime_type || 'image/png');
        return {
          url: stagedUrl,
          revised_prompt: item.revised_prompt || null,
          file_id: item.file_id || null,
        };
      } catch {
        return {
          url: `data:${item.mime_type || 'image/png'};base64,${item.b64_json}`,
          revised_prompt: item.revised_prompt || null,
          file_id: item.file_id || null,
        };
      }
    }
    return null;
  }));
  return normalized.filter(Boolean);
}

function sanitizeImageProvider(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    enabled: Boolean(row.enabled),
    models: parseModelsJson(row.models_json),
    pricePerImage: Number(row.price_per_image || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

async function getUserByInviteCode(inviteCode) {
  const rows = await query('SELECT * FROM users WHERE invite_code = :invite_code LIMIT 1', { invite_code: inviteCode });
  return rows[0] || null;
}

async function generateUniqueInviteCode() {
  for (let i = 0; i < 10; i++) {
    const inviteCode = randomInviteCode();
    const existing = await getUserByInviteCode(inviteCode);
    if (!existing) return inviteCode;
  }
  throw new Error('Failed to generate unique invite code');
}

async function ensureUserInviteCode(uid) {
  const user = await getUserByUid(uid);
  if (!user) return null;
  if (String(user.invite_code || '').trim()) return user.invite_code;
  const inviteCode = await generateUniqueInviteCode();
  await query('UPDATE users SET invite_code = :invite_code WHERE uid = :uid', { invite_code: inviteCode, uid });
  return inviteCode;
}

async function backfillInviteCodes() {
  const rows = await query(`SELECT uid FROM users WHERE invite_code IS NULL OR invite_code = ''`);
  for (const row of rows) {
    await ensureUserInviteCode(row.uid);
  }
}

async function getInviteStats(uid) {
  const [summary] = await query(
    `SELECT COUNT(*) AS validInviteCount, COALESCE(SUM(reward_tokens), 0) AS rewardedQuota
     FROM invite_rewards WHERE inviter_uid = :uid`,
    { uid }
  );
  return {
    validInviteCount: Number(summary?.validInviteCount || 0),
    rewardedQuota: Number(summary?.rewardedQuota || 0),
  };
}

async function rewardInviterForQualifiedRedeem(inviteeUid, redeemedCode, redeemedType) {
  const invitee = await getUserByUid(inviteeUid);
  if (!invitee?.inviter_uid) return null;

  const existing = await query('SELECT id FROM invite_rewards WHERE invitee_uid = :invitee_uid LIMIT 1', {
    invitee_uid: inviteeUid,
  });
  if (existing.length) return null;

  const rewardTokens = 20_000_000;
  await query('UPDATE users SET balance = balance + :reward WHERE uid = :uid', {
    reward: rewardTokens,
    uid: invitee.inviter_uid,
  });
  await query(
    `INSERT INTO invite_rewards (id, inviter_uid, invitee_uid, reward_tokens, source_code, redeemed_code, redeemed_type)
     VALUES (:id, :inviter_uid, :invitee_uid, :reward_tokens, :source_code, :redeemed_code, :redeemed_type)`,
    {
      id: randomId('invite_reward_'),
      inviter_uid: invitee.inviter_uid,
      invitee_uid: inviteeUid,
      reward_tokens: rewardTokens,
      source_code: invitee.invite_code_used || '',
      redeemed_code: redeemedCode,
      redeemed_type: redeemedType,
    }
  );
  return { inviterUid: invitee.inviter_uid, rewardTokens };
}

async function getEnabledProviders() {
  const rows = await query('SELECT * FROM upstream_providers WHERE enabled = 1 ORDER BY updated_at DESC, created_at DESC');
  return rows;
}

async function getEnabledImageProviders() {
  const rows = await query('SELECT * FROM image_providers WHERE enabled = 1 ORDER BY updated_at DESC, created_at DESC');
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

async function getImageProviderRouting(modelHint = '') {
  const settings = await getSetting('system', {});
  const defaultImageModel = String(settings.defaultImageModel || '').trim();
  const activeImageProviderId = String(settings.activeImageProviderId || '').trim();
  const requestedModel = String(modelHint || defaultImageModel || '').trim();
  const providers = await getEnabledImageProviders();
  if (!providers.length) {
    return { provider: null, model: requestedModel, providers, activeProviderId: activeImageProviderId };
  }

  const activeProvider = activeImageProviderId
    ? providers.find((row) => row.id === activeImageProviderId)
    : null;
  if (activeProvider) {
    const activeModels = parseModelsJson(activeProvider.models_json);
    const resolvedModel = requestedModel && (activeModels.length === 0 || activeModels.includes(requestedModel))
      ? requestedModel
      : (getFirstConfiguredModel(activeProvider) || requestedModel);
    return {
      provider: activeProvider,
      model: resolvedModel,
      providers,
      activeProviderId: activeImageProviderId,
    };
  }

  if (requestedModel) {
    const matched = providers.find((row) => {
      const models = parseModelsJson(row.models_json);
      return models.includes(requestedModel);
    });
    if (matched) {
      return {
        provider: matched,
        model: requestedModel,
        providers,
        activeProviderId: activeImageProviderId,
      };
    }
  }

  return {
    provider: providers[0],
    model: requestedModel || getFirstConfiguredModel(providers[0]),
    providers,
    activeProviderId: activeImageProviderId,
  };
}

async function fetchImageUpstreamResponse(target, headers, payload, responseFormat = 'json') {
  const response = await fetch(target, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const contentType = response.headers.get('content-type') || 'application/json';
  const text = await response.text();

  if (!response.ok) {
    const error = new Error(text || `HTTP ${response.status}`);
    error.statusCode = response.status;
    error.contentType = contentType;
    error.responseText = text;
    throw error;
  }

  if (responseFormat === 'text') {
    return { status: response.status, contentType, text };
  }

  return {
    status: response.status,
    contentType,
    json: contentType.includes('application/json') && text ? JSON.parse(text) : null,
    text,
  };
}

async function requestImagesWithFanout(target, headers, payload) {
  const desiredCount = clampImageCount(payload?.n || 1);
  if (desiredCount <= 1) {
    return fetchImageUpstreamResponse(target, headers, payload);
  }

  const merged = {
    created: Math.floor(Date.now() / 1000),
    data: [],
  };

  for (let index = 0; index < desiredCount; index++) {
    const result = await fetchImageUpstreamResponse(target, headers, { ...payload, n: 1 });
    if (!Array.isArray(result?.json?.data) || result.json.data.length === 0) {
      const error = new Error(`Upstream image request ${index + 1}/${desiredCount} returned no image data`);
      error.statusCode = 502;
      throw error;
    }
    if (result.json?.created) merged.created = result.json.created;
    merged.data.push(...result.json.data);
  }

  return {
    status: 200,
    contentType: 'application/json',
    json: merged,
    text: JSON.stringify(merged),
  };
}

async function fetchRemoteModels(baseUrl, apiKey = '') {
  const response = await fetch(`${String(baseUrl || '').replace(/\/$/, '')}/models`, {
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
  return {
    ok: response.ok,
    status: response.status,
    models,
    raw: text,
    contentType: response.headers.get('content-type') || 'application/json',
  };
}

async function proxyImageRequest(req, res, user, apiKeyId = null) {
  const requestPath = `/v1/${req.params[0] || ''}`;
  const routing = await getImageProviderRouting(req.body?.model || '');
  const provider = routing.provider;
  const requestedModel = String(req.body?.model || routing.model || getFirstConfiguredModel(provider) || 'gpt-image-1');

  if (!provider?.base_url) {
    await recordRequestOnly(user, apiKeyId, null, requestedModel, requestPath, 503, 0, 'No enabled image provider configured');
    return res.status(503).json({ error: 'No enabled image provider configured' });
  }

  const billable = req.method === 'POST' && requestPath.startsWith('/v1/images/');
  const requestedCount = clampImageCount(req.body?.n || 1);
  const pricePerImage = Math.max(0, Number(provider.price_per_image || 0));
  const estimatedCost = billable ? requestedCount * pricePerImage : 0;

  if (estimatedCost > 0) {
    const quota = await getQuotaStatus(user);
    if (quota.remaining < estimatedCost) {
      await recordRequestOnly(user, apiKeyId, provider.id, requestedModel, requestPath, 402, 0, 'Quota exhausted');
      return res.status(402).json({ error: 'Quota exhausted' });
    }
  }

  const target = `${String(provider.base_url).replace(/\/$/, '')}/${req.params[0] || ''}`;
  const contentType = String(req.headers['content-type'] || '').trim();
  const upstreamHeaders = {
    ...(contentType ? { 'Content-Type': contentType } : {}),
    ...(provider.api_key ? { Authorization: `Bearer ${provider.api_key}` } : {}),
  };

  let requestBody;
  let duplex;
  if (!['GET', 'HEAD'].includes(req.method)) {
    if (contentType.includes('application/json')) {
      const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
      if (!body.model) body.model = requestedModel;
      if (billable && !body.n) body.n = requestedCount;
      requestBody = JSON.stringify(body);
    } else {
      requestBody = req;
      duplex = 'half';
    }
  }

  try {
    let responseStatus;
    let responseType;
    let textResp;

    if (req.method === 'POST' && contentType.includes('application/json') && requestPath === '/v1/images/generations') {
      const parsedBody = JSON.parse(requestBody);
      const result = await requestImagesWithFanout(target, upstreamHeaders, parsedBody);
      responseStatus = result.status;
      responseType = result.contentType;
      textResp = result.text;
    } else {
      const response = await fetch(target, {
        method: req.method,
        headers: upstreamHeaders,
        body: requestBody,
        ...(duplex ? { duplex } : {}),
      });
      responseStatus = response.status;
      responseType = response.headers.get('content-type') || 'application/json';
      textResp = await response.text();
    }

    if (responseStatus >= 400) {
      await recordRequestOnly(user, apiKeyId, provider.id, requestedModel, requestPath, responseStatus, 0, textResp.slice(0, 500));
      return res.status(responseStatus).type(responseType).send(textResp);
    }

    if (billable) {
      if (responseType.includes('application/json')) {
        try {
          const json = JSON.parse(textResp);
          json.data = await normalizeImageResponseData(json, { providerBaseUrl: provider.base_url });
          const actualCount = getImageOutputCount(json, requestedCount);
          const actualCost = actualCount * pricePerImage;
          if (actualCost > 0) {
            await chargeUser(user, actualCost, requestedModel, provider.id, requestPath, 0, 0, apiKeyId, responseStatus, 1, null);
          } else {
            await recordRequestOnly(user, apiKeyId, provider.id, requestedModel, requestPath, responseStatus, 1, null);
          }
          return res.status(responseStatus).type(responseType).send(JSON.stringify(json));
        } catch {}
      }

      if (estimatedCost > 0) {
        await chargeUser(user, estimatedCost, requestedModel, provider.id, requestPath, 0, 0, apiKeyId, responseStatus, 1, null);
      } else {
        await recordRequestOnly(user, apiKeyId, provider.id, requestedModel, requestPath, responseStatus, 1, null);
      }
    } else {
      await recordRequestOnly(user, apiKeyId, provider.id, requestedModel, requestPath, responseStatus, 1, null);
    }

    return res.status(responseStatus).type(responseType).send(textResp);
  } catch (error) {
    const statusCode = Number(error?.statusCode || 502);
    const message = error?.responseText || error?.message || String(error);
    await recordRequestOnly(user, apiKeyId, provider.id, requestedModel, requestPath, statusCode, 0, message);
    return res.status(statusCode).type(error?.contentType || 'application/json').send(
      error?.responseText || JSON.stringify({ error: 'Image proxy failed', detail: message })
    );
  }
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
    invite_code VARCHAR(32) NULL UNIQUE,
    inviter_uid VARCHAR(64) NULL,
    invite_code_used VARCHAR(32) NULL,
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

  await query(`CREATE TABLE IF NOT EXISTS auth_guards (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    guard_type ENUM('login','register') NOT NULL,
    guard_key VARCHAR(512) NOT NULL,
    ip VARCHAR(128) NOT NULL,
    device VARCHAR(255) NULL,
    failed_count INT NOT NULL DEFAULT 0,
    blocked_until DATETIME NULL,
    register_count INT NOT NULL DEFAULT 0,
    first_register_at DATETIME NULL,
    banned_until DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_guard (guard_type, guard_key),
    INDEX idx_guard_ip (ip),
    INDEX idx_guard_blocked (blocked_until),
    INDEX idx_guard_banned (banned_until)
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

  await query(`CREATE TABLE IF NOT EXISTS invite_rewards (
    id VARCHAR(64) PRIMARY KEY,
    inviter_uid VARCHAR(64) NOT NULL,
    invitee_uid VARCHAR(64) NOT NULL UNIQUE,
    reward_tokens BIGINT NOT NULL DEFAULT 0,
    source_code VARCHAR(32) NULL,
    redeemed_code VARCHAR(64) NULL,
    redeemed_type ENUM('permanent','daily','monthly') NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_invite_rewards_inviter (inviter_uid, created_at),
    CONSTRAINT fk_invite_rewards_inviter FOREIGN KEY (inviter_uid) REFERENCES users(uid) ON DELETE CASCADE,
    CONSTRAINT fk_invite_rewards_invitee FOREIGN KEY (invitee_uid) REFERENCES users(uid) ON DELETE CASCADE
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

  await query(`CREATE TABLE IF NOT EXISTS image_providers (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(191) NOT NULL,
    base_url VARCHAR(500) NOT NULL,
    api_key TEXT NULL,
    models_json JSON NULL,
    price_per_image BIGINT NOT NULL DEFAULT 0,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await ensureColumn('users', 'used_quota', 'ALTER TABLE users ADD COLUMN used_quota BIGINT NOT NULL DEFAULT 0');
  await ensureColumn('users', 'request_count', 'ALTER TABLE users ADD COLUMN request_count BIGINT NOT NULL DEFAULT 0');
  await ensureColumn('users', 'invite_code', 'ALTER TABLE users ADD COLUMN invite_code VARCHAR(32) NULL UNIQUE');
  await ensureColumn('users', 'inviter_uid', 'ALTER TABLE users ADD COLUMN inviter_uid VARCHAR(64) NULL');
  await ensureColumn('users', 'invite_code_used', 'ALTER TABLE users ADD COLUMN invite_code_used VARCHAR(32) NULL');

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

  await backfillInviteCodes();

  const currentSettings = await getSetting('system', null);
  if (!currentSettings) {
    await setSetting('system', {
      guideLink: '',
      announcement: '',
      announcementPopupEnabled: false,
      announcementPopupVersion: '',
      appBaseUrl: APP_BASE_URL,
      defaultModel: '',
      defaultImageModel: '',
      activeImageProviderId: '',
    });
  } else {
    await setSetting('system', {
      guideLink: currentSettings.guideLink || '',
      announcement: currentSettings.announcement || '',
      announcementPopupEnabled: Boolean(currentSettings.announcementPopupEnabled),
      announcementPopupVersion: String(currentSettings.announcementPopupVersion || ''),
      appBaseUrl: APP_BASE_URL || currentSettings.appBaseUrl || '',
      defaultModel: currentSettings.defaultModel || currentSettings.activeModel || '',
      defaultImageModel: currentSettings.defaultImageModel || '',
      activeImageProviderId: currentSettings.activeImageProviderId || '',
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
    const usedToday = await getTodayUsedTokens(user.uid);
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
  const [routing, imageRouting] = await Promise.all([getProviderRouting(), getImageProviderRouting()]);
  res.json({
    ok: true,
    appBaseUrl: APP_BASE_URL || null,
    mysql: true,
    upstreamConfigured: Boolean(routing.provider?.base_url),
    imageUpstreamConfigured: Boolean(imageRouting.provider?.base_url),
    activeProvider: routing.provider ? { id: routing.provider.id, name: routing.provider.name } : null,
    activeImageProvider: imageRouting.provider ? { id: imageRouting.provider.id, name: imageRouting.provider.name } : null,
    activeModel: routing.model || '',
    activeImageModel: imageRouting.model || '',
    enabledProviders: routing.providers.length,
    enabledImageProviders: imageRouting.providers.length,
  });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    await ensureRegisterAllowed(req);
    const { email, password, inviteCode } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: '账号和密码必填' });
    const existing = await getUserByEmail(email);
    if (existing) return res.status(409).json({ error: '账号已存在' });
    const normalizedInviteCode = String(inviteCode || '').trim().toUpperCase();
    let inviter = null;
    if (normalizedInviteCode) {
      inviter = await getUserByInviteCode(normalizedInviteCode);
      if (!inviter) return res.status(400).json({ error: '邀请码无效' });
    }
    const uid = randomId('user_');
    const ownInviteCode = await generateUniqueInviteCode();
    await query(
      `INSERT INTO users (uid, email, password_hash, role, balance, quota_type, daily_quota, invite_code, inviter_uid, invite_code_used)
       VALUES (:uid, :email, :password_hash, 'user', :balance, 'none', 0, :invite_code, :inviter_uid, :invite_code_used)`,
      {
        uid,
        email,
        password_hash: hashPassword(password),
        balance: USER_INITIAL_BALANCE,
        invite_code: ownInviteCode,
        inviter_uid: inviter?.uid || null,
        invite_code_used: normalizedInviteCode || null,
      }
    );
    await recordRegisterSuccess(req);
    const user = await getUserByUid(uid);
    const token = signToken({ uid, exp: Date.now() + 30 * 24 * 3600 * 1000 });
    res.json({ token, user: sanitizeUser(user) });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.message || '注册失败' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    await ensureLoginAllowed(req);
    const { email, password } = req.body || {};
    const user = await getUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      const { blockedUntil } = await recordLoginFailure(req);
      if (blockedUntil) {
        return res.status(429).json({ error: '登录失败次数过多，请 10 分钟后再试' });
      }
      return res.status(401).json({ error: '账号或密码错误' });
    }
    await clearLoginFailures(req);
    const token = signToken({ uid: user.uid, exp: Date.now() + 30 * 24 * 3600 * 1000 });
    res.json({ token, user: sanitizeUser(user) });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.message || '登录失败' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const fresh = await getUserByUid(req.user.uid);
  res.json({ user: await sanitizeUserWithToday(fresh) });
});

app.get('/api/users/me/invite', authMiddleware, async (req, res) => {
  const fresh = await getUserByUid(req.user.uid);
  if (!fresh) return res.status(404).json({ error: 'User not found' });
  const inviteCode = await ensureUserInviteCode(req.user.uid);
  const stats = await getInviteStats(req.user.uid);
  res.json({
    inviteCode,
    validInviteCount: stats.validInviteCount,
    rewardedQuota: stats.rewardedQuota,
  });
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
    const result = await fetchRemoteModels(baseUrl, apiKey);
    res.json({ ok: result.ok, status: result.status, models: result.models, raw: result.raw.slice(0, 5000) });
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

app.get('/api/admin/image-providers', authMiddleware, adminMiddleware, async (_req, res) => {
  const rows = await query('SELECT * FROM image_providers ORDER BY created_at DESC');
  const system = await getSetting('system', {});
  res.json({
    providers: rows.map((row) => sanitizeImageProvider(row)),
    activeImageProviderId: String(system.activeImageProviderId || ''),
    defaultImageModel: String(system.defaultImageModel || ''),
  });
});

app.post('/api/admin/image-providers/fetch-models', authMiddleware, adminMiddleware, async (req, res) => {
  const baseUrl = String(req.body?.baseUrl || '').replace(/\/$/, '');
  const apiKey = String(req.body?.apiKey || '');
  if (!baseUrl) return res.status(400).json({ error: 'baseUrl is required' });

  try {
    const result = await fetchRemoteModels(baseUrl, apiKey);
    res.json({ ok: result.ok, status: result.status, models: result.models, raw: result.raw.slice(0, 5000) });
  } catch (error) {
    res.status(502).json({ error: 'Fetch image models failed', detail: String(error) });
  }
});

app.post('/api/admin/image-providers', authMiddleware, adminMiddleware, async (req, res) => {
  const body = req.body || {};
  const id = body.id || randomId('imgprov_');
  const models = Array.isArray(body.models) ? body.models : [];
  await query(
    `INSERT INTO image_providers (id, name, base_url, api_key, models_json, price_per_image, enabled)
     VALUES (:id, :name, :base_url, :api_key, :models_json, :price_per_image, :enabled)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       base_url = VALUES(base_url),
       api_key = VALUES(api_key),
       models_json = VALUES(models_json),
       price_per_image = VALUES(price_per_image),
       enabled = VALUES(enabled),
       updated_at = NOW()`,
    {
      id,
      name: body.name || 'Unnamed image provider',
      base_url: String(body.baseUrl || '').replace(/\/$/, ''),
      api_key: body.apiKey || '',
      models_json: JSON.stringify(models),
      price_per_image: Math.max(0, Number(body.pricePerImage || 0)),
      enabled: body.enabled === false ? 0 : 1,
    }
  );
  const rows = await query('SELECT * FROM image_providers WHERE id = :id LIMIT 1', { id });
  res.json(sanitizeImageProvider(rows[0]));
});

app.delete('/api/admin/image-providers/:id', authMiddleware, adminMiddleware, async (req, res) => {
  await query('DELETE FROM image_providers WHERE id = :id', { id: req.params.id });
  const current = await getSetting('system', {});
  if (String(current.activeImageProviderId || '') === req.params.id) {
    await setSetting('system', {
      ...current,
      activeImageProviderId: '',
    });
  }
  res.json({ ok: true });
});

app.put('/api/admin/image-providers/:id/enabled', authMiddleware, adminMiddleware, async (req, res) => {
  await query('UPDATE image_providers SET enabled = :enabled WHERE id = :id', { id: req.params.id, enabled: req.body?.enabled ? 1 : 0 });
  res.json({ ok: true });
});

app.put('/api/admin/image-providers/active', authMiddleware, adminMiddleware, async (req, res) => {
  const current = await getSetting('system', {});
  const nextValue = {
    ...current,
    activeImageProviderId: String(req.body?.activeImageProviderId || ''),
  };
  await setSetting('system', nextValue);
  res.json(nextValue);
});

app.put('/api/admin/default-image-model', authMiddleware, adminMiddleware, async (req, res) => {
  const current = await getSetting('system', {});
  const nextValue = {
    ...current,
    defaultImageModel: String(req.body?.defaultImageModel || ''),
  };
  await setSetting('system', nextValue);
  res.json(nextValue);
});

app.get('/api/users/me/images/config', authMiddleware, async (_req, res) => {
  const routing = await getImageProviderRouting();
  const provider = routing.provider;
  const configuredModels = parseModelsJson(provider?.models_json);
  const defaultModel = routing.model || configuredModels[0] || '';
  const models = configuredModels.length > 0
    ? configuredModels
    : (defaultModel ? [defaultModel] : []);

  res.json({
    enabled: Boolean(provider?.base_url),
    activeProvider: provider ? {
      id: provider.id,
      name: provider.name,
      pricePerImage: Number(provider.price_per_image || 0),
    } : null,
    defaultModel,
    models,
  });
});

app.post('/api/users/me/images/generate', authMiddleware, async (req, res) => {
  const requestPath = '/api/users/me/images/generate';
  const routing = await getImageProviderRouting(req.body?.model || '');
  const provider = routing.provider;
  const requestedModel = String(req.body?.model || routing.model || getFirstConfiguredModel(provider) || 'gpt-image-1');
  const requestedCount = clampImageCount(req.body?.n || 1);

  if (!provider?.base_url) {
    await recordRequestOnly(req.user, null, null, requestedModel, requestPath, 503, 0, 'No enabled image provider configured');
    return res.status(503).json({ error: 'No enabled image provider configured' });
  }

  const pricePerImage = Math.max(0, Number(provider.price_per_image || 0));
  const estimatedCost = requestedCount * pricePerImage;
  if (estimatedCost > 0) {
    const quota = await getQuotaStatus(req.user);
    if (quota.remaining < estimatedCost) {
      await recordRequestOnly(req.user, null, provider.id, requestedModel, requestPath, 402, 0, 'Quota exhausted');
      return res.status(402).json({ error: 'Quota exhausted' });
    }
  }

  const payload = {
    model: requestedModel,
    prompt: String(req.body?.prompt || ''),
    n: requestedCount,
    size: String(req.body?.size || '1024x1024'),
    ...(req.body?.quality ? { quality: req.body.quality } : {}),
    ...(req.body?.style ? { style: req.body.style } : {}),
    ...(req.body?.response_format ? { response_format: req.body.response_format } : {}),
    user: req.user.uid,
  };

  if (!payload.prompt.trim()) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    const result = await requestImagesWithFanout(
      `${String(provider.base_url).replace(/\/$/, '')}/images/generations`,
      {
        'Content-Type': 'application/json',
        ...(provider.api_key ? { Authorization: `Bearer ${provider.api_key}` } : {}),
      },
      payload
    );

    let parsed = result.json;
    if (!parsed) {
      await recordRequestOnly(req.user, null, provider.id, requestedModel, requestPath, 502, 0, 'Invalid JSON response from image provider');
      return res.status(502).json({ error: 'Invalid JSON response from image provider' });
    }

    const normalizedData = await normalizeImageResponseData(parsed, { providerBaseUrl: provider.base_url });
    const actualCount = normalizedData.length;
    const actualCost = actualCount * pricePerImage;
    if (actualCost > 0) {
      await chargeUser(req.user, actualCost, requestedModel, provider.id, requestPath, 0, 0, null, result.status, 1, null);
    } else {
      await recordRequestOnly(req.user, null, provider.id, requestedModel, requestPath, result.status, 1, null);
    }

    res.json({
      created: parsed.created || Math.floor(Date.now() / 1000),
      data: normalizedData,
      model: requestedModel,
      activeProvider: {
        id: provider.id,
        name: provider.name,
        pricePerImage,
      },
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 502);
    const message = error?.responseText || error?.message || String(error);
    await recordRequestOnly(req.user, null, provider.id, requestedModel, requestPath, statusCode, 0, message);
    res.status(statusCode).json({ error: error?.responseText ? message : 'Image proxy failed', detail: message });
  }
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
  const offset = Number(req.query.offset || 0);
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const safeOffset = Math.max(offset, 0);
  const [countRow] = await query(
    `SELECT COUNT(*) AS total FROM consume_logs WHERE uid = :uid`,
    { uid: req.user.uid }
  );
  const rows = await query(
    `SELECT id, model, request_path AS requestPath, prompt_tokens AS promptTokens, completion_tokens AS completionTokens, total_tokens AS totalTokens, consumed_quota AS consumedQuota, status_code AS statusCode, success, error_message AS errorMessage, created_at AS createdAt
     FROM consume_logs WHERE uid = :uid ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    { uid: req.user.uid }
  );
  res.json({
    items: rows,
    total: Number(countRow?.total || 0),
    limit: safeLimit,
    offset: safeOffset,
  });
});

app.get('/api/users/me/records', authMiddleware, async (req, res) => {
  const limit = Number(req.query.limit || 100);
  const rows = await query(
    `SELECT id, model, consumed_quota AS consumedQuota, status_code AS statusCode, success, error_message AS errorMessage, created_at AS createdAt
     FROM consume_logs WHERE uid = :uid ORDER BY created_at DESC LIMIT ${Math.min(limit, 500)}`,
    { uid: req.user.uid }
  );
  res.json(rows);
});

app.get('/api/users/me/usage-trend', authMiddleware, async (req, res) => {
  const view = String(req.query.view || 'daily');

  if (view === 'hourly') {
    const rows = await query(`
      WITH RECURSIVE hours AS (
        SELECT DATE_FORMAT(DATE_SUB(DATE_FORMAT(UTC_TIMESTAMP() + INTERVAL 8 HOUR, '%Y-%m-%d %H:00:00'), INTERVAL 23 HOUR), '%Y-%m-%d %H:00:00') AS h
        UNION ALL
        SELECT DATE_FORMAT(DATE_ADD(h, INTERVAL 1 HOUR), '%Y-%m-%d %H:00:00') FROM hours
        WHERE h < DATE_FORMAT(UTC_TIMESTAMP() + INTERVAL 8 HOUR, '%Y-%m-%d %H:00:00')
      )
      SELECT
        DATE_FORMAT(hours.h, '%H:00') AS name,
        COALESCE(SUM(ul.tokens), 0) AS tokens
      FROM hours
      LEFT JOIN usage_logs ul
        ON DATE_FORMAT(CONVERT_TZ(ul.created_at, '+00:00', '+08:00'), '%Y-%m-%d %H:00:00') = hours.h
       AND ul.uid = :uid
      GROUP BY hours.h
      ORDER BY hours.h ASC
    `, { uid: req.user.uid });

    return res.json(rows.map((row) => ({
      name: row.name,
      tokens: Number(row.tokens || 0),
    })));
  }

  const rows = await query(`
    WITH RECURSIVE days AS (
      SELECT DATE_SUB(DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR), INTERVAL 14 DAY) AS d
      UNION ALL
      SELECT DATE_ADD(d, INTERVAL 1 DAY) FROM days WHERE d < DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR)
    )
    SELECT
      DATE_FORMAT(days.d, '%m-%d') AS name,
      COALESCE(SUM(ul.tokens), 0) AS tokens
    FROM days
    LEFT JOIN usage_logs ul
      ON DATE(CONVERT_TZ(ul.created_at, '+00:00', '+08:00')) = days.d
     AND ul.uid = :uid
    GROUP BY days.d
    ORDER BY days.d ASC
  `, { uid: req.user.uid });

  res.json(rows.map((row) => ({
    name: row.name,
    tokens: Number(row.tokens || 0),
  })));
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
    ),
    usage_by_day AS (
      SELECT
        DATE(CONVERT_TZ(created_at, '+00:00', '+08:00')) AS d,
        COUNT(*) AS requests,
        COALESCE(SUM(tokens), 0) AS tokens
      FROM usage_logs
      GROUP BY DATE(CONVERT_TZ(created_at, '+00:00', '+08:00'))
    )
    SELECT
      DATE_FORMAT(days.d, '%m-%d') AS day,
      COALESCE(usage_by_day.requests, 0) AS requests,
      COALESCE(usage_by_day.tokens, 0) AS tokens
    FROM days
    LEFT JOIN usage_by_day ON usage_by_day.d = days.d
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
  if (item.type === 'monthly' || item.type === 'permanent') {
    await rewardInviterForQualifiedRedeem(req.user.uid, code, item.type);
  }
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
      COALESCE(SUM(CASE WHEN DATE(CONVERT_TZ(ul.created_at, '+00:00', '+08:00')) = DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR) THEN ul.tokens ELSE 0 END),0) AS usedToday,
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
    usedToday: Number(row.usedToday || 0),
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
  const [routing, imageRouting] = await Promise.all([getProviderRouting(), getImageProviderRouting()]);
  const items = new Map();
  const pushModel = (id, ownedBy) => {
    if (!id || items.has(id)) return;
    items.set(id, { id, object: 'model', owned_by: ownedBy || 'local' });
  };

  if (routing.provider) {
    const localModels = parseModelsJson(routing.provider.models_json);
    if (localModels.length > 0) {
      localModels.forEach((model) => pushModel(model, routing.provider.name));
    } else {
      try {
        const result = await fetchRemoteModels(routing.provider.base_url, routing.provider.api_key);
        result.models.forEach((model) => pushModel(model, routing.provider.name));
      } catch {}
    }
  }

  if (imageRouting.provider) {
    const imageModels = parseModelsJson(imageRouting.provider.models_json);
    if (imageModels.length > 0) {
      imageModels.forEach((model) => pushModel(model, imageRouting.provider.name));
    } else {
      pushModel(imageRouting.model || getFirstConfiguredModel(imageRouting.provider), imageRouting.provider.name);
    }
  }

  if (!items.size) {
    return res.json({ object: 'list', data: [{ id: 'unconfigured', object: 'model', owned_by: 'local' }] });
  }

  res.json({ object: 'list', data: [...items.values()] });
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

  const requestPath = `/v1/${req.params[0] || ''}`;
  if (requestPath.startsWith('/v1/images/')) {
    return proxyImageRequest(req, res, found, found.id);
  }

  const routing = await getProviderRouting(req.body?.model || '');
  const provider = routing.provider;
  const activeModel = routing.model;
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
  app.use('/generated-images', express.static(GENERATED_IMAGES_DIR, {
    maxAge: '1d',
    fallthrough: false,
  }));
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

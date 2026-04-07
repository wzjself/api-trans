import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const APP_BASE_URL = process.env.APP_BASE_URL || '';
const UPSTREAM_BASE_URL = (process.env.UPSTREAM_BASE_URL || '').replace(/\/$/, '');
const UPSTREAM_API_KEY = process.env.UPSTREAM_API_KEY || '';
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'change-me-token-secret';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@wzjself.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';
const ADMIN_INITIAL_BALANCE = Number(process.env.ADMIN_INITIAL_BALANCE || 1000000);

app.use(express.json({ limit: '2mb' }));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

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
  const { passwordHash, ...rest } = user;
  return rest;
}

function readDb() {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(DATA_FILE)) {
    const seed = {
      users: [],
      apiKeys: [],
      usageLogs: [],
      redemptionCodes: [],
      settings: { guideLink: '', appBaseUrl: APP_BASE_URL },
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  db.users ||= [];
  db.apiKeys ||= [];
  db.usageLogs ||= [];
  db.redemptionCodes ||= [];
  db.settings ||= { guideLink: '', appBaseUrl: APP_BASE_URL };
  return db;
}

function writeDb(db) {
  ensureDir(DATA_DIR);
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function bootstrapDb() {
  const db = readDb();
  if (!db.users.find((u) => u.email === ADMIN_EMAIL)) {
    db.users.push({
      uid: 'admin-123',
      email: ADMIN_EMAIL,
      passwordHash: hashPassword(ADMIN_PASSWORD),
      role: 'admin',
      balance: ADMIN_INITIAL_BALANCE,
      quotaType: 'none',
      dailyQuota: 0,
      quotaExpiresAt: null,
      createdAt: nowIso(),
    });
  }
  if (!db.redemptionCodes.find((c) => c.code === 'WELCOME666')) {
    db.redemptionCodes.push({
      code: 'WELCOME666',
      type: 'permanent',
      value: 50000,
      durationDays: 0,
      isUsed: false,
      createdAt: nowIso(),
      usedBy: null,
      usedAt: null,
    });
  }
  db.settings.guideLink ||= 'https://docs.wzjself.site';
  db.settings.appBaseUrl = APP_BASE_URL || db.settings.appBaseUrl || '';
  writeDb(db);
}

bootstrapDb();

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload?.uid) return res.status(401).json({ error: 'Invalid token' });
  const db = readDb();
  const user = db.users.find((u) => u.uid === payload.uid);
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
  req.db = db;
  next();
}

function adminMiddleware(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

function activeQuota(user, db) {
  if (!user) return { type: 'none', remaining: 0 };
  if (user.quotaType === 'daily' || user.quotaType === 'monthly') {
    if (user.quotaExpiresAt && new Date(user.quotaExpiresAt).getTime() < Date.now()) {
      user.quotaType = 'none';
      user.dailyQuota = 0;
      user.quotaExpiresAt = null;
      writeDb(db);
      return { type: 'none', remaining: user.balance || 0 };
    }
    const today = new Date().toISOString().slice(0, 10);
    const usedToday = db.usageLogs
      .filter((log) => log.uid === user.uid && String(log.timestamp || '').slice(0, 10) === today)
      .reduce((sum, log) => sum + Number(log.tokens || 0), 0);
    return { type: user.quotaType, remaining: Math.max(0, Number(user.dailyQuota || 0) - usedToday) };
  }
  return { type: 'permanent', remaining: Math.max(0, Number(user.balance || 0)) };
}

function chargeUser(user, db, tokens, model = 'unknown') {
  const amount = Math.max(0, Number(tokens || 0));
  const quota = activeQuota(user, db);
  if (quota.remaining < amount) {
    throw new Error(`额度不足，剩余 ${quota.remaining} Tokens`);
  }
  if (quota.type === 'daily' || quota.type === 'monthly') {
    // consumed via usage log only
  } else {
    user.balance = Math.max(0, Number(user.balance || 0) - amount);
  }
  db.usageLogs.unshift({
    id: randomId('log_'),
    uid: user.uid,
    tokens: amount,
    model,
    timestamp: nowIso(),
  });
}

function findUserByApiKey(key, db) {
  const record = db.apiKeys.find((k) => k.key === key && k.status === 'active');
  if (!record) return null;
  const user = db.users.find((u) => u.uid === record.uid);
  if (!user) return null;
  return { record, user };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, appBaseUrl: APP_BASE_URL || null, upstreamConfigured: Boolean(UPSTREAM_BASE_URL) });
});

app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: '邮箱和密码必填' });
  const db = readDb();
  if (db.users.find((u) => u.email === email)) return res.status(409).json({ error: '邮箱已被注册' });
  const user = {
    uid: randomId('user_'),
    email,
    passwordHash: hashPassword(password),
    role: email === ADMIN_EMAIL ? 'admin' : 'user',
    balance: 0,
    quotaType: 'none',
    dailyQuota: 0,
    quotaExpiresAt: null,
    createdAt: nowIso(),
  };
  db.users.push(user);
  writeDb(db);
  const token = signToken({ uid: user.uid, exp: Date.now() + 30 * 24 * 3600 * 1000 });
  res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const db = readDb();
  const user = db.users.find((u) => u.email === email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  const token = signToken({ uid: user.uid, exp: Date.now() + 30 * 24 * 3600 * 1000 });
  res.json({ token, user: sanitizeUser(user) });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.post('/api/auth/logout', authMiddleware, (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/settings', (_req, res) => {
  const db = readDb();
  res.json(db.settings || {});
});

app.put('/api/settings', authMiddleware, adminMiddleware, (req, res) => {
  const db = req.db;
  db.settings = { ...(db.settings || {}), ...(req.body || {}) };
  writeDb(db);
  res.json(db.settings);
});

app.get('/api/users/me/api-keys', authMiddleware, (req, res) => {
  const keys = req.db.apiKeys.filter((k) => k.uid === req.user.uid);
  res.json(keys);
});

app.post('/api/users/me/api-keys', authMiddleware, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: '名称必填' });
  const record = {
    id: randomId('key_'),
    uid: req.user.uid,
    name,
    key: `sk-live-${crypto.randomBytes(18).toString('hex')}`,
    status: 'active',
    createdAt: nowIso(),
  };
  req.db.apiKeys.unshift(record);
  writeDb(req.db);
  res.json(record);
});

app.delete('/api/api-keys/:id', authMiddleware, (req, res) => {
  const item = req.db.apiKeys.find((k) => k.id === req.params.id && k.uid === req.user.uid);
  if (!item) return res.status(404).json({ error: 'Key not found' });
  item.status = 'revoked';
  writeDb(req.db);
  res.json({ ok: true });
});

app.get('/api/users/me/logs', authMiddleware, (req, res) => {
  const limit = Number(req.query.limit || 0);
  let logs = req.db.usageLogs.filter((l) => l.uid === req.user.uid);
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  if (limit > 0) logs = logs.slice(0, limit);
  res.json(logs);
});

app.post('/api/users/me/logs/simulate', authMiddleware, (req, res) => {
  const { tokens = 1000, model = 'gpt-4-turbo' } = req.body || {};
  try {
    chargeUser(req.user, req.db, tokens, model);
    writeDb(req.db);
    res.json({ ok: true, user: sanitizeUser(req.user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/redeem', authMiddleware, (req, res) => {
  const { code } = req.body || {};
  const item = req.db.redemptionCodes.find((c) => c.code === code && !c.isUsed);
  if (!item) return res.status(400).json({ error: '无效或已使用的兑换码' });
  if (item.type === 'permanent') {
    req.user.balance = Number(req.user.balance || 0) + Number(item.value || 0);
  } else {
    req.user.quotaType = item.type;
    req.user.dailyQuota = Number(item.value || 0);
    req.user.quotaExpiresAt = new Date(Date.now() + Number(item.durationDays || 30) * 86400000).toISOString();
  }
  item.isUsed = true;
  item.usedBy = req.user.uid;
  item.usedAt = nowIso();
  writeDb(req.db);
  res.json({ ok: true, user: sanitizeUser(req.user) });
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  res.json(req.db.users.map(sanitizeUser));
});

app.patch('/api/admin/users/:uid/balance', authMiddleware, adminMiddleware, (req, res) => {
  const user = req.db.users.find((u) => u.uid === req.params.uid);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.balance = Number(req.body?.balance || 0);
  writeDb(req.db);
  res.json(sanitizeUser(user));
});

app.get('/api/admin/codes', authMiddleware, adminMiddleware, (req, res) => {
  const codes = [...req.db.redemptionCodes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(codes);
});

app.post('/api/admin/codes', authMiddleware, adminMiddleware, (req, res) => {
  const body = req.body || {};
  if (!body.code) body.code = `NX-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const item = {
    code: body.code,
    type: body.type || 'permanent',
    value: Number(body.value || 0),
    durationDays: Number(body.durationDays || 30),
    isUsed: false,
    createdAt: nowIso(),
    usedBy: null,
    usedAt: null,
  };
  req.db.redemptionCodes.unshift(item);
  writeDb(req.db);
  res.json(item);
});

app.delete('/api/admin/codes/:code', authMiddleware, adminMiddleware, (req, res) => {
  req.db.redemptionCodes = req.db.redemptionCodes.filter((c) => c.code !== req.params.code);
  writeDb(req.db);
  res.json({ ok: true });
});

app.get('/v1/models', async (_req, res) => {
  if (!UPSTREAM_BASE_URL) {
    return res.json({ object: 'list', data: [{ id: 'unconfigured', object: 'model', owned_by: 'local' }] });
  }
  try {
    const response = await fetch(`${UPSTREAM_BASE_URL}/models`, {
      headers: {
        'Content-Type': 'application/json',
        ...(UPSTREAM_API_KEY ? { Authorization: `Bearer ${UPSTREAM_API_KEY}` } : {}),
      },
    });
    const text = await response.text();
    res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(text);
  } catch (error) {
    res.status(502).json({ error: 'Upstream unavailable', detail: String(error) });
  }
});

app.all('/v1/*proxyPath', async (req, res) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing API key' });
  const apiKey = auth.slice(7);
  const db = readDb();
  const found = findUserByApiKey(apiKey, db);
  if (!found) return res.status(401).json({ error: 'Invalid API key' });
  const { user } = found;
  if (!UPSTREAM_BASE_URL) return res.status(503).json({ error: 'UPSTREAM_BASE_URL not configured' });
  const quota = activeQuota(user, db);
  if (quota.remaining <= 0) return res.status(402).json({ error: 'Quota exhausted' });

  const proxyPath = req.params.proxyPath || '';
  const target = `${UPSTREAM_BASE_URL}/${proxyPath}`;
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(UPSTREAM_API_KEY ? { Authorization: `Bearer ${UPSTREAM_API_KEY}` } : {}),
    };
    const response = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
    });
    const contentType = response.headers.get('content-type') || 'application/json';
    const text = await response.text();

    if (response.ok && contentType.includes('application/json')) {
      try {
        const json = JSON.parse(text);
        const tokens = Number(json?.usage?.total_tokens || 0);
        if (tokens > 0) {
          chargeUser(user, db, tokens, json?.model || req.body?.model || 'unknown');
          writeDb(db);
        }
      } catch {
        // ignore usage parse failures
      }
    }

    res.status(response.status).type(contentType).send(text);
  } catch (error) {
    res.status(502).json({ error: 'Proxy failed', detail: String(error) });
  }
});

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/v1/')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`api-trans listening on 0.0.0.0:${PORT}`);
  console.log(`admin user: ${ADMIN_EMAIL}`);
});

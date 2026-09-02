import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import db from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname);
const adminDir = join(rootDir, 'admin');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PORT = Number(process.env.ADMIN_PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PUBLIC = process.env.ADMIN_PUBLIC === '1';
const RATE_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const RATE_MAX = Number(process.env.RATE_LIMIT_MAX) || 8;
const BODY_LIMIT = 64 * 1024;
const startedAt = Date.now();

const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);
const ALLOWED_IPS = new Set(['127.0.0.1', '::1', ...parseList(process.env.ADMIN_ALLOWED_IPS)]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json; charset=utf-8',
};

const INTENTS = ['preorder', 'experience', 'partnership', 'media', 'other'];
const INTENT_LABEL = {
  preorder: '新品预订',
  experience: '试用体验',
  partnership: '渠道 / 商务合作',
  media: '媒体咨询',
  other: '其他',
};

const insertLeadStmt = db.prepare(`
  INSERT INTO leads (name, email, contact, intent, selected_features, message, lang, page_path, ip, user_agent)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const deleteLeadStmt = db.prepare('DELETE FROM leads WHERE id = ?');
const pingStmt = db.prepare('SELECT 1 AS ok');

const rateHits = new Map();
const rateSweep = setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of rateHits) {
    if (now >= rec.resetAt) rateHits.delete(key);
  }
}, RATE_WINDOW_MS);
rateSweep.unref();

function parseTrustProxy(value) {
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return false;
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeIp(ip) {
  if (!ip) return '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function clientIp(req) {
  const remote = normalizeIp(req.socket.remoteAddress || '');
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((ip) => normalizeIp(ip.trim()))
    .filter(Boolean);

  if (!TRUST_PROXY || !forwarded.length) return remote;
  if (TRUST_PROXY === true) return forwarded[0];
  const index = Math.max(0, forwarded.length - TRUST_PROXY);
  return forwarded[index] || remote;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      const error = new Error('请求体过大');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('请求体格式错误');
    error.status = 400;
    throw error;
  }
}

function checkRate(req, res) {
  const ip = clientIp(req) || 'unknown';
  const now = Date.now();
  let rec = rateHits.get(ip);

  if (!rec || now >= rec.resetAt) {
    rec = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateHits.set(ip, rec);
  }

  rec.count += 1;
  if (rec.count <= RATE_MAX) return true;

  res.setHeader('Retry-After', String(Math.ceil((rec.resetAt - now) / 1000)));
  sendError(res, 429, '提交过于频繁，请稍后再试');
  return false;
}

function clean(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function cleanList(value, maxItems, itemMax) {
  const arr = Array.isArray(value) ? value : [];
  return arr.map((item) => clean(item, itemMax)).filter(Boolean).slice(0, maxItems);
}

function validateLead(body) {
  if (clean(body.website, 100)) return { bot: true };

  const name = clean(body.name, 50);
  const email = clean(body.email, 120).toLowerCase();
  const contact = clean(body.contact, 80);
  const intent = clean(body.intent, 40);
  const selectedFeatures = cleanList(body.selectedFeatures, 12, 60).join(', ');
  const message = clean(body.message, 500);
  const lang = clean(body.lang, 8) === 'en' ? 'en' : 'zh';
  const pagePath = clean(body.pagePath, 160);

  if (!name) return { error: '请填写姓名' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: '邮箱格式不正确' };
  if (!INTENTS.includes(intent)) return { error: '请选择有效的关注方向' };

  return { value: { name, email, contact, intent, selectedFeatures, message, lang, pagePath } };
}

function rowToLead(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    contact: row.contact,
    intent: row.intent,
    intentLabel: INTENT_LABEL[row.intent] || row.intent,
    selectedFeatures: row.selected_features,
    message: row.message,
    lang: row.lang,
    pagePath: row.page_path,
    createdAt: row.created_at,
  };
}

function queryLeads({ page = 1, size = 20, all = false } = {}) {
  if (all) {
    return {
      items: db
        .prepare(
          'SELECT id, name, email, contact, intent, selected_features, message, lang, page_path, created_at FROM leads ORDER BY id DESC',
        )
        .all()
        .map(rowToLead),
    };
  }

  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeSize = Math.min(200, Math.max(1, Number.parseInt(size, 10) || 20));
  const total = db.prepare('SELECT COUNT(*) AS n FROM leads').get().n;
  const items = db
    .prepare(
      'SELECT id, name, email, contact, intent, selected_features, message, lang, page_path, created_at FROM leads ORDER BY id DESC LIMIT ? OFFSET ?',
    )
    .all(safeSize, (safePage - 1) * safeSize)
    .map(rowToLead);

  return { items, total, page: safePage, size: safeSize };
}

function deleteLeads(ids) {
  db.exec('BEGIN IMMEDIATE');
  try {
    let deleted = 0;
    for (const id of ids) deleted += deleteLeadStmt.run(id).changes;
    db.exec('COMMIT');
    return deleted;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getStats() {
  return db
    .prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN message != '' THEN 1 ELSE 0 END), 0) AS withMessage,
        COALESCE(SUM(CASE WHEN date(created_at) = date('now', 'localtime') THEN 1 ELSE 0 END), 0) AS today
      FROM leads
    `)
    .get();
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function leadsCsv(rows) {
  const headers = ['ID', '姓名', '邮箱', '联系方式', '关注方向', '关注亮点', '留言', '语言', '来源页', '提交时间'];
  const lines = [
    headers,
    ...rows.map((lead) => [
      lead.id,
      lead.name,
      lead.email,
      lead.contact,
      lead.intentLabel,
      lead.selectedFeatures,
      lead.message,
      lead.lang,
      lead.pagePath,
      lead.createdAt,
    ]),
  ];
  return `\uFEFF${lines.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function health(res) {
  try {
    pingStmt.get();
    sendJson(res, 200, { status: 'ok', uptime: Math.floor((Date.now() - startedAt) / 1000) });
  } catch {
    sendJson(res, 503, { status: 'error', error: 'database unavailable' });
  }
}

function isAllowedPublicPath(pathname) {
  if (pathname === '/' || pathname === '/index.html' || pathname === '/join.html' || pathname === '/favicon.svg') return true;
  const first = pathname.split('/').filter(Boolean)[0];
  return ['assets', 'css', 'js', 'en'].includes(first);
}

function serveStatic(res, baseDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendText(res, 400, 'Bad request');
    return;
  }

  if (decoded.includes('\0')) {
    sendText(res, 400, 'Bad request');
    return;
  }

  let filePath = resolve(baseDir, `.${decoded}`);
  if (decoded === '/favicon.svg') filePath = join(rootDir, 'assets', 'favicon.svg');
  if (!filePath.startsWith(baseDir + sep) && filePath !== baseDir && !filePath.startsWith(join(rootDir, 'assets') + sep)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    if (statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      sendText(res, 404, 'Not found');
      return;
    }
  } catch {
    sendText(res, 404, 'Not found');
    return;
  }

  res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

function assertAdminAllowed(req, res) {
  if (ADMIN_PUBLIC) return true;
  if (ALLOWED_IPS.has(clientIp(req))) return true;
  sendText(res, 403, '403 Forbidden');
  return false;
}

async function handlePublic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/healthz') return health(res);

    if (req.method === 'POST' && url.pathname === '/api/leads') {
      if (!checkRate(req, res)) return;
      const body = await readJson(req);
      const { bot, error, value } = validateLead(body);
      if (bot) return sendJson(res, 201, { id: null });
      if (error) return sendError(res, 400, error);

      const info = insertLeadStmt.run(
        value.name,
        value.email,
        value.contact,
        value.intent,
        value.selectedFeatures,
        value.message,
        value.lang,
        value.pagePath,
        clientIp(req),
        clean(req.headers['user-agent'], 400),
      );

      return sendJson(res, 201, { id: info.lastInsertRowid });
    }

    if (url.pathname.startsWith('/api/')) return sendError(res, 404, '接口不存在');
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
    if (!isAllowedPublicPath(url.pathname)) return sendText(res, 404, 'Not found');

    return serveStatic(res, rootDir, url.pathname === '/' ? '/index.html' : url.pathname);
  } catch (error) {
    sendError(res, error.status || 500, error.status ? error.message : '服务器内部错误');
  }
}

async function handleAdmin(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/healthz') return health(res);
    if (!assertAdminAllowed(req, res)) return;

    if (req.method === 'GET' && url.pathname === '/api/stats') return sendJson(res, 200, getStats());

    if (req.method === 'GET' && url.pathname === '/api/leads') {
      const all = url.searchParams.get('all') === '1';
      return sendJson(res, 200, queryLeads({
        all,
        page: url.searchParams.get('page'),
        size: url.searchParams.get('size'),
      }));
    }

    if (req.method === 'GET' && url.pathname === '/api/leads/export.csv') {
      const rows = queryLeads({ all: true }).items;
      const body = leadsCsv(rows);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="linki-leads-${stamp()}.csv"`,
        'Content-Length': Buffer.byteLength(body),
      });
      return res.end(body);
    }

    if (req.method === 'DELETE' && url.pathname === '/api/leads') {
      const body = await readJson(req);
      const ids = Array.isArray(body.ids)
        ? body.ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)
        : [];
      if (!ids.length) return sendError(res, 400, '未提供要删除的 ID');
      return sendJson(res, 200, { deleted: deleteLeads(ids) });
    }

    if (url.pathname.startsWith('/api/')) return sendError(res, 404, '接口不存在');
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
    if (url.pathname === '/' || url.pathname === '/index.html') return serveStatic(res, adminDir, '/index.html');
    if (url.pathname === '/assets/favicon.svg') return serveStatic(res, rootDir, '/assets/favicon.svg');

    return sendText(res, 404, 'Not found');
  } catch (error) {
    sendError(res, error.status || 500, error.status ? error.message : '服务器内部错误');
  }
}

const publicServer = http.createServer(handlePublic);
const adminServer = http.createServer(handleAdmin);

publicServer.listen(PORT, HOST, () => {
  console.log(`公开站点：http://localhost:${PORT}`);
});

adminServer.listen(ADMIN_PORT, HOST, () => {
  console.log(`内部看板：http://localhost:${ADMIN_PORT}`);
  if (!ADMIN_PUBLIC) console.log(`后台 IP 白名单：${[...ALLOWED_IPS].join(', ')}`);
});

function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭服务...`);
  clearInterval(rateSweep);
  const closeServer = (server) => new Promise((resolveClose) => server.close(resolveClose));
  Promise.all([closeServer(publicServer), closeServer(adminServer)]).finally(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import db from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname);
const adminDir = join(rootDir, 'admin');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PORT = Number(process.env.ADMIN_PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const RATE_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const RATE_MAX = Number(process.env.RATE_LIMIT_MAX) || 8;
const BODY_LIMIT = 64 * 1024;
const startedAt = Date.now();

const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);

// ---- 后台账号登录（独立登录页 + 内存 Session）----
const ADMIN_USER = String(process.env.ADMIN_USER || '').trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
if (!ADMIN_USER || !ADMIN_PASSWORD) {
  console.error('缺少 ADMIN_USER / ADMIN_PASSWORD，后台拒绝启动。请在 .env 中配置。');
  process.exit(1);
}
const SESSION_COOKIE = 'linki_admin_session';
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const sessions = new Map();
const loginAttempts = new Map();

// ---- Meta Conversions API（服务端 Lead）----
// 不配 META_CAPI_TOKEN 时整体不发送，行为与之前一致
const META_PIXEL_ID = process.env.META_PIXEL_ID || '28499637663005947';
const META_CAPI_TOKEN = process.env.META_CAPI_TOKEN || '';
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || '';
const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';

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
const GENDERS = ['female', 'male', 'nonbinary', 'prefer_not_say'];
const GENDER_LABEL = {
  female: '女性',
  male: '男性',
  nonbinary: '非二元 / 其他',
  prefer_not_say: '不愿透露',
};
const AGE_RANGES = ['under_16', '16_25', '25_35', '35_45', 'over_45'];
const AGE_RANGE_LABEL = {
  under_16: '16 岁以下',
  '16_25': '16–25 岁',
  '25_35': '25–35 岁',
  '35_45': '35–45 岁',
  over_45: '45 岁以上',
};

const insertLeadStmt = db.prepare(`
  INSERT INTO leads (
    name, email, intent, gender, age_range, selected_features, message, lang, page_path,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    agent_id, prompt_id, creative_id, landing_path, referrer, ip, user_agent
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateLeadGeoStmt = db.prepare(`
  UPDATE leads
  SET geo_country = ?, geo_region = ?, geo_city = ?, geo_checked = 1
  WHERE id = ?
`);
const deleteLeadStmt = db.prepare('DELETE FROM leads WHERE id = ?');
const pingStmt = db.prepare('SELECT 1 AS ok');
const geoCache = new Map();

const rateHits = new Map();
const rateSweep = setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of rateHits) {
    if (now >= rec.resetAt) rateHits.delete(key);
  }
}, RATE_WINDOW_MS);
rateSweep.unref();

const sessionSweep = setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of loginAttempts) {
    if (now >= rec.resetAt) loginAttempts.delete(ip);
  }
}, LOGIN_WINDOW_MS);
sessionSweep.unref();

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

function getCookieValue(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}

function isHttpsRequest(req) {
  if (process.env.COOKIE_SECURE === '1') return true;
  const proto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return proto === 'https';
}

function cookieFlags(req, { clear = false } = {}) {
  const parts = ['HttpOnly', 'SameSite=Strict', 'Path=/'];
  if (isHttpsRequest(req)) parts.push('Secure');
  if (clear) parts.push('Max-Age=0');
  return parts.join('; ');
}

function createSession() {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

function hasValidSession(req) {
  const token = getCookieValue(req, SESSION_COOKIE);
  if (!token) return false;
  return sessions.has(token);
}

function safeEqualString(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function checkLoginRate(ip) {
  const now = Date.now();
  let rec = loginAttempts.get(ip);
  if (!rec || now >= rec.resetAt) {
    rec = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(ip, rec);
  }
  return rec;
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
  const intent = clean(body.intent, 40);
  const gender = clean(body.gender, 24);
  const ageRange = clean(body.ageRange, 24);
  const selectedFeatures = cleanList(body.selectedFeatures, 12, 60).join(', ');
  const message = clean(body.message, 500);
  const lang = clean(body.lang, 8) === 'en' ? 'en' : 'zh';
  const pagePath = clean(body.pagePath, 160);
  const rawAttribution = body.attribution && typeof body.attribution === 'object' ? body.attribution : {};
  const attribution = {
    utmSource: clean(rawAttribution.utmSource, 120),
    utmMedium: clean(rawAttribution.utmMedium, 120),
    utmCampaign: clean(rawAttribution.utmCampaign, 160),
    utmContent: clean(rawAttribution.utmContent, 160),
    utmTerm: clean(rawAttribution.utmTerm, 160),
    agentId: clean(rawAttribution.agentId, 120),
    promptId: clean(rawAttribution.promptId, 160),
    creativeId: clean(rawAttribution.creativeId, 160),
    landingPath: clean(rawAttribution.landingPath, 300),
    referrer: clean(rawAttribution.referrer, 300),
  };

  if (!name) return { error: '请填写姓名' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: '邮箱格式不正确' };
  if (!INTENTS.includes(intent)) return { error: '请选择有效的关注方向' };
  if (!GENDERS.includes(gender)) return { error: '请选择性别' };
  if (!AGE_RANGES.includes(ageRange)) return { error: '请选择年龄段' };

  return { value: { name, email, intent, gender, ageRange, selectedFeatures, message, lang, pagePath, attribution } };
}

// 把邮箱规范化后做 SHA-256（CAPI 要求 PII 哈希后传）
function sha256(value) {
  return createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

// 服务端发送 Lead 到 Meta Conversions API（与前端 Pixel 用同一 eventId 去重）
// 未配置 token → 直接跳过；任何异常只记日志，绝不影响用户提交
async function sendCapiLead({ value, ip, userAgent, sourceUrl, body }) {
  if (!META_CAPI_TOKEN) return;
  try {
    const userData = {
      em: [sha256(value.email)],
      client_ip_address: ip || undefined,
      client_user_agent: userAgent || undefined,
    };
    if (body?.fbp) userData.fbp = String(body.fbp);
    if (body?.fbc) userData.fbc = String(body.fbc);

    const selectedFeatures = Array.isArray(body?.selectedFeatures) ? body.selectedFeatures : [];
    const payload = {
      data: [{
        event_name: 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        event_id: body?.eventId ? String(body.eventId) : undefined,
        event_source_url: sourceUrl || undefined,
        user_data: userData,
        custom_data: {
          content_category: selectedFeatures.join(','),
          num_items: selectedFeatures.length,
          gender: value.gender,
          age_range: value.ageRange,
          agent_id: value.attribution.agentId || undefined,
          prompt_id: value.attribution.promptId || undefined,
          creative_id: value.attribution.creativeId || undefined,
          utm_campaign: value.attribution.utmCampaign || undefined,
        },
      }],
    };
    if (META_TEST_EVENT_CODE) payload.test_event_code = META_TEST_EVENT_CODE;

    const url = `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(META_CAPI_TOKEN)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error('[capi] Lead 发送失败:', res.status, (await res.text()).slice(0, 300));
    }
  } catch (e) {
    console.error('[capi] Lead 异常:', e.message);
  }
}

function isPrivateIp(ip) {
  if (!ip || ip === 'unknown') return true;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  return false;
}

function formatGeoLabel({ country = '', region = '', city = '' } = {}) {
  return [city, region, country].filter(Boolean).join(', ');
}

async function lookupGeo(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized || isPrivateIp(normalized)) {
    return { country: '', region: '', city: '', label: '', checked: true };
  }
  if (geoCache.has(normalized)) return geoCache.get(normalized);

  const fromParts = (country, region, city) => {
    const geo = {
      country: String(country || '').trim(),
      region: String(region || '').trim(),
      city: String(city || '').trim(),
      checked: true,
    };
    geo.label = formatGeoLabel(geo);
    return geo;
  };

  try {
    const primary = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(normalized)}?lang=zh-CN&fields=status,country,regionName,city`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (primary.ok) {
      const data = await primary.json();
      if (data.status === 'success') {
        const geo = fromParts(data.country, data.regionName, data.city);
        geoCache.set(normalized, geo);
        return geo;
      }
      const empty = fromParts('', '', '');
      geoCache.set(normalized, empty);
      return empty;
    }
  } catch {
    // fall through to HTTPS backup
  }

  try {
    const backup = await fetch(`https://ipwho.is/${encodeURIComponent(normalized)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!backup.ok) return { country: '', region: '', city: '', label: '', checked: false };
    const data = await backup.json();
    if (!data.success) {
      const empty = fromParts('', '', '');
      geoCache.set(normalized, empty);
      return empty;
    }
    const geo = fromParts(data.country, data.region, data.city);
    geoCache.set(normalized, geo);
    return geo;
  } catch {
    return { country: '', region: '', city: '', label: '', checked: false };
  }
}

async function resolveLeadGeo(row) {
  if (row.geo_checked) {
    return {
      country: row.geo_country || '',
      region: row.geo_region || '',
      city: row.geo_city || '',
      label: formatGeoLabel({
        country: row.geo_country,
        region: row.geo_region,
        city: row.geo_city,
      }),
    };
  }
  const geo = await lookupGeo(row.ip);
  if (geo.checked) updateLeadGeoStmt.run(geo.country, geo.region, geo.city, row.id);
  return geo;
}

function fillLeadGeoAsync(id, ip) {
  lookupGeo(ip)
    .then((geo) => {
      if (geo.checked) updateLeadGeoStmt.run(geo.country, geo.region, geo.city, id);
    })
    .catch(() => {});
}

function rowToLead(row, geo = null) {
  const resolved = geo || {
    country: row.geo_country || '',
    region: row.geo_region || '',
    city: row.geo_city || '',
    label: formatGeoLabel({
      country: row.geo_country,
      region: row.geo_region,
      city: row.geo_city,
    }),
  };
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    intent: row.intent,
    intentLabel: INTENT_LABEL[row.intent] || row.intent,
    gender: row.gender,
    genderLabel: GENDER_LABEL[row.gender] || '',
    ageRange: row.age_range,
    ageRangeLabel: AGE_RANGE_LABEL[row.age_range] || '',
    selectedFeatures: row.selected_features,
    message: row.message,
    lang: row.lang,
    pagePath: row.page_path,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    utmContent: row.utm_content,
    utmTerm: row.utm_term,
    agentId: row.agent_id,
    promptId: row.prompt_id,
    creativeId: row.creative_id,
    landingPath: row.landing_path,
    referrer: row.referrer,
    geoCountry: resolved.country || '',
    geoRegion: resolved.region || '',
    geoCity: resolved.city || '',
    geoLabel: resolved.label || '',
    createdAt: row.created_at,
  };
}

async function queryLeads({ page = 1, size = 20, all = false } = {}) {
  const mapRows = async (rows) =>
    Promise.all(rows.map(async (row) => rowToLead(row, await resolveLeadGeo(row))));

  if (all) {
    const rows = db.prepare('SELECT * FROM leads ORDER BY id DESC').all();
    return { items: await mapRows(rows) };
  }

  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeSize = Math.min(200, Math.max(1, Number.parseInt(size, 10) || 20));
  const total = db.prepare('SELECT COUNT(*) AS n FROM leads').get().n;
  const rows = db
    .prepare('SELECT * FROM leads ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(safeSize, (safePage - 1) * safeSize);

  return { items: await mapRows(rows), total, page: safePage, size: safeSize };
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

const FEATURE_LABELS = {
  'Season-synced screen': '四季与天气同步',
  'Camera-free presence sensing': '无摄像头存在感知',
  'Responsive touch interaction': '触碰互动反馈',
  'Naked-eye 3D display': '裸眼 3D 显示',
  'Non-visual environmental sensing': '非视觉环境感知',
  'Magnetic character interface': '磁吸角色切换',
};

const FEATURE_SHORT_LABELS = {
  'Season-synced screen': '季节/时间同步',
  'Camera-free presence sensing': '无摄像头感知',
  'Responsive touch interaction': '触碰互动',
  'Naked-eye 3D display': '裸眼 3D',
  'Non-visual environmental sensing': '非视觉环境感知',
  'Magnetic character interface': '磁吸角色',
};

const FEATURE_KEYS = Object.keys(FEATURE_LABELS);
const FEATURE_TOTAL = FEATURE_KEYS.length;

function parseFeatures(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function shareOf(count, total) {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}

function queryLeadsByRange(days = 30) {
  const safeDays = [7, 30, 90].includes(Number(days)) ? Number(days) : days === 'all' ? 'all' : 30;
  const rows = safeDays === 'all'
    ? db.prepare('SELECT * FROM leads ORDER BY id DESC').all()
    : db.prepare("SELECT * FROM leads WHERE created_at >= datetime('now', ?) ORDER BY id DESC").all(`-${safeDays} days`);
  return { safeDays, rows };
}

function pickCountLabel(count) {
  if (count === 0) return '未选';
  if (count >= FEATURE_TOTAL) return `全选 ${FEATURE_TOTAL} 项`;
  return `选 ${count} 项`;
}

function buildFeatureCohort(parsedRows) {
  const n = parsedRows.length;
  const featureCounts = new Map(FEATURE_KEYS.map((key) => [key, 0]));
  const pickCountMap = new Map();
  let pickSum = 0;

  parsedRows.forEach(({ features }) => {
    pickCountMap.set(features.length, (pickCountMap.get(features.length) || 0) + 1);
    pickSum += features.length;
    features.forEach((feature) => {
      if (featureCounts.has(feature)) featureCounts.set(feature, featureCounts.get(feature) + 1);
      else featureCounts.set(feature, (featureCounts.get(feature) || 0) + 1);
    });
  });

  const official = FEATURE_KEYS.map((key) => ({
    key,
    label: FEATURE_LABELS[key] || key,
    shortLabel: FEATURE_SHORT_LABELS[key] || FEATURE_LABELS[key] || key,
    count: featureCounts.get(key) || 0,
    share: shareOf(featureCounts.get(key) || 0, n),
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const extras = [...featureCounts.entries()]
    .filter(([key, count]) => !FEATURE_KEYS.includes(key) && count > 0)
    .map(([key, count]) => ({
      key,
      label: FEATURE_LABELS[key] || key,
      shortLabel: FEATURE_SHORT_LABELS[key] || FEATURE_LABELS[key] || key,
      count,
      share: shareOf(count, n),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const features = [...official, ...extras];

  const pickCounts = [...pickCountMap.entries()]
    .map(([count, people]) => ({
      count,
      people,
      share: shareOf(people, n),
      label: pickCountLabel(count),
    }))
    .sort((a, b) => {
      if (a.count >= FEATURE_TOTAL && b.count < FEATURE_TOTAL) return -1;
      if (b.count >= FEATURE_TOTAL && a.count < FEATURE_TOTAL) return 1;
      if (a.count === 0) return 1;
      if (b.count === 0) return -1;
      return b.people - a.people || a.count - b.count;
    });

  return {
    n,
    avgPicks: n ? Math.round((pickSum / n) * 10) / 10 : 0,
    features,
    pickCounts,
  };
}

function buildCohortInsight(mode, allCohort, excludeCohort, selectAllCount) {
  if (!allCohort.n) return '当前时间范围内还没有线索。';
  if (mode === 'all') {
    const top = allCohort.features.slice(0, 2).map((item) => item.shortLabel).join(' / ');
    const full = allCohort.pickCounts.find((item) => item.count >= FEATURE_TOTAL);
    return `全部 ${allCohort.n} 人：全选 ${selectAllCount} 人（${shareOf(selectAllCount, allCohort.n)}%），平均勾选 ${allCohort.avgPicks}；前二偏好 ${top || '暂无'}。`;
  }
  const top = excludeCohort.features.slice(0, 2).map((item) => item.shortLabel).join(' / ');
  const bottom = excludeCohort.features.slice(2).filter((item) => item.count > 0);
  const dropNote = bottom.length
    ? `后 ${bottom.length} 项明显掉档`
    : '其余亮点暂无足够样本';
  return `去掉 ${selectAllCount} 人全选后：前二仍是 ${top || '暂无'}；${dropNote}。`;
}

function getUserAnalysis(days = 30) {
  const { safeDays, rows } = queryLeadsByRange(days);
  const parsedRows = rows.map((row) => {
    const features = parseFeatures(row.selected_features);
    return {
      row,
      features,
      isSelectAll: FEATURE_KEYS.every((key) => features.includes(key)) || features.length >= FEATURE_TOTAL,
    };
  });

  const allRows = parsedRows;
  const excludeRows = parsedRows.filter((item) => !item.isSelectAll);
  const selectAllCount = parsedRows.filter((item) => item.isSelectAll).length;

  const allCohort = buildFeatureCohort(allRows);
  const excludeCohort = buildFeatureCohort(excludeRows);

  const singleByFeature = new Map();
  const singleLeads = [];
  let withFeatures = 0;
  let noPick = 0;

  parsedRows.forEach(({ row, features }) => {
    if (!features.length) {
      noPick += 1;
      return;
    }
    withFeatures += 1;
    if (features.length === 1) {
      const feature = features[0];
      singleByFeature.set(feature, (singleByFeature.get(feature) || 0) + 1);
      singleLeads.push({
        id: row.id,
        name: row.name,
        email: row.email,
        lang: row.lang,
        genderLabel: GENDER_LABEL[row.gender] || '',
        ageRangeLabel: AGE_RANGE_LABEL[row.age_range] || '',
        geoLabel: formatGeoLabel({
          country: row.geo_country,
          region: row.geo_region,
          city: row.geo_city,
        }),
        feature,
        featureLabel: FEATURE_LABELS[feature] || feature,
        featureShortLabel: FEATURE_SHORT_LABELS[feature] || FEATURE_LABELS[feature] || feature,
        createdAt: row.created_at,
      });
    }
  });

  const singlePick = singleLeads.length;
  const singleFeatures = [...singleByFeature.entries()]
    .map(([key, count]) => ({
      key,
      label: FEATURE_LABELS[key] || key,
      shortLabel: FEATURE_SHORT_LABELS[key] || FEATURE_LABELS[key] || key,
      count,
      share: shareOf(count, singlePick),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const cohorts = {
    all: {
      ...allCohort,
      title: `全部用户偏好 (n=${allCohort.n})`,
      insight: buildCohortInsight('all', allCohort, excludeCohort, selectAllCount),
    },
    excludeAll: {
      ...excludeCohort,
      title: `未全选用户偏好 (n=${excludeCohort.n})`,
      insight: buildCohortInsight('excludeAll', allCohort, excludeCohort, selectAllCount),
    },
  };

  return {
    range: safeDays,
    total: allCohort.n,
    featureTotal: FEATURE_TOTAL,
    withFeatures,
    noPick,
    selectAllCount,
    selectAllShare: shareOf(selectAllCount, allCohort.n),
    singlePick,
    singleShare: shareOf(singlePick, allCohort.n),
    topSingleFeature: singleFeatures[0] || null,
    singleFeatures,
    singleLeads,
    cohorts,
  };
}

function getAttribution(days = 30) {
  const { safeDays, rows } = queryLeadsByRange(days);
  const total = rows.length;
  const countBy = (getter) => {
    const counts = new Map();
    rows.forEach((row) => {
      const value = getter(row);
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    });
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count, share: shareOf(count, total) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };
  const featureCounts = new Map();
  const featureByRows = new Map();
  rows.forEach((row) => {
    parseFeatures(row.selected_features).forEach((feature) => {
      featureCounts.set(feature, (featureCounts.get(feature) || 0) + 1);
      if (!featureByRows.has(row.id)) featureByRows.set(row.id, []);
      featureByRows.get(row.id).push(feature);
    });
  });
  const features = [...featureCounts.entries()]
    .map(([key, count]) => ({ key, label: FEATURE_LABELS[key] || key, count, share: shareOf(count, total) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const attributed = rows.filter((row) => row.utm_source || row.utm_campaign || row.agent_id || row.prompt_id || row.creative_id).length;
  const promptGroups = new Map();
  rows.forEach((row) => {
    const prompt = row.prompt_id || row.utm_content;
    const agent = row.agent_id || '未标记 agent';
    if (!prompt && !row.agent_id) return;
    const creative = row.creative_id || '未标记素材';
    const key = `${agent}\u0000${prompt || '未标记 prompt'}\u0000${creative}\u0000${row.utm_campaign || ''}`;
    if (!promptGroups.has(key)) promptGroups.set(key, { agent, prompt: prompt || '未标记 prompt', creative, campaign: row.utm_campaign || '未标记活动', count: 0, features: new Map() });
    const group = promptGroups.get(key);
    group.count += 1;
    (featureByRows.get(row.id) || []).forEach((feature) => group.features.set(feature, (group.features.get(feature) || 0) + 1));
  });
  const prompts = [...promptGroups.values()].map((group) => {
    const top = [...group.features.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      agent: group.agent,
      prompt: group.prompt,
      creative: group.creative,
      campaign: group.campaign,
      count: group.count,
      share: shareOf(group.count, total),
      topFeature: top ? FEATURE_LABELS[top[0]] || top[0] : '暂无偏好信号',
    };
  }).sort((a, b) => b.count - a.count || a.prompt.localeCompare(b.prompt));
  return {
    range: safeDays,
    total,
    attributed,
    coverage: shareOf(attributed, total),
    topSource: countBy((row) => row.utm_source)[0] || null,
    topFeature: features[0] || null,
    sources: countBy((row) => row.utm_source || (row.referrer ? 'Referral' : 'Direct / Unknown')),
    campaigns: countBy((row) => row.utm_campaign),
    features,
    prompts,
  };
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function leadsCsv(rows) {
  const headers = ['ID', '姓名', '邮箱', '性别', '年龄段', '关注亮点', '留言', '语言', '地理位置', '来源页', 'UTM 来源', 'UTM 媒介', 'UTM 活动', 'UTM 内容', 'Agent', 'Prompt', '素材', '首次落地页', 'Referrer', '提交时间'];
  const lines = [
    headers,
    ...rows.map((lead) => [
      lead.id,
      lead.name,
      lead.email,
      lead.genderLabel,
      lead.ageRangeLabel,
      lead.selectedFeatures,
      lead.message,
      lead.lang,
      lead.geoLabel,
      lead.pagePath,
      lead.utmSource,
      lead.utmMedium,
      lead.utmCampaign,
      lead.utmContent,
      lead.agentId,
      lead.promptId,
      lead.creativeId,
      lead.landingPath,
      lead.referrer,
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
  if (pathname === '/' || pathname === '/index.html' || pathname === '/join.html' || pathname === '/success.html' || pathname === '/favicon.svg') return true;
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

function assertAdminSession(req, res) {
  if (hasValidSession(req)) return true;
  sendError(res, 401, '未登录');
  return false;
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

async function handleLogin(req, res) {
  const ip = clientIp(req) || 'unknown';
  const rec = checkLoginRate(ip);
  if (rec.count >= LOGIN_MAX_ATTEMPTS) {
    return sendError(res, 429, '登录尝试过多，请稍后再试');
  }

  const body = await readJson(req);
  const username = clean(body.username, 50);
  const password = String(body.password ?? '');

  const userOk = safeEqualString(username, ADMIN_USER);
  const passOk = safeEqualString(password, ADMIN_PASSWORD);
  if (userOk && passOk) {
    rec.count = 0;
    const token = createSession();
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; ${cookieFlags(req)}`);
    return sendJson(res, 200, { ok: true });
  }

  rec.count += 1;
  return sendError(res, 401, '用户名或密码错误');
}

function handleLogout(req, res) {
  const token = getCookieValue(req, SESSION_COOKIE);
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieFlags(req, { clear: true })}`);
  return sendJson(res, 200, { ok: true });
}

function handleSession(req, res) {
  return sendJson(res, 200, { authenticated: hasValidSession(req) });
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
        value.intent,
        value.gender,
        value.ageRange,
        value.selectedFeatures,
        value.message,
        value.lang,
        value.pagePath,
        value.attribution.utmSource,
        value.attribution.utmMedium,
        value.attribution.utmCampaign,
        value.attribution.utmContent,
        value.attribution.utmTerm,
        value.attribution.agentId,
        value.attribution.promptId,
        value.attribution.creativeId,
        value.attribution.landingPath,
        value.attribution.referrer,
        clientIp(req),
        clean(req.headers['user-agent'], 400),
      );

      // IP 粗略定位 —— 非阻塞，不影响给用户的响应
      fillLeadGeoAsync(info.lastInsertRowid, clientIp(req));

      // 服务端 Lead 事件（Meta CAPI）——非阻塞、不影响给用户的响应
      sendCapiLead({
        value,
        ip: clientIp(req),
        userAgent: clean(req.headers['user-agent'], 400),
        sourceUrl: req.headers.referer,
        body,
      });

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

    // 公开：登录页与登录接口
    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/login' || url.pathname === '/login.html')) {
      return serveStatic(res, adminDir, '/login.html');
    }
    if (req.method === 'POST' && url.pathname === '/api/login') return handleLogin(req, res);
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/assets/favicon.svg') {
      return serveStatic(res, rootDir, '/assets/favicon.svg');
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/assets/linki-mark.svg') {
      return serveStatic(res, rootDir, '/assets/linki-mark.svg');
    }

    if (req.method === 'GET' && url.pathname === '/api/session') return handleSession(req, res);
    if (req.method === 'POST' && url.pathname === '/api/logout') return handleLogout(req, res);

    // 根路径：已登录进后台，未登录跳转登录页
    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/' || url.pathname === '/index.html')) {
      if (!hasValidSession(req)) return redirect(res, '/login');
      return serveStatic(res, adminDir, '/index.html');
    }

    // 其余后台页面与数据接口均需 Session
    if (!assertAdminSession(req, res)) return;

    if (req.method === 'GET' && url.pathname === '/api/stats') return sendJson(res, 200, getStats());

    if (req.method === 'GET' && url.pathname === '/api/attribution') {
      return sendJson(res, 200, getAttribution(url.searchParams.get('days') || '30'));
    }

    if (req.method === 'GET' && url.pathname === '/api/users/analysis') {
      return sendJson(res, 200, getUserAnalysis(url.searchParams.get('days') || 'all'));
    }

    if (req.method === 'GET' && url.pathname === '/api/leads') {
      const all = url.searchParams.get('all') === '1';
      return sendJson(res, 200, await queryLeads({
        all,
        page: url.searchParams.get('page'),
        size: url.searchParams.get('size'),
      }));
    }

    if (req.method === 'GET' && url.pathname === '/api/leads/export.csv') {
      const rows = (await queryLeads({ all: true })).items;
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
  console.log('后台鉴权：独立登录页 + 内存 Session（需 ADMIN_USER / ADMIN_PASSWORD）');
});

function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭服务...`);
  clearInterval(rateSweep);
  clearInterval(sessionSweep);
  const closeServer = (server) => new Promise((resolveClose) => server.close(resolveClose));
  Promise.all([closeServer(publicServer), closeServer(adminServer)]).finally(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

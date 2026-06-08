import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
// ⚠️ 重要:用子路徑 import,避開 pdf-parse 嘅 debug bug
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ── CORS ─────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '*')
  .split(',')
  .map(s => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error('CORS blocked'));
  },
  methods: ['GET', 'POST']
}));
app.use(express.json({ limit: '1mb' }));

// ── Rate limit (in-memory) ───────────────────
const rateLimitMap = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxReq = parseInt(process.env.RATE_LIMIT || '30', 10);

  const record = rateLimitMap.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }
  record.count++;
  rateLimitMap.set(ip, record);

  if (record.count > maxReq) {
    return res.status(429).json({ error: 'Too many requests', retryAfter: Math.ceil((record.resetAt - now) / 1000) });
  }
  next();
}

// 每 5 分鐘清一次 map,避免 memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of rateLimitMap.entries()) {
    if (now > rec.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

// ── Constants ────────────────────────────────
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,zh-HK;q=0.8,zh;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache'
};

const TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT || '20000', 10);
const MAX_BYTES = parseInt(process.env.MAX_BYTES || String(10 * 1024 * 1024), 10);
const MAX_OUTPUT_CHARS = parseInt(process.env.MAX_OUTPUT_CHARS || '50000', 10);

// ── PDF parser ───────────────────────────────
async function parsePDF(buffer) {
  try {
    const data = await pdfParse(buffer, { max: 50 });
    return { success: true, text: data.text, pages: data.numpages, info: data.info };
  } catch (err) {
    return { success: false, error: `PDF parse failed: ${err.message}` };
  }
}

// ── HTML → text ──────────────────────────────
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ── SSRF guard ───────────────────────────────
function isBlockedUrl(url) {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return true;
    const host = u.hostname.toLowerCase();
    const blocked = [
      /^localhost$/, /^127\./, /^10\./, /^192\.168\./,
      /^169\.254\./, /^0\.0\.0\.0$/, /^::1$/, /\.local$/
    ];
    return blocked.some(re => re.test(host));
  } catch {
    return true;
  }
}

// ── Main endpoint ────────────────────────────
app.post('/api/scrape', rateLimit, async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ success: false, error: 'Invalid URL' });
  }
  if (isBlockedUrl(url)) {
    return res.status(403).json({ success: false, error: 'URL not allowed' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `Upstream returned ${response.status}`,
        url
      });
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length > MAX_BYTES) {
      return res.status(413).json({ success: false, error: 'Response too large', bytes: buffer.length });
    }

    // PDF
    if (contentType.includes('pdf') || url.toLowerCase().split('?')[0].endsWith('.pdf')) {
      const result = await parsePDF(buffer);
      if (!result.success) {
        return res.status(500).json({ success: false, error: result.error, url });
      }
      return res.json({
        success: true,
        type: 'pdf',
        url,
        chars: result.text.length,
        pages: result.pages,
        text: result.text.slice(0, MAX_OUTPUT_CHARS),
        truncated: result.text.length > MAX_OUTPUT_CHARS
      });
    }

    // HTML / text
    const html = buffer.toString('utf-8');
    const text = htmlToText(html);

    return res.json({
      success: true,
      type: 'html',
      url,
      chars: text.length,
      text: text.slice(0, MAX_OUTPUT_CHARS),
      truncated: text.length > MAX_OUTPUT_CHARS
    });

  } catch (err) {
    clearTimeout(timeout);
    const msg = err.name === 'AbortError' ? 'Timeout' : err.message;
    return res.status(500).json({ success: false, error: msg, url });
  }
});

// ── Batch endpoint(一次過 10 條 URL,並行)──
app.post('/api/scrape-batch', rateLimit, async (req, res) => {
  const { urls } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 20) {
    return res.status(400).json({ error: 'urls must be array of 1-20 items' });
  }

  const results = await Promise.all(urls.map(async (url) => {
    try {
      const fakeReq = { body: { url }, ip: req.ip };
      let captured = null;
      const fakeRes = {
        status(code) { this._status = code; return this; },
        json(data) { captured = { status: this._status || 200, data }; return this; }
      };
      // 直接 inline 跑 scrape logic
      const inner = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow'
      }).catch(e => ({ ok: false, _err: e.message }));

      if (!inner.ok) return { url, success: false, error: inner._err || `HTTP ${inner.status}` };

      const ct = (inner.headers.get('content-type') || '').toLowerCase();
      const buf = Buffer.from(await inner.arrayBuffer());
      if (buf.length > MAX_BYTES) return { url, success: false, error: 'Too large' };

      if (ct.includes('pdf') || url.toLowerCase().split('?')[0].endsWith('.pdf')) {
        const r = await parsePDF(buf);
        return r.success
          ? { url, success: true, type: 'pdf', chars: r.text.length, pages: r.pages, text: r.text.slice(0, MAX_OUTPUT_CHARS) }
          : { url, success: false, error: r.error };
      }
      const text = htmlToText(buf.toString('utf-8'));
      return { url, success: true, type: 'html', chars: text.length, text: text.slice(0, MAX_OUTPUT_CHARS) };
    } catch (e) {
      return { url, success: false, error: e.message };
    }
  }));

  res.json({ success: true, count: results.length, results });
});

// ── Health ───────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), memory: process.memoryUsage().rss });
});

app.get('/', (req, res) => {
  res.json({ name: 'scraper-backend', endpoints: ['/api/scrape', '/api/scrape-batch', '/health'] });
});

app.listen(PORT, () => {
  console.log(`🚀 Scraper backend on :${PORT} | allowed: ${allowedOrigins.join(',')}`);
});

// api/scrape.js
// ─────────────────────────────────────────────────────────────
// Vercel serverless function — direct scraping, no Worker.
// • Always returns HTTP 200 (graceful) — front-end 唔再見 502
// • 8s timeout(留 buffer 喺 Vercel 10s hard limit)
// • HTML → plain text(strip script/style/tags + decode entities)
// • 自動偵測 charset(支援 Big5 / GB2312 / UTF-8)
// • 接受 App.jsx 嘅 {url, maxLength} 同舊版 {url, maxChars}
// ─────────────────────────────────────────────────────────────

const DEFAULT_MAX_CHARS = 3000;
const FETCH_TIMEOUT_MS = 8000;
const MIN_USEFUL_CHARS = 80;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-HK,zh-TW;q=0.9,zh;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
};

// ─── Helpers ──────────────────────────────────────────────────

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 10)); } catch { return ''; }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ''; }
    });
}

function htmlToText(html) {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // Block tags → newline
  t = t.replace(
    /<\/?(p|div|br|h[1-6]|li|tr|td|th|article|section|header|footer|main|aside)\b[^>]*>/gi,
    '\n'
  );

  // Strip remaining tags
  t = t.replace(/<[^>]+>/g, ' ');

  t = decodeEntities(t);

  // Whitespace normalize
  t = t
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return t;
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

function detectCharset(contentType, buf) {
  // 1. From Content-Type header
  const h = (contentType || '').match(/charset=([^;]+)/i);
  if (h) return h[1].toLowerCase().trim().replace(/['"]/g, '');

  // 2. From <meta charset="..."> in first 4 KB
  try {
    const head = new TextDecoder('ascii', { fatal: false }).decode(buf.slice(0, 4096));
    const m =
      head.match(/<meta[^>]+charset\s*=\s*["']?([^"'>\s/]+)/i) ||
      head.match(/<meta[^>]+content\s*=\s*["'][^"']*charset=([^"';\s]+)/i);
    if (m) return m[1].toLowerCase().trim();
  } catch {}

  return 'utf-8';
}

// ─── Handler ──────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res
      .status(405)
      .json({ success: false, error: 'Method not allowed; use POST' });
  }

  // Parse body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const url = body.url;
  const maxChars = Number(body.maxChars || body.maxLength) || DEFAULT_MAX_CHARS;

  // Validate URL
  if (!url || typeof url !== 'string') {
    return res.status(200).json({
      success: false, url: url || null, title: '', text: '',
      error: 'Missing or invalid url',
    });
  }
  let parsed;
  try {
    parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only http/https allowed');
    }
  } catch (e) {
    return res.status(200).json({
      success: false, url, title: '', text: '',
      error: 'Invalid URL: ' + e.message,
    });
  }

  // Fetch with timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: BROWSER_HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!response.ok) {
      return res.status(200).json({
        success: false, url, title: '', text: '',
        error: `HTTP ${response.status} ${response.statusText}`,
        _httpStatus: response.status,
      });
    }

    const ct = response.headers.get('content-type') || '';

    // Reject binary content
    if (!/text\/html|application\/xhtml|text\/plain|application\/json|text\/xml/i.test(ct)) {
      return res.status(200).json({
        success: false, url, title: '', text: '',
        error: `Unsupported content-type: ${ct}`,
      });
    }

    const buffer = await response.arrayBuffer();
    const charset = detectCharset(ct, buffer);

    let html;
    try {
      html = new TextDecoder(charset, { fatal: false }).decode(buffer);
    } catch {
      html = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    }

    const title = extractTitle(html);
    let text = htmlToText(html);
    if (text.length > maxChars) text = text.slice(0, maxChars) + '…';

    const success = text.length >= MIN_USEFUL_CHARS;
    return res.status(200).json({
      success, url, title, text,
      _chars: text.length,
      _charset: charset,
      _finalUrl: response.url,
      ...(success ? {} : { error: 'Content too short or empty' }),
    });

  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    return res.status(200).json({
      success: false, url, title: '', text: '',
      error: isTimeout
        ? `Timeout after ${FETCH_TIMEOUT_MS}ms`
        : `Fetch error: ${err.message}`,
    });
  }
}

// api/scrape.js
// ─────────────────────────────────────────────────────────────
// Vercel serverless function — direct scraping with cheerio.
// ─────────────────────────────────────────────────────────────
import * as cheerio from 'cheerio';

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

// ─── HTML → Text (cheerio version) ──────────────────────────

function htmlToText(html) {
  const $ = cheerio.load(html);
  
  // 移除唔要嘅 elements
  $('script, style, noscript, iframe, svg, link, meta, head').remove();
  
  // Block tags 後加 newline 保留段落結構
  $('p, div, br, h1, h2, h3, h4, h5, h6, li, tr, article, section, header, footer').each((_, el) => {
    $(el).append('\n');
  });
  
  let text = $('body').text() || $.root().text();
  
  // Normalize whitespace
  text = text
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return text;
}

function extractTitle(html) {
  const $ = cheerio.load(html);
  return $('title').first().text().trim().replace(/\s+/g, ' ');
}

function detectCharset(contentType, buf) {
  const h = (contentType || '').match(/charset=([^;]+)/i);
  if (h) return h[1].toLowerCase().trim().replace(/['"]/g, '');

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
    return res.status(405).json({ success: false, error: 'Method not allowed; use POST' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const url = body.url;
  const maxChars = Number(body.maxChars || body.maxLength) || DEFAULT_MAX_CHARS;

  if (!url || typeof url !== 'string') {
    return res.status(200).json({
      success: false, url: url || null, title: '', text: '',
      error: 'Missing or invalid url',
    });
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only http/https allowed');
    }
  } catch (e) {
    return res.status(200).json({
      success: false, url, title: '', text: '',
      error: 'Invalid URL: ' + e.message,
    });
  }

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

// api/resolve.js
// Resolve redirects without Worker — returns final URL after 30x chain.

const FETCH_TIMEOUT_MS = 5000;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Use POST' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const url = body.url;
  if (!url || typeof url !== 'string') {
    return res.status(200).json({ ok: false, url, finalUrl: null, error: 'Missing url' });
  }

  try {
    const p = new URL(url);
    if (!['http:', 'https:'].includes(p.protocol)) throw new Error('Only http/https');
  } catch (e) {
    return res.status(200).json({ ok: false, url, finalUrl: null, error: 'Invalid URL' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // Try HEAD first
    let r = await fetch(url, {
      method: 'HEAD',
      headers: BROWSER_HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });
    // Some servers don't support HEAD → fallback GET
    if (r.status === 405 || r.status === 501) {
      r = await fetch(url, {
        method: 'GET',
        headers: BROWSER_HEADERS,
        signal: controller.signal,
        redirect: 'follow',
      });
    }
    clearTimeout(timer);

    return res.status(200).json({
      ok: true,
      url,
      finalUrl: r.url,
      status: r.status,
      contentType: r.headers.get('content-type') || null,
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    return res.status(200).json({
      ok: false,
      url,
      finalUrl: null,
      error: isTimeout ? `Timeout after ${FETCH_TIMEOUT_MS}ms` : err.message,
    });
  }
}

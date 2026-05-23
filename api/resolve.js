// api/resolve.js
//
// Vercel Serverless Function
// 將 Google PDF 入面嘅 breadcrumb URL(e.g. "reuters.com › energy › pe...")
// 透過 DuckDuckGo Lite search 還原為真實 article URL。
//
// Request body:  { domain: string, pathHint?: string[], title?: string }
// Response 200:  { url: string|null, query, candidatesFound, allCandidates }
// Response 4xx:  { error }

export default async function handler(req, res) {
  // ── CORS ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed; use POST' });
  }

  // ── Parse body (Vercel 可能 raw 或 parsed)──
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  // ── Validate input ──
  const rawDomain = String(body.domain || '').trim().toLowerCase();
  const domain = rawDomain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[.,;:!?)\]>'"\/]+$/, '');
  const pathHint = Array.isArray(body.pathHint) ? body.pathHint.slice(0, 6) : [];
  const title = String(body.title || '').trim();

  if (!domain) {
    return res.status(400).json({ error: 'domain required (string)' });
  }
  if (domain.length > 100 || !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain)) {
    return res.status(400).json({ error: `domain "${domain}" is not a valid hostname` });
  }

  // ── Build DDG query ──
  let queryText = '';
  if (title && title.length > 8) {
    queryText = title.slice(0, 120);
  } else if (pathHint.length > 0) {
    queryText = pathHint
      .map(h => String(h).replace(/[^\w\s\u4e00-\u9fa5\-]/g, ' '))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }
  const query = queryText
    ? `site:${domain} ${queryText}`
    : `site:${domain}`;

  // ── Hit DuckDuckGo Lite (no API key, HTML)──
  const ddgUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;

  let html;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const ddgResp = await fetch(ddgUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timeoutId);

    if (!ddgResp.ok) {
      return res.status(200).json({
        url: null,
        error: `DDG returned ${ddgResp.status}`,
        query,
      });
    }
    html = await ddgResp.text();
  } catch (e) {
    return res.status(200).json({
      url: null,
      error: e.name === 'AbortError' ? 'DDG timeout (8s)' : `DDG fetch failed: ${e.message}`,
      query,
    });
  }

  // ── Parse HTML for candidate links ──
  const candidates = [];
  const linkRegex = /<a[^>]+href=["']([^"']+)["']/gi;
  let m, iter = 0;

  while ((m = linkRegex.exec(html)) !== null && iter < 300) {
    iter++;
    let rawUrl = m[1];

    // DDG Lite 用 /l/?uddg=ENCODED 做 redirect
    if (rawUrl.startsWith('/l/?') || rawUrl.startsWith('//duckduckgo.com/l/?')) {
      const uddg = rawUrl.match(/[?&]uddg=([^&]+)/);
      if (uddg) {
        try { rawUrl = decodeURIComponent(uddg[1]); }
        catch { continue; }
      } else continue;
    }

    if (!rawUrl.startsWith('http')) continue;

    rawUrl = rawUrl.replace(/[.,;:!?)\]>'"]+$/, '');

    if (rawUrl.includes('duckduckgo.com') || rawUrl.includes('duck.com')) continue;

    // 解析並驗證 domain match
    let urlHost, urlPath;
    try {
      const u = new URL(rawUrl);
      urlHost = u.hostname.toLowerCase().replace(/^www\./, '');
      urlPath = u.pathname.replace(/^\/+|\/+$/g, '');
    } catch { continue; }

    // Must match domain (exact or subdomain)
    if (urlHost !== domain && !urlHost.endsWith('.' + domain)) continue;

    // Must have meaningful path
    if (urlPath.length < 4) continue;

    // Dedup
    if (!candidates.includes(rawUrl)) {
      candidates.push(rawUrl);
      if (candidates.length >= 5) break;
    }
  }

  return res.status(200).json({
    url: candidates[0] || null,
    query,
    candidatesFound: candidates.length,
    allCandidates: candidates,
  });
}

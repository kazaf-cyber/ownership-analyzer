// ═══════════════════════════════════════════════════════════
// Ownership Analyzer Worker v1.5.0-stealth
// Routes: /api/health, /api/scrape, /api/batch-scrape, /api/resolve
// Changes from v1.3.0:
//   ✅ Implement handleResolve (was placeholder)
//   ✅ Implement handleBreadcrumbResolve (was placeholder)
//   ✅ All /api/resolve errors return HTTP 200 + structured error
//      (no more 500 noise breaking frontend pipeline)
//   ✅ Support 3 input modes: { domain, pathHint, title } | { url } | { urls }
// ═══════════════════════════════════════════════════════════

import puppeteer from "@cloudflare/puppeteer";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Worker-Key'
};

function corsResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════
// 🌐 User-Agent Pool + Header Profiles
// ═══════════════════════════════════════════════════════════
const UA_PROFILES = [
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    platform: 'Win32',
    acceptLang: 'en-US,en;q=0.9',
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    acceptLang: 'en-US,en;q=0.9,zh-TW;q=0.8',
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    platform: 'MacIntel',
    acceptLang: 'en-US,en;q=0.9',
  },
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    platform: 'Win32',
    acceptLang: 'en-US,en;q=0.5',
  },
];

function pickProfile(attempt = 0) {
  // 第一次 random,retry 時換另一個
  const idx = (Math.floor(Math.random() * UA_PROFILES.length) + attempt) % UA_PROFILES.length;
  return UA_PROFILES[idx];
}

// Pick realistic viewport
function pickViewport() {
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
  ];
  return viewports[Math.floor(Math.random() * viewports.length)];
}

// Referer based on target
function pickReferer(targetUrl) {
  try {
    const host = new URL(targetUrl).hostname;
    // 大部分搜尋流量都係 Google 點入
    const referers = [
      'https://www.google.com/',
      'https://www.google.com/search',
      'https://www.bing.com/',
      `https://${host}/`,  // 同 domain
    ];
    return referers[Math.floor(Math.random() * referers.length)];
  } catch {
    return 'https://www.google.com/';
  }
}

// ═══════════════════════════════════════════════════════════
// 🥷 Stealth init script — 過大部分 bot detection
// ═══════════════════════════════════════════════════════════
const STEALTH_SCRIPT = `
  // 1. Hide webdriver flag
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  
  // 2. Fake plugins (headless Chrome 預設係空)
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer' },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer' },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer' },
    ],
  });
  
  // 3. Fake languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  });
  
  // 4. Patch permissions API (headless 會 leak)
  if (navigator.permissions && navigator.permissions.query) {
    const originalQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (params) =>
      params && params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission, onchange: null })
        : originalQuery(params);
  }
  
  // 5. WebGL vendor spoof
  try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(p) {
      if (p === 37445) return 'Intel Inc.';
      if (p === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, p);
    };
  } catch (e) {}
  
  // 6. Chrome runtime (headless 冇)
  window.chrome = window.chrome || { runtime: {}, loadTimes: function() {}, csi: function() {} };
`;

// ═══════════════════════════════════════════════════════════
// 🚨 Block / Captcha page detection
// ═══════════════════════════════════════════════════════════
const BLOCK_PATTERNS = [
  /access denied/i,
  /you have been blocked/i,
  /please verify you are human/i,
  /are you a robot/i,
  /captcha/i,
  /cf-browser-verification/i,
  /cf-challenge/i,
  /just a moment/i,
  /enable javascript and cookies/i,
  /<title>\s*403[\s\S]{0,20}<\/title>/i,
  /<title>\s*forbidden\s*<\/title>/i,
  /<title>\s*attention required/i,
];

function detectBlock(html, title) {
  if (!html || html.length < 200) {
    return { blocked: true, reason: 'content_too_short' };
  }
  const sample = (title || '') + ' ' + html.slice(0, 8000);
  for (const p of BLOCK_PATTERNS) {
    if (p.test(sample)) {
      return { blocked: true, reason: `pattern_match: ${p.source.slice(0, 40)}` };
    }
  }
  return { blocked: false };
}

// ═══════════════════════════════════════════════════════════
// Error categorization
// ═══════════════════════════════════════════════════════════
function categorizeError(err) {
  const msg = (err?.message || '').toLowerCase();

  if (/name_not_resolved|enotfound|getaddrinfo|dns/i.test(msg))
    return { category: 'dns_error', retryable: false };
  if (/timeout|timed out|navigation timeout/i.test(msg))
    return { category: 'timeout', retryable: true };
  if (/empty_response|connection_reset|econnreset/i.test(msg))
    return { category: 'connection_reset', retryable: true };
  if (/connection_refused|econnrefused/i.test(msg))
    return { category: 'connection_refused', retryable: true };
  if (/connection_closed|socket hang up|aborted/i.test(msg))
    return { category: 'connection_closed', retryable: true };
  if (/ssl|cert|tls/i.test(msg))
    return { category: 'ssl_error', retryable: false };
  if (/blocked|forbidden|403/i.test(msg))
    return { category: 'blocked', retryable: false };

  return { category: 'unknown_error', retryable: true };
}

// ═══════════════════════════════════════════════════════════
// Scrape single URL using an EXISTING browser (no launch!)
// ═══════════════════════════════════════════════════════════
async function scrapeWithBrowser(browser, targetUrl, opts = {}) {
  const {
    timeout = 30000,
    waitUntil = 'domcontentloaded',
    maxRetries = 2,
    retryBaseMs = 1000
  } = opts;

  const startTime = Date.now();
  let attempt = 0;

  while (attempt <= maxRetries) {
    let page;
    try {
      // 🎲 每次 attempt 用唔同 profile
      const profile = pickProfile(attempt);
      const viewport = pickViewport();
      const referer = pickReferer(targetUrl);

      page = await browser.newPage();
      
      // ── Stealth setup ──
      await page.setUserAgent(profile.ua);
      await page.setViewport(viewport);
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': profile.acceptLang,
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': referer,
        'Upgrade-Insecure-Requests': '1',
      });
      
      // Inject stealth script BEFORE any page script runs
      await page.evaluateOnNewDocument(STEALTH_SCRIPT);

      const response = await page.goto(targetUrl, { waitUntil, timeout });
      const status = response ? response.status() : 0;

      // ── Retry on transient HTTP errors ──
      if (status >= 500 || status === 429) {
        if (attempt < maxRetries) {
          await page.close().catch(() => {});
          // Exponential backoff + jitter
          const jitter = Math.random() * 500;
          await sleep(retryBaseMs * Math.pow(2, attempt) + jitter);
          attempt++;
          continue;
        }
        const finalUrl = page.url();
        return {
          ok: false,
          url: targetUrl,
          finalUrl,
          status,
          errorCategory: status === 429 ? 'rate_limited' : 'server_error',
          error: `HTTP ${status} (gave up after ${attempt + 1} attempts)`,
          retriedAttempts: attempt,
          durationMs: Date.now() - startTime,
          title: '',
          html: '',
          length: 0
        };
      }

      // ── Wait for content (with small jitter to look human) ──
      const waitMs = 1200 + Math.floor(Math.random() * 800);
      await page.waitForTimeout(waitMs).catch(() => {});
      
      const html = await page.content();
      const title = await page.title().catch(() => '');
      const finalUrl = page.url();
      const ok = status >= 200 && status < 300;

      // 🚨 Block page detection — 即使 HTTP 200 都可能係 captcha
      if (ok) {
        const blockCheck = detectBlock(html, title);
        if (blockCheck.blocked) {
          if (attempt < maxRetries) {
            await page.close().catch(() => {});
            // Block 嘅 retry 用更長 backoff
            const blockBackoff = retryBaseMs * Math.pow(3, attempt) + Math.random() * 1000;
            await sleep(blockBackoff);
            attempt++;
            continue;
          }
          return {
            ok: false,
            url: targetUrl,
            finalUrl,
            status,
            title,
            html, // 保留俾你 debug
            length: html.length,
            errorCategory: 'blocked',
            error: `Block detected: ${blockCheck.reason}`,
            retriedAttempts: attempt,
            durationMs: Date.now() - startTime,
          };
        }
      }

      return {
        ok,
        url: targetUrl,
        finalUrl,
        status,
        title,
        html,
        length: html.length,
        retriedAttempts: attempt,
        durationMs: Date.now() - startTime,
        ...(ok ? {} : {
          errorCategory: status >= 400 && status < 500 ? 'client_error' : 'server_error',
          error: `HTTP ${status}`
        })
      };

    } catch (err) {
      const { category, retryable } = categorizeError(err);

      if (attempt < maxRetries && retryable) {
        const jitter = Math.random() * 500;
        await sleep(retryBaseMs * Math.pow(2, attempt) + jitter);
        attempt++;
        continue;
      }

      return {
        ok: false,
        url: targetUrl,
        status: null,
        errorCategory: category,
        error: err.message,
        errorType: err.name || 'UnknownError',
        retriedAttempts: attempt,
        durationMs: Date.now() - startTime
      };
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Single URL — launches its own browser
// ═══════════════════════════════════════════════════════════
async function scrapeUrl(env, targetUrl, opts = {}) {
  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    return await scrapeWithBrowser(browser, targetUrl, opts);
  } catch (err) {
    return {
      ok: false,
      url: targetUrl,
      status: null,
      errorCategory: 'browser_launch_failed',
      error: err.message,
      retriedAttempts: 0,
      durationMs: 0
    };
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

// ═══════════════════════════════════════════════════════════
// Batch — REUSES single browser (major perf fix)
// ═══════════════════════════════════════════════════════════
async function scrapeBatch(env, urls, opts = {}) {
  const results = [];
  let browser;

  try {
    browser = await puppeteer.launch(env.BROWSER);

    for (const targetUrl of urls) {
      const result = await scrapeWithBrowser(browser, targetUrl, opts);
      results.push(result);
    }
  } catch (err) {
    // Browser-level failure — fill remaining as failed
    for (let i = results.length; i < urls.length; i++) {
      results.push({
        ok: false,
        url: urls[i],
        status: null,
        errorCategory: 'browser_launch_failed',
        error: err.message,
        retriedAttempts: 0,
        durationMs: 0
      });
    }
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// /api/resolve — 永遠返回 200,所有錯誤都包裝成 structured response
// 支援 3 種 input mode:
//   A. { domain, pathHint, title }  → breadcrumb resolve (via DuckDuckGo)
//   B. { url }                       → single URL GET 檢查
//   C. { urls: [...] }               → batch URL 檢查
// ═══════════════════════════════════════════════════════════
async function handleResolve(request, env) {
  // 0. Parse body — 任何 JSON 錯誤都返回 200
  let body = {};
  try {
    body = await request.json();
  } catch {
    return corsResponse(JSON.stringify({
      url: null,
      query: '',
      success: false,
      error: 'invalid_json_body',
    }), 200);
  }

  try {
    // ─── Mode A: Breadcrumb resolve ───
    if (body.domain) {
      try {
        return await handleBreadcrumbResolve(body, env);
      } catch (e) {
        console.error('[resolve/breadcrumb]', e.message);
        return corsResponse(JSON.stringify({
          url: null,
          query: '',
          success: false,
          error: `breadcrumb_failed: ${e.message}`,
        }), 200);
      }
    }

    // ─── Mode B/C: URL resolve ───
    const isSingleMode = !!body.url && !body.urls;
    const inputUrls = body.urls || (body.url ? [body.url] : []);

    if (inputUrls.length === 0) {
      return corsResponse(JSON.stringify({
        url: null,
        success: false,
        error: 'missing_url_urls_or_domain',
      }), 200);
    }

    const targetUrls = inputUrls.slice(0, 20);

    const results = await Promise.all(targetUrls.map(async (targetUrl) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const profile = pickProfile(0);
const response = await fetch(targetUrl, {
  method: 'GET',
  redirect: 'follow',
  signal: controller.signal,
  headers: {
    'User-Agent': profile.ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': profile.acceptLang,
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Referer': pickReferer(targetUrl),
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-User': '?1',
  },
});
        clearTimeout(timeoutId);

        return {
          originalUrl: targetUrl,
          finalUrl: response.url || targetUrl,
          status: response.status,
          redirected: response.redirected,
          contentType: response.headers.get('content-type') || '',
          success: response.ok,
        };
      } catch (err) {
        return {
          originalUrl: targetUrl,
          finalUrl: targetUrl,
          status: 0,
          redirected: false,
          contentType: '',
          success: false,
          error: err.message,
        };
      }
    }));

    if (isSingleMode) {
      const r = results[0];
      return corsResponse(JSON.stringify({
        url: r.finalUrl,
        status: r.status,
        success: r.success,
        ...(r.error && { error: r.error }),
      }), 200);
    }

    return corsResponse(JSON.stringify({
      results,
      total: targetUrls.length,
      successful: results.filter(r => r.success).length,
    }), 200);

  } catch (err) {
    // 終極 safety net — 即使上面所有嘢都炸都唔會 500
    console.error('[resolve/outer]', err.message);
    return corsResponse(JSON.stringify({
      url: null,
      query: '',
      success: false,
      error: `handler_failed: ${err.message}`,
    }), 200);
  }
}

// ═══════════════════════════════════════════════════════════
// Breadcrumb Resolve — 用 DuckDuckGo HTML search 還原真實 article URL
//   Input:  { domain: "reuters.com", pathHint: ["energy", "pe"], title: "..." }
//   Output: { url: "https://reuters.com/energy/...", query: "...", success: true }
// 所有錯誤都返回 200 + structured error,frontend pipeline 唔會斷
// ═══════════════════════════════════════════════════════════
async function handleBreadcrumbResolve(body, env) {
  const { domain, pathHint = [], title = '' } = body;

  if (!domain || typeof domain !== 'string') {
    return corsResponse(JSON.stringify({
      url: null,
      query: '',
      success: false,
      error: 'missing_domain',
    }), 200);
  }

  // 1. Build search query: "site:domain.com hint1 hint2 title..."
  const cleanDomain = domain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .trim();

  const hintTokens = (Array.isArray(pathHint) ? pathHint : [])
    .map(s => String(s).replace(/[._\-/]+/g, ' ').trim())
    .filter(s => s.length >= 2)
    .slice(0, 5);

  const titlePart = title
    ? String(title).split(/\s+/).slice(0, 6).join(' ')
    : '';

  const queryParts = [`site:${cleanDomain}`, ...hintTokens, titlePart].filter(Boolean);
  const query = queryParts.join(' ');

  // 2. Fetch DDG HTML endpoint (8 sec timeout)
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  let html;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const profile = pickProfile(0);
const resp = await fetch(ddgUrl, {
  method: 'GET',
  redirect: 'follow',
  signal: controller.signal,
  headers: {
    'User-Agent': profile.ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': profile.acceptLang,
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://duckduckgo.com/',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
  },
});
    clearTimeout(timeoutId);

    if (!resp.ok) {
      return corsResponse(JSON.stringify({
        url: null,
        query,
        success: false,
        error: `ddg_http_${resp.status}`,
      }), 200);
    }
    html = await resp.text();
  } catch (e) {
    return corsResponse(JSON.stringify({
      url: null,
      query,
      success: false,
      error: `ddg_fetch_failed: ${e.message}`,
    }), 200);
  }

  // 3. Extract candidate URLs from DDG HTML
  //    DDG uses <a class="result__a" href="..."> sometimes wrapped via /l/?uddg=
  const candidates = [];
  const linkRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"/gi;
  let m;
  while ((m = linkRegex.exec(html)) !== null && candidates.length < 30) {
    let href = m[1];
    try {
      // Normalize DDG redirect wrappers
      if (href.startsWith('//duckduckgo.com/l/')) {
        const u = new URL('https:' + href);
        const real = u.searchParams.get('uddg');
        if (real) href = decodeURIComponent(real);
      } else if (href.startsWith('/l/')) {
        const u = new URL('https://duckduckgo.com' + href);
        const real = u.searchParams.get('uddg');
        if (real) href = decodeURIComponent(real);
      } else if (href.startsWith('//')) {
        href = 'https:' + href;
      }
    } catch {
      continue;
    }
    if (/^https?:\/\//i.test(href)) candidates.push(href);
  }

  // 4. Pick best candidate that matches the target domain
  const escapedDomain = cleanDomain.replace(/\./g, '\\.');
  const domainPattern = new RegExp(
    `^https?://([a-z0-9-]+\\.)*${escapedDomain}(/|$)`,
    'i'
  );

  let best = null;
  let bestScore = -1;
  const hintLower = hintTokens.map(h => h.toLowerCase());

  for (const c of candidates) {
    if (!domainPattern.test(c)) continue;
    // Score = how many hint tokens appear in the URL path
    const cLower = c.toLowerCase();
    let score = 0;
    for (const h of hintLower) {
      if (cLower.includes(h)) score++;
    }
    // Bonus: longer path = more likely an article (not homepage)
    try {
      const pathLen = new URL(c).pathname.replace(/^\/+|\/+$/g, '').length;
      if (pathLen >= 10) score += 1;
    } catch {}
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (!best) {
    return corsResponse(JSON.stringify({
      url: null,
      query,
      success: false,
      error: 'no_candidate_matched_domain',
      candidateCount: candidates.length,
    }), 200);
  }

  return corsResponse(JSON.stringify({
    url: best,
    query,
    success: true,
    score: bestScore,
  }), 200);
}

// ═══════════════════════════════════════════════════════════
// MAIN FETCH HANDLER
// ═══════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ─── Health ───
      if (url.pathname === '/api/health') {
        return Response.json({
          ok: true,
          hasBrowser: !!env.BROWSER,
          timestamp: new Date().toISOString(),
          worker: 'ownership-analyzer-api',
          version: '1.5.0-stealth'
        }, { headers: corsHeaders });
      }

      // ─── Root ───
      if (url.pathname === '/' || url.pathname === '') {
        return Response.json({
          name: 'ownership-analyzer-api',
          version: '1.5.0-stealth',
          endpoints: [
            'GET  /api/health',
            'POST /api/scrape',
            'POST /api/batch-scrape',
            'POST /api/resolve'
          ]
        }, { headers: corsHeaders });
      }

      // ─── Single Scrape ───
      if (url.pathname === '/api/scrape' && request.method === 'POST') {
        const body = await request.json();
        if (!body.url) {
          return Response.json(
            { ok: false, error: 'Missing "url" parameter' },
            { status: 400, headers: corsHeaders }
          );
        }
        const result = await scrapeUrl(env, body.url, {
          timeout: body.timeout || 30000,
          waitUntil: body.waitUntil || 'domcontentloaded',
          maxRetries: body.maxRetries ?? 2
        });
        return Response.json(result, {
          status: result.ok ? 200 : 502,
          headers: corsHeaders
        });
      }

      // ─── Batch Scrape ───
      if (url.pathname === '/api/batch-scrape' && request.method === 'POST') {
        const body = await request.json();
        const urls = Array.isArray(body.urls) ? body.urls : [];
        if (!urls.length) {
          return Response.json(
            { ok: false, error: 'Missing "urls" array' },
            { status: 400, headers: corsHeaders }
          );
        }

        const targetUrls = urls.slice(0, 10);
        const results = await scrapeBatch(env, targetUrls, {
          timeout: body.timeout || 30000,
          waitUntil: body.waitUntil || 'domcontentloaded',
          maxRetries: body.maxRetries ?? 2
        });

        return Response.json({
          ok: true,
          total: targetUrls.length,
          successful: results.filter(r => r.ok).length,
          failed: results.filter(r => !r.ok).length,
          errorBreakdown: results
            .filter(r => !r.ok)
            .reduce((acc, r) => {
              const k = r.errorCategory || 'unknown';
              acc[k] = (acc[k] || 0) + 1;
              return acc;
            }, {}),
          results
        }, { headers: corsHeaders });
      }

      // ─── Resolve ───
      if (url.pathname === '/api/resolve' && request.method === 'POST') {
        return handleResolve(request, env);
      }

      return Response.json(
        { error: 'Not Found', pathname: url.pathname, method: request.method },
        { status: 404, headers: corsHeaders }
      );

    } catch (e) {
      return Response.json(
        { ok: false, error: e.message, stack: e.stack },
        { status: 500, headers: corsHeaders }
      );
    }
  }
};

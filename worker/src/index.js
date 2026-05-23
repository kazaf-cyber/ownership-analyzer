// ═══════════════════════════════════════════════════════════
// Ownership Analyzer Worker v1.4.0
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
      page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7'
      });

      const response = await page.goto(targetUrl, { waitUntil, timeout });
      const status = response ? response.status() : 0;

      // ── Retry on transient HTTP errors ──
      if (status >= 500 || status === 429) {
        if (attempt < maxRetries) {
          await page.close().catch(() => {});
          await sleep(retryBaseMs * Math.pow(2, attempt));
          attempt++;
          continue;
        }
        // Final attempt — return with status
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

      // ── Success path (or 4xx that we don't retry) ──
      await page.waitForTimeout(1500).catch(() => {});
      const html = await page.content();
      const title = await page.title().catch(() => '');
      const finalUrl = page.url();
      const ok = status >= 200 && status < 300;

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
        await sleep(retryBaseMs * Math.pow(2, attempt));
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

        const response = await fetch(targetUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7',
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
    const resp = await fetch(ddgUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
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
          version: '1.4.0'
        }, { headers: corsHeaders });
      }

      // ─── Root ───
      if (url.pathname === '/' || url.pathname === '') {
        return Response.json({
          name: 'ownership-analyzer-api',
          version: '1.4.0',
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

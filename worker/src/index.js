// ═══════════════════════════════════════════════════════════
// Ownership Analyzer Worker v1.3.0
// Routes: /api/health, /api/scrape, /api/batch-scrape, /api/resolve
// Changes:
//   ✅ Fix `ok` flag (only 2xx is ok)
//   ✅ Add retry logic with exponential backoff
//   ✅ Add error categorization
//   ✅ Add timing metadata
//   ✅ Reuse single browser across batch URLs (huge perf win)
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
      const ok = status >= 200 && status < 300; // ✅ FIXED

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
          version: '1.3.0'
        }, { headers: corsHeaders });
      }

      // ─── Root ───
      if (url.pathname === '/' || url.pathname === '') {
        return Response.json({
          name: 'ownership-analyzer-api',
          version: '1.3.0',
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
          // Helpful breakdown by error type
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

      // ─── Resolve (unchanged) ───
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

// ─── handleResolve / handleBreadcrumbResolve 不變,從你 v1.2.0 直接 copy 過嚟 ───
// (篇幅關係略,直接保留原本兩個 function)

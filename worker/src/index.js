// ═══════════════════════════════════════════════════════════
// Ownership Analyzer Worker v1.2.0
// Routes: /api/health, /api/scrape, /api/batch-scrape, /api/resolve
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

// ═══════════════════════════════════════════════════════════
// Helper: scrape one URL via Puppeteer
// ═══════════════════════════════════════════════════════════
async function scrapeUrl(env, targetUrl, opts = {}) {
  const { timeout = 30000, waitUntil = 'domcontentloaded' } = opts;
  let browser;

  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7'
    });

    const response = await page.goto(targetUrl, { waitUntil, timeout });
    
    // Wait a bit more for JS-heavy pages
    await page.waitForTimeout(1500).catch(() => {});
    
    const html = await page.content();
    const title = await page.title().catch(() => '');
    const finalUrl = page.url();

    return {
      ok: true,
      url: targetUrl,
      finalUrl,
      status: response ? response.status() : 0,
      title,
      html,
      length: html.length
    };
  } catch (err) {
    return {
      ok: false,
      url: targetUrl,
      error: err.message,
      errorType: err.name || 'UnknownError'
    };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
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
          version: '1.2.0'
        }, { headers: corsHeaders });
      }

      // ─── Root ───
      if (url.pathname === '/' || url.pathname === '') {
        return Response.json({
          name: 'ownership-analyzer-api',
          endpoints: [
            'GET  /api/health',
            'POST /api/scrape',
            'POST /api/batch-scrape',
            'POST /api/resolve'
          ]
        }, { headers: corsHeaders });
      }

      // ─── Single Scrape (Puppeteer) ───
      if (url.pathname === '/api/scrape' && request.method === 'POST') {
        const body = await request.json();
        const targetUrl = body.url;
        if (!targetUrl) {
          return Response.json(
            { ok: false, error: 'Missing "url" parameter in request body' },
            { status: 400, headers: corsHeaders }
          );
        }

        const result = await scrapeUrl(env, targetUrl, {
          timeout: body.timeout || 30000,
          waitUntil: body.waitUntil || 'domcontentloaded'
        });

        return Response.json(result, {
          status: result.ok ? 200 : 502,
          headers: corsHeaders
        });
      }

      // ─── Batch Scrape (sequential to protect quota) ───
      if (url.pathname === '/api/batch-scrape' && request.method === 'POST') {
        const body = await request.json();
        const urls = Array.isArray(body.urls) ? body.urls : [];
        if (!urls.length) {
          return Response.json(
            { ok: false, error: 'Missing "urls" array in request body' },
            { status: 400, headers: corsHeaders }
          );
        }

        const targetUrls = urls.slice(0, 10); // hard cap 10
        const results = [];

        // Sequential = friendlier to Browser Rendering session pool
        for (const targetUrl of targetUrls) {
          results.push(await scrapeUrl(env, targetUrl));
        }

        return Response.json({
          ok: true,
          total: targetUrls.length,
          successful: results.filter(r => r.ok).length,
          failed: results.filter(r => !r.ok).length,
          results
        }, { headers: corsHeaders });
      }

      // ─── Resolve (unchanged) ───
      if (url.pathname === '/api/resolve' && request.method === 'POST') {
        return handleResolve(request, env);
      }

      // ─── 404 ───
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

// ═══════════════════════════════════════════════════════════
// URL Resolve - 雙模式 (unchanged from your version)
// ═══════════════════════════════════════════════════════════
async function handleResolve(request, env) {
  try {
    const body = await request.json();

    if (body.domain) {
      return await handleBreadcrumbResolve(body);
    }

    const isSingleMode = !!body.url && !body.urls;
    const inputUrls = body.urls || (body.url ? [body.url] : []);

    if (!inputUrls || inputUrls.length === 0) {
      return corsResponse(JSON.stringify({
        error: 'Missing url, urls, or domain'
      }), 400);
    }

    const targetUrls = inputUrls.slice(0, 20);

    const results = await Promise.all(
      targetUrls.map(async (targetUrl) => {
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
              'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7'
            }
          });

          clearTimeout(timeoutId);

          return {
            originalUrl: targetUrl,
            finalUrl: response.url || targetUrl,
            status: response.status,
            redirected: response.redirected,
            contentType: response.headers.get('content-type') || '',
            success: response.ok
          };
        } catch (err) {
          return {
            originalUrl: targetUrl,
            finalUrl: targetUrl,
            status: 0,
            redirected: false,
            contentType: '',
            success: false,
            error: err.message
          };
        }
      })
    );

    if (isSingleMode) {
      return corsResponse(JSON.stringify(results[0]));
    }

    return corsResponse(JSON.stringify({
      results,
      total: targetUrls.length,
      successful: results.filter(r => r.success).length
    }));

  } catch (error) {
    return corsResponse(JSON.stringify({
      success: false,
      error: error.message
    }), 500);
  }
}

async function handleBreadcrumbResolve(body) {
  const { domain, pathHint = [], title = '' } = body;

  const cleanDomain = String(domain).replace(/^https?:\/\//, '').replace(/^www\./, '').trim();
  const pathTerms = Array.isArray(pathHint)
    ? pathHint
        .map(p => String(p).replace(/[\.…]+$/g, '').trim())
        .filter(p => p && p.length >= 2)
        .slice(0, 5)
        .join(' ')
    : '';

  const query = `site:${cleanDomain} ${pathTerms} ${String(title || '').slice(0, 100)}`.trim().replace(/\s+/g, ' ');

  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const searchResp = await fetch(ddgUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://duckduckgo.com/'
      }
    });

    clearTimeout(timeoutId);

    if (!searchResp.ok) {
      return corsResponse(JSON.stringify({
        url: null, query, error: `DuckDuckGo HTTP ${searchResp.status}`
      }));
    }

    const html = await searchResp.text();

    const linkPattern = /<a[^>]+href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"/gi;
    const altPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"/gi;

    const candidates = [];
    let m;
    while ((m = linkPattern.exec(html)) !== null) candidates.push(m[1]);
    while ((m = altPattern.exec(html)) !== null) candidates.push(m[1]);

    for (let candidateUrl of candidates) {
      try {
        if (candidateUrl.includes('/l/?uddg=') || candidateUrl.includes('//duckduckgo.com/l/?uddg=')) {
          const uddgMatch = candidateUrl.match(/[?&]uddg=([^&]+)/);
          if (uddgMatch) {
            candidateUrl = decodeURIComponent(uddgMatch[1]);
          }
        }

        if (candidateUrl.startsWith('//')) {
          candidateUrl = 'https:' + candidateUrl;
        }

        const parsed = new URL(candidateUrl);
        const candidateDomain = parsed.hostname.replace(/^www\./, '');

        if (
          candidateDomain === cleanDomain ||
          candidateDomain.endsWith('.' + cleanDomain) ||
          cleanDomain.endsWith('.' + candidateDomain)
        ) {
          if (parsed.pathname && parsed.pathname.length >= 4) {
            return corsResponse(JSON.stringify({
              url: candidateUrl,
              query,
              success: true
            }));
          }
        }
      } catch {
        continue;
      }
    }

    return corsResponse(JSON.stringify({
      url: null,
      query,
      error: `No matching ${cleanDomain} URL in ${candidates.length} search results`
    }));

  } catch (err) {
    return corsResponse(JSON.stringify({
      url: null,
      query,
      error: err.message || 'Search failed'
    }));
  }
}

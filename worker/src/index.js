/**
 * URL Resolve - 雙模式
 * Mode A: { domain, pathHint, title } → 用 DuckDuckGo 搜尋揾返真實 URL
 * Mode B: { url } 或 { urls: [...] } → 跟 redirect 揾最終 URL(舊功能保留)
 */
async function handleResolve(request, env) {
  try {
    const body = await request.json();

    // ════════════════════════════════════════
    // MODE A: Breadcrumb resolution (新功能)
    // ════════════════════════════════════════
    if (body.domain) {
      return await handleBreadcrumbResolve(body);
    }

    // ════════════════════════════════════════
    // MODE B: URL redirect following (原有)
    // ════════════════════════════════════════
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

/**
 * 用 DuckDuckGo HTML 搜尋,由 breadcrumb 反向揾真實 URL
 */
async function handleBreadcrumbResolve(body) {
  const { domain, pathHint = [], title = '' } = body;

  // 清理 + 構建搜尋 query
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
    // DuckDuckGo HTML 搜尋(無需 API key)
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

    // DuckDuckGo HTML 結構: <a class="result__a" href="/l/?uddg=ENCODED_URL">
    // 或者直接係: <a href="https://realsite.com/...">
    const linkPattern = /<a[^>]+href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"/gi;
    const altPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"/gi;

    const candidates = [];
    let m;
    while ((m = linkPattern.exec(html)) !== null) candidates.push(m[1]);
    while ((m = altPattern.exec(html)) !== null) candidates.push(m[1]);

    // 揾第一個 match domain 嘅 URL
    for (let candidateUrl of candidates) {
      try {
        // DuckDuckGo 將真實 URL 包喺 /l/?uddg=ENCODED_URL
        if (candidateUrl.includes('/l/?uddg=') || candidateUrl.includes('//duckduckgo.com/l/?uddg=')) {
          const uddgMatch = candidateUrl.match(/[?&]uddg=([^&]+)/);
          if (uddgMatch) {
            candidateUrl = decodeURIComponent(uddgMatch[1]);
          }
        }

        // 補上 protocol(DDG 有時返 //domain.com/...)
        if (candidateUrl.startsWith('//')) {
          candidateUrl = 'https:' + candidateUrl;
        }

        const parsed = new URL(candidateUrl);
        const candidateDomain = parsed.hostname.replace(/^www\./, '');

        // Domain 必須 match(完全相同 或 subdomain)
        if (
          candidateDomain === cleanDomain ||
          candidateDomain.endsWith('.' + cleanDomain) ||
          cleanDomain.endsWith('.' + candidateDomain)
        ) {
          // Path 必須有實質內容(避免揾到 homepage)
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

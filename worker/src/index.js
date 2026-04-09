import puppeteer from '@cloudflare/puppeteer';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204);
    }

    // 健康檢查
    if (url.pathname === '/api/health') {
      return corsResponse(JSON.stringify({ 
        ok: true,
        status: 'ok', 
        timestamp: new Date().toISOString(),
        hasBrowser: !!env.BROWSER,
        routes: ['/api/health', '/api/screenshot', '/api/scrape', '/api/batch-scrape']
      }));
    }

    // 📸 SERP 截圖
    if (url.pathname === '/api/screenshot' && request.method === 'POST') {
      return handleScreenshot(request, env);
    }

    // 單一 URL 抓取（全文）
    if (url.pathname === '/api/scrape' && request.method === 'POST') {
      return handleScrape(request, env);
    }

    // 批次 URL 抓取
    if (url.pathname === '/api/batch-scrape' && request.method === 'POST') {
      return handleBatchScrape(request, env);
    }

    return corsResponse(JSON.stringify({ error: 'Not found' }), 404);
  }
};

/**
 * 📸 Google SERP 截圖
 */
async function handleScreenshot(request, env) {
  try {
    const { url, hl = 'en' } = await request.json();

    if (!url) {
      return corsResponse(JSON.stringify({ error: 'Missing url' }), 400);
    }

    const browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();

    const viewportWidth = 1280;
    const viewportHeight = 900;

    await page.setViewport({ width: viewportWidth, height: viewportHeight });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // 設定語言偏好
    await page.setExtraHTTPHeaders({
      'Accept-Language': hl === 'zh-TW' ? 'zh-TW,zh;q=0.9,en;q=0.8' : 'en-US,en;q=0.9'
    });

    await page.goto(url, { 
      waitUntil: 'networkidle0', 
      timeout: 25000 
    });

    // 等待搜尋結果載入
    await page.waitForTimeout(2000);

    // 嘗試關閉 Google Cookie 同意彈窗
    try {
      const consentButton = await page.$('button[id="L2AGLb"]');
      if (consentButton) await consentButton.click();
      await page.waitForTimeout(500);
    } catch {}

    // 截圖（全頁 or 視窗）
    const screenshotBuffer = await page.screenshot({
      type: 'jpeg',
      quality: 85,
      fullPage: false
    });

    await page.close();
    await browser.close();

    // 轉為 base64 data URL
    const base64 = btoa(String.fromCharCode(...new Uint8Array(screenshotBuffer)));
    const dataUrl = `data:image/jpeg;base64,${base64}`;
    const sizeKB = Math.round(screenshotBuffer.byteLength / 1024);

    return corsResponse(JSON.stringify({
      success: true,
      image: dataUrl,
      url: url,
      timestamp: new Date().toISOString(),
      sizeKB: sizeKB,
      viewport: { width: viewportWidth, height: viewportHeight }
    }));

  } catch (error) {
    return corsResponse(JSON.stringify({
      success: false,
      error: error.message
    }), 500);
  }
}

/**
 * 單一 URL 全文抓取
 */
async function handleScrape(request, env) {
  try {
    const { url, maxChars = 3000, extractText = true } = await request.json();

    if (!url) {
      return corsResponse(JSON.stringify({ error: 'Missing url' }), 400);
    }

    const browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 20000 
    });

    await page.waitForTimeout(2000);

    const result = await page.evaluate((maxLen) => {
      const removeSelectors = [
        'script', 'style', 'noscript', 'iframe',
        'nav', 'footer', 'header', 
        '.nav', '.footer', '.header', '.sidebar',
        '.ad', '.ads', '.advertisement', '.cookie-banner',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]'
      ];
      
      removeSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.remove());
      });

      const mainContent = 
        document.querySelector('article') ||
        document.querySelector('main') ||
        document.querySelector('[role="main"]') ||
        document.querySelector('.content') ||
        document.querySelector('.article-body') ||
        document.querySelector('#content') ||
        document.body;

      const text = (mainContent?.innerText || '').trim();
      const title = document.title || '';
      const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
      const lang = document.documentElement.lang || '';

      return {
        title,
        text: text.substring(0, maxLen),
        metaDescription: metaDesc,
        language: lang,
        textLength: text.length
      };
    }, maxChars);

    await page.close();
    await browser.close();

    return corsResponse(JSON.stringify({
      url,
      title: result.title,
      text: result.text,
      metaDescription: result.metaDescription,
      language: result.language,
      textLength: result.textLength,
      truncated: result.textLength > maxChars,
      success: true
    }));

  } catch (error) {
    return corsResponse(JSON.stringify({
      success: false,
      error: error.message
    }), 500);
  }
}

/**
 * 批次抓取（一次請求處理多個 URL）
 */
async function handleBatchScrape(request, env) {
  try {
    const { urls, maxChars = 3000 } = await request.json();

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return corsResponse(JSON.stringify({ error: 'Missing urls array' }), 400);
    }

    const targetUrls = urls.slice(0, 10);

    const browser = await puppeteer.launch(env.BROWSER);
    const results = [];

    for (const targetUrl of targetUrls) {
      try {
        const page = await browser.newPage();
        
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const type = req.resourceType();
          if (['image', 'font', 'media'].includes(type)) {
            req.abort();
          } else {
            req.continue();
          }
        });

        await page.goto(targetUrl, { 
          waitUntil: 'domcontentloaded', 
          timeout: 15000 
        });

        await page.waitForTimeout(1500);

        const data = await page.evaluate((maxLen) => {
          ['script','style','noscript','iframe','nav','footer','header','.ad','.ads','.sidebar']
            .forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));

          const main = document.querySelector('article') ||
                       document.querySelector('main') ||
                       document.querySelector('[role="main"]') ||
                       document.body;

          return {
            title: document.title || '',
            text: (main?.innerText || '').trim().substring(0, maxLen),
          };
        }, maxChars);

        await page.close();

        results.push({
          url: targetUrl,
          title: data.title,
          text: data.text,
          success: true
        });

      } catch (err) {
        results.push({
          url: targetUrl,
          title: '',
          text: '',
          success: false,
          error: err.message
        });
      }
    }

    await browser.close();

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
 * CORS 包裝
 */
function corsResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Worker-Key',
    }
  });
}

import puppeteer from "@cloudflare/puppeteer";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Worker-Key",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (env.WORKER_KEY) {
      const clientKey = request.headers.get("X-Worker-Key");
      if (clientKey !== env.WORKER_KEY) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
    }

    try {
      if (url.pathname === "/api/health") return handleHealth(env);
      if (url.pathname === "/api/screenshot" && request.method === "POST")
        return handleScreenshot(request, env);
      if (url.pathname === "/api/scrape" && request.method === "POST")
        return handleScrape(request);
      if (url.pathname === "/")
        return jsonResponse({
          name: "KYC/AML Compliance Worker",
          status: "running",
        });
      return jsonResponse({ error: "Not Found" }, 404);
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  },
};

function handleHealth(env) {
  const hasBrowser = !!env.BROWSER;
  return jsonResponse({
    ok: true,
    timestamp: new Date().toISOString(),
    version: "2.1.0",
    capabilities: { screenshot: hasBrowser, scrape: true },
    message: hasBrowser
      ? "✅ 所有功能可用（截圖 + 網頁抓取）"
      : "⚠️ 截圖不可用，網頁抓取可用",
  });
}

async function handleScreenshot(request, env) {
  if (!env.BROWSER) {
    return jsonResponse({ error: "Browser Rendering not configured" }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: '需要 JSON body：{ "url": "..." }' }, 400);
  }

  const { url: targetUrl, hl = "en" } = body;
  if (!targetUrl) return jsonResponse({ error: "url is required" }, 400);

  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": hl === "zh" ? "zh-TW,zh;q=0.9" : "en-US,en;q=0.9",
    });

    await page.goto(targetUrl, { waitUntil: "networkidle0", timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2000));

    const screenshot = await page.screenshot({
      type: "jpeg",
      quality: 80,
      fullPage: false,
    });
    await browser.close();

    const base64 = bufferToBase64(screenshot);
    return jsonResponse({
      image: `data:image/jpeg;base64,${base64}`,
      timestamp: new Date().toISOString(),
      url: targetUrl,
      sizeKB: Math.round(screenshot.byteLength / 1024),
    });
  } catch (e) {
    if (browser)
      try {
        await browser.close();
      } catch {}
    return jsonResponse(
      {
        error: `截圖失敗：${e.message}`,
        possibleReasons: ["Google CAPTCHA", "載入超時", "配額用完"],
      },
      500
    );
  }
}

async function handleScrape(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: '需要 JSON body：{ "url": "..." }' }, 400);
  }

  const { url: targetUrl, maxLength = 3000 } = body;
  if (!targetUrl) return jsonResponse({ error: "url is required" }, 400);

  try {
    const resp = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9,zh-TW;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      return jsonResponse({
        error: `HTTP ${resp.status}`,
        text: null,
        sourceUrl: targetUrl,
      });
    }

    const html = await resp.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<aside[\s\S]*?<\/aside>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);

    return jsonResponse({ text, length: text.length, sourceUrl: targetUrl });
  } catch (e) {
    return jsonResponse({ error: e.message, text: null, sourceUrl: targetUrl });
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Worker-Key",
    },
  });
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}


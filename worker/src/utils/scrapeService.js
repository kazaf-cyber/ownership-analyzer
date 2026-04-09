/**
 * 呼叫 Worker 批次抓取網頁全文
 */

const DEFAULT_WORKER_URL = 'https://kyc-ams-proxy.kazaftsui1120.workers.dev';

/**
 * 批次抓取多個 URL 的網頁全文
 * @param {string[]} urls - 要抓取的 URL 列表
 * @param {object} options - 選項
 * @param {string} options.workerUrl - Worker 的 URL
 * @param {number} options.maxChars - 每頁最大字數（預設 3000）
 * @param {number} options.timeout - 超時時間（毫秒，預設 30000）
 * @param {function} options.onProgress - 進度回調 (current, total, result)
 * @returns {Promise<Array<{url, title, text, success, error?}>>}
 */
export async function batchScrapeUrls(urls, options = {}) {
  const {
    workerUrl = DEFAULT_WORKER_URL,
    maxChars = 3000,
    timeout = 30000,
    onProgress = null
  } = options;

  const results = [];

  // 逐一抓取（避免 Worker 超時或 Browser Rendering 並發限制）
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${workerUrl}/api/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          url, 
          maxChars,
          extractText: true  // 告訴 Worker 只需要文字，不需要截圖
        }),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const result = {
        url,
        title: data.title || '',
        text: data.text || '',
        success: true
      };
      results.push(result);

      if (onProgress) onProgress(i + 1, urls.length, result);

    } catch (error) {
      const result = {
        url,
        title: '',
        text: '',
        success: false,
        error: error.name === 'AbortError' ? '抓取超時' : error.message
      };
      results.push(result);

      if (onProgress) onProgress(i + 1, urls.length, result);
    }
  }

  return results;
}

/**
 * 測試 Worker 連線
 */
export async function testWorkerConnection(workerUrl = DEFAULT_WORKER_URL) {
  try {
    const response = await fetch(`${workerUrl}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    return response.ok;
  } catch {
    return false;
  }
}


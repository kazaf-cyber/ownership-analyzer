import { SCRAPER_API } from './config.js';

/**
 * 單條 URL scraping
 * @returns {Promise<{success: boolean, text?: string, chars?: number, type?: string, error?: string}>}
 */
export async function scrapeUrl(url) {
  try {
    const res = await fetch(`${SCRAPER_API}/api/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || `HTTP ${res.status}`, chars: 0, text: '' };
    }
    return data;
  } catch (err) {
    return { success: false, error: err.message, chars: 0, text: '' };
  }
}

/**
 * Batch scraping(一次過 10 條,並行)
 */
export async function scrapeBatch(urls) {
  try {
    const res = await fetch(`${SCRAPER_API}/api/scrape-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls })
    });
    const data = await res.json();
    if (!res.ok) return urls.map(url => ({ url, success: false, error: data.error }));
    return data.results;
  } catch (err) {
    return urls.map(url => ({ url, success: false, error: err.message }));
  }
}

/**
 * 從 Google SERP 列印的 PDF 中提取搜尋結果 URL
 * Google 麵包屑格式: https://www.sfc.hk › gateway › news › doc
 * 轉換為真實 URL:  https://www.sfc.hk/gateway/news/doc
 */
import * as pdfjsLib from 'pdfjs-dist';

// 設定 pdf.js worker（根據你的打包工具調整路徑）
pdfjsLib.GlobalWorkerOptions.workerSrc = 
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

/**
 * 從 PDF File 物件提取 Google 搜尋結果
 * @param {File} file - 上傳的 PDF 檔案
 * @returns {Promise<Array<{url: string, title: string, snippet: string}>>}
 */
export async function extractSearchResultsFromPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  // 1. 提取所有頁面的文字
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join('\n');
    fullText += pageText + '\n';
  }

  // 2. 從文字中解析搜尋結果
  return parseGoogleSerpText(fullText);
}

/**
 * 解析 Google SERP 文字，提取 URL 和標題
 */
function parseGoogleSerpText(text) {
  const results = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 匹配麵包屑 URL 格式
    // 例如: https://www.sfc.hk › gateway › news › doc
    const breadcrumbMatch = line.match(
      /^(https?:\/\/[\w.-]+(?:\.[\w]+)+)((?:\s*[›>]\s*[\w\u4e00-\u9fff._-]+)*)$/
    );

    if (breadcrumbMatch) {
      const domain = breadcrumbMatch[1];
      const pathPart = breadcrumbMatch[2] || '';
      
      // 將 › 轉換為 /
      const path = pathPart
        .replace(/\s*[›>]\s*/g, '/')
        .trim();

      const realUrl = domain + path;

      // 過濾掉 Google 自身的 URL
      if (isGoogleUrl(realUrl)) continue;

      // 往上找標題（通常在 URL 的前 1-3 行）
      let title = '';
      let snippet = '';
      
      // 標題通常在 URL 上方 1-2 行（跳過網站名稱那行）
      for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
        const prevLine = lines[j];
        // 跳過網站名稱行（通常是英文公司名）
        if (prevLine.match(/^[A-Za-z][\w\s.&,()-]+$/) && prevLine.length < 60) continue;
        // 跳過空行和短標記
        if (prevLine.length < 3) continue;
        // 跳過其他 URL
        if (prevLine.match(/^https?:\/\//)) break;
        // 這應該是標題
        title = prevLine;
        break;
      }

      // 往下找 snippet（URL 之後的文字）
      for (let j = i + 1; j <= Math.min(lines.length - 1, i + 5); j++) {
        const nextLine = lines[j];
        // 遇到下一個 URL 或標題就停
        if (nextLine.match(/^https?:\/\//)) break;
        if (nextLine.match(/^[A-Za-z][\w\s.&,()-]+$/) && nextLine.length < 60) break;
        if (nextLine.length > 10) {
          snippet = nextLine;
          break;
        }
      }

      results.push({
        url: realUrl,
        title: title || '未知標題',
        snippet: snippet || '',
        scraped: false,
        fullText: null
      });
    }

    // 也匹配普通 URL 格式（有些 PDF 會保留完整 URL）
    const plainUrlMatch = line.match(
      /^(https?:\/\/[\w.-]+(?:\.[\w]+)+(?:\/[\w._~:/?#\[\]@!$&'()*+,;=-]*)?)$/
    );
    
    if (plainUrlMatch && !breadcrumbMatch) {
      const url = plainUrlMatch[1];
      if (!isGoogleUrl(url)) {
        // 避免重複
        if (!results.some(r => r.url === url)) {
          results.push({
            url,
            title: lines[i - 1] || '未知標題',
            snippet: '',
            scraped: false,
            fullText: null
          });
        }
      }
    }
  }

  return results;
}

/**
 * 判斷是否為 Google 自身的 URL
 */
function isGoogleUrl(url) {
  return /google\.(com|com\.\w+|co\.\w+|\w{2,3})/.test(url);
}

export { parseGoogleSerpText };


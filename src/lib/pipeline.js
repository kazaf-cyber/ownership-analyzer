import { scrapeBatch } from './scraper.js';
import { callGemini } from './gemini.js';
import {
  GATE3_EXTRACT_SYSTEM,
  FACT_EXTRACT_SYSTEM,
  CLASSIFY_NEGATIVE_NEWS_SYSTEM,
  CLASSIFY_SANCTION_SYSTEM,
  NO_HIT_FALLBACK_SYSTEM
} from './prompts.js';
import { MIN_CONTENT_CHARS, CONTEXT_WINDOW_CHARS } from './config.js';

/**
 * 主入口
 * @param {object} input
 * @param {string} input.subjectName - 要查嘅人/公司
 * @param {string[]} input.urls - 10 條 URL
 * @param {'negative_news'|'sanction'} input.mode
 * @param {function} input.onProgress - (step, payload) => void
 */
export async function runPipeline({ subjectName, urls, mode, onProgress = () => {} }) {
  // ─────────────────────────────────────────
  // STEP 1: Scrape 全部 URL(後端會處理 PDF + CORS)
  // ─────────────────────────────────────────
  onProgress('scraping', { count: urls.length });
  const scraped = await scrapeBatch(urls);
  onProgress('scraped', { results: scraped.map(s => ({ url: s.url, success: s.success, chars: s.chars || 0, type: s.type })) });

  // ─────────────────────────────────────────
  // STEP 2: 對每條 URL 跑 cascading pipeline
  // ─────────────────────────────────────────
  const finalResults = [];

  for (let i = 0; i < scraped.length; i++) {
    const item = scraped[i];
    const idx = i + 1;
    onProgress('item_start', { idx, url: item.url });

    // ─ Skip 失敗 / 內容唔夠 ─
    if (!item.success || !item.text || item.text.length < MIN_CONTENT_CHARS) {
      const fallback = await classifyNoHitFallback();
      finalResults.push({
        idx,
        url: item.url,
        label: 'NO HIT',
        reason: fallback,
        contentChars: item.chars || 0,
        scrapeError: item.error || (item.chars < MIN_CONTENT_CHARS ? 'Content too short' : null),
        modelsUsed: ['gemini-2.5-flash-lite']
      });
      onProgress('item_done', { idx, label: 'NO HIT' });
      continue;
    }

    // ─ 截 content 落 context window ─
    const content = item.text.slice(0, CONTEXT_WINDOW_CHARS);

    // ─ GATE 3 + Fact extract(平行,慳時間)─
    const [gate3, facts] = await Promise.all([
      runGate3(content),
      runFactExtract(subjectName, content)
    ]);

    onProgress('extracted', { idx, gate3: gate3.parsed, facts: facts.parsed });

    // ─ Early exit: 名唔同 → FALSE HIT(唔需要 call final model)─
    if (facts.parsed?.subject_mentioned && facts.parsed?.exact_name_match === false) {
      finalResults.push({
        idx,
        url: item.url,
        label: 'FALSE HIT',
        reason: `because the name found in content ("${facts.parsed.name_in_text}") is different from the subject name ("${subjectName}").`,
        contentChars: item.chars,
        modelsUsed: [gate3.model, facts.model],
        earlyExit: 'name_mismatch'
      });
      onProgress('item_done', { idx, label: 'FALSE HIT' });
      continue;
    }

    // ─ Early exit: 名根本冇出現 → NO HIT ─
    if (facts.parsed?.subject_mentioned === false) {
      finalResults.push({
        idx,
        url: item.url,
        label: 'NO HIT',
        reason: `because the subject name "${subjectName}" was not found in the full content of this page.`,
        contentChars: item.chars,
        modelsUsed: [gate3.model, facts.model],
        earlyExit: 'name_not_found'
      });
      onProgress('item_done', { idx, label: 'NO HIT' });
      continue;
    }

    // ─ Final classification(Flash,有 thinking)─
    const classification = await runFinalClassify({
      subjectName,
      content,
      facts: facts.parsed,
      gate3: gate3.parsed,
      mode
    });

    finalResults.push({
      idx,
      url: item.url,
      label: classification.label,
      reason: classification.reason,
      contentChars: item.chars,
      modelsUsed: [gate3.model, facts.model, classification.model],
      raw: classification.raw
    });
    onProgress('item_done', { idx, label: classification.label });
  }

  return { subjectName, mode, results: finalResults };
}

// ─────────────────────────────────────────────
//  Sub-steps
// ─────────────────────────────────────────────

async function runGate3(content) {
  const userPrompt = `TEXT:\n${content.slice(0, 4000)}`;
  const r = await callGemini('gate3_extract', GATE3_EXTRACT_SYSTEM, userPrompt, {
    responseMimeType: 'application/json'
  });
  return { ...r, parsed: safeJsonParse(r.text) };
}

async function runFactExtract(subjectName, content) {
  const userPrompt = `SUBJECT NAME: ${subjectName}\n\nTEXT:\n${content}`;
  const r = await callGemini('fact_extract', FACT_EXTRACT_SYSTEM, userPrompt, {
    responseMimeType: 'application/json'
  });
  return { ...r, parsed: safeJsonParse(r.text) };
}

async function runFinalClassify({ subjectName, content, facts, gate3, mode }) {
  const systemPrompt = mode === 'sanction'
    ? CLASSIFY_SANCTION_SYSTEM
    : CLASSIFY_NEGATIVE_NEWS_SYSTEM;

  const userPrompt = `SUBJECT NAME: ${subjectName}

EXTRACTED FACTS (for your reference, but you MUST also read FULL CONTENT below):
${JSON.stringify(facts, null, 2)}

PAGE METADATA:
${JSON.stringify(gate3, null, 2)}

FULL CONTENT (read this carefully before deciding):
${content}

Now output your decision in the exact format: <LABEL>, THEN WRITE REASON`;

  const r = await callGemini('final_classify', systemPrompt, userPrompt);
  const { label, reason } = parseDecision(r.text, mode);
  return { ...r, label, reason, raw: r.text };
}

async function classifyNoHitFallback() {
  const r = await callGemini('no_hit_fallback', NO_HIT_FALLBACK_SYSTEM, 'Output now.');
  return r.text.replace(/^NO HIT,?\s*/i, '').trim() || 'because no content could be retrieved or content was too short to evaluate.';
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function safeJsonParse(text) {
  try {
    // 移除 ```json ... ``` wrapper
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * 解析 "<LABEL>, REASON" → { label, reason }
 * 嚴格 enforce 4 個 fixed labels
 */
function parseDecision(text, mode) {
  const validLabels = mode === 'sanction'
    ? ['TRUE HIT', 'NO HIT', 'FALSE HIT', 'Irrelevant sanction']
    : ['TRUE HIT', 'NO HIT', 'FALSE HIT', 'Irrelevant ML/TF'];

  const t = text.trim();
  // 揾邊個 label 喺最前面
  let matchedLabel = null;
  for (const lbl of validLabels) {
    const re = new RegExp(`^\\s*${lbl.replace(/[/]/g, '\\/')}\\b`, 'i');
    if (re.test(t)) { matchedLabel = lbl; break; }
  }
  if (!matchedLabel) {
    return { label: 'NO HIT', reason: `because output did not match required label format. Raw: ${t.slice(0, 200)}` };
  }
  // 抽 reason
  let reason = t.replace(new RegExp(`^\\s*${matchedLabel.replace(/[/]/g, '\\/')}\\s*,?\\s*`, 'i'), '').trim();

  // Sanction mode + Irrelevant sanction → 強制加固定句
  if (mode === 'sanction' && matchedLabel === 'Irrelevant sanction') {
    if (!/there is no sanctions violations\.?$/i.test(reason)) {
      reason = reason.replace(/\.?$/, '.') + ' There is no sanctions violations.';
    }
  }
  return { label: matchedLabel, reason };
}

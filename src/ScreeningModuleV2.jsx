import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Search, Brain, AlertTriangle, CheckCircle, XCircle, Info,
  ChevronDown, ChevronRight, Globe, ExternalLink, Loader, Shield
} from 'lucide-react';

/* ════════════════════════════════════════════════════════════════
   CONSTANTS
   ════════════════════════════════════════════════════════════════ */

const EN_KEYWORDS = [
  'market abuse', 'regulatory breach', 'tax evasion', 'allegation', 'bribery',
  'corruption', 'criminal', 'fraud', 'illegal', 'indict', 'investigation',
  'laundering', 'lawsuit', 'penalty', 'prosecution', 'sanctions',
  'terrorist', 'trafficking', 'ML', 'AML'
];

const ZH_KEYWORDS_TW = [
  '市場濫用', '監管違規', '逃稅', '指控', '賄賂', '腐敗', '刑事',
  '欺詐', '非法', '起訴', '調查', '洗錢', '訴訟', '處罰', '檢舉',
  '制裁', '恐怖分子', '販運', '洗錢', '反洗錢'
];

const ZH_KEYWORDS_CN = [
  '市场滥用', '监管违规', '逃税', '指控', '贿赂', '腐败', '刑事',
  '欺诈', '非法', '起诉', '调查', '洗钱', '诉讼', '处罚', '检举',
  '制裁', '恐怖分子', '贩运', '洗钱', '反洗钱'
];

// ── Sanction Keywords: 3 Parts × 3 Languages ──
const SANCTION_EN_PART1 = ["Syria","Cuba","Iran","North Korea","Crimea","Democratic People's Republic of Korea","DPRK","DONETSK","LUHANSK REGIONS","Zaporizhzhia","Kherson"];
const SANCTION_ZH_TW_PART1 = ["敘利亞","古巴","伊朗","北韓","克里米亞","朝鮮民主主義人民共和國","頓內茨克","盧甘斯克","札波羅熱","赫爾松"];
const SANCTION_ZH_CN_PART1 = ["叙利亚","古巴","伊朗","朝鲜","克里米亚","朝鲜民主主义人民共和国","顿涅茨克","卢甘斯克","扎波罗热","赫尔松"];

const SANCTION_EN_PART2 = ["Afghanistan","Albania","Belarus","Bosnia and Herzegovina","Bulgaria","Central African Republic","Congo","Croatia","Ethiopia","Guinea-Bissau","Haiti","Iraq","Kosovo","Kyrgyzstan","Lebanon","Libya"];
const SANCTION_ZH_TW_PART2 = ["阿富汗","阿爾巴尼亞","白俄羅斯","波士尼亞與赫塞哥維納","保加利亞","中非共和國","剛果","克羅埃西亞","衣索比亞","幾內亞比紹","海地","伊拉克","科索沃","吉爾吉斯斯坦","黎巴嫩","利比亞"];
const SANCTION_ZH_CN_PART2 = ["阿富汗","阿尔巴尼亚","白俄罗斯","波斯尼亚和黑塞哥维那","保加利亚","中非共和国","刚果","克罗地亚","埃塞俄比亚","几内亚比绍","海地","伊拉克","科索沃","吉尔吉斯斯坦","黎巴嫩","利比亚"];

const SANCTION_EN_PART3 = ["Macedonia","Mali","Montenegro","Myanmar","Nicaragua","Romania","Russia","Serbia","Slovenia","Somalia","South Sudan","Sudan","Ukraine","Venezuela","Yemen"];
const SANCTION_ZH_TW_PART3 = ["馬其頓","馬裡","蒙特內哥羅","緬甸","尼加拉瓜","羅馬尼亞","俄羅斯","塞爾維亞","斯洛維尼亞","索馬利亞","南蘇丹","蘇丹","烏克蘭","委內瑞拉","葉門"];
const SANCTION_ZH_CN_PART3 = ["马其顿","马里","黑山","缅甸","尼加拉瓜","罗马尼亚","俄罗斯","塞尔维亚","斯洛文尼亚","索马里","南苏丹","苏丹","乌克兰","委内瑞拉","也门"];

function getSanctionKeywordsByPart(lang) {
  const m = {
    en:    { part1: SANCTION_EN_PART1,    part2: SANCTION_EN_PART2,    part3: SANCTION_EN_PART3 },
    zh_tw: { part1: SANCTION_ZH_TW_PART1, part2: SANCTION_ZH_TW_PART2, part3: SANCTION_ZH_TW_PART3 },
    zh_cn: { part1: SANCTION_ZH_CN_PART1, part2: SANCTION_ZH_CN_PART2, part3: SANCTION_ZH_CN_PART3 },
  };
  return m[lang] || m.en;
}

// Part 3 — Third Tier
const SANCTION_EN_PART3 = [
  "Macedonia", "Mali", "Montenegro", "Myanmar", "Nicaragua",
  "Romania", "Russia", "Serbia", "Slovenia", "Somalia",
  "South Sudan", "Sudan", "Ukraine", "Venezuela", "Yemen"
];
const SANCTION_ZH_TW_PART3 = [
  "馬其頓", "馬裡", "蒙特內哥羅", "緬甸", "尼加拉瓜",
  "羅馬尼亞", "俄羅斯", "塞爾維亞", "斯洛維尼亞",
  "索馬利亞", "南蘇丹", "蘇丹", "烏克蘭", "委內瑞拉", "葉門"
];
const SANCTION_ZH_CN_PART3 = [
  "马其顿", "马里", "黑山", "缅甸", "尼加拉瓜",
  "罗马尼亚", "俄罗斯", "塞尔维亚", "斯洛文尼亚",
  "索马里", "南苏丹", "苏丹", "乌克兰", "委内瑞拉", "也门"
];

const NATIONALITIES = [
  { value: 'CN', zh: '中國大陸', en: 'China (Mainland)' },
  { value: 'HK', zh: '中國香港', en: 'Hong Kong' },
  { value: 'MO', zh: '中國澳門', en: 'Macau' },
  { value: 'TW', zh: '中國台灣', en: 'Taiwan' },
  { value: 'US', zh: '美國', en: 'United States' },
  { value: 'GB', zh: '英國', en: 'United Kingdom' },
  { value: 'CA', zh: '加拿大', en: 'Canada' },
  { value: 'AU', zh: '澳洲', en: 'Australia' },
  { value: 'SG', zh: '新加坡', en: 'Singapore' },
  { value: 'MY', zh: '馬來西亞', en: 'Malaysia' },
  { value: 'JP', zh: '日本', en: 'Japan' },
  { value: 'KR', zh: '韓國', en: 'South Korea' },
  { value: 'IN', zh: '印度', en: 'India' },
  { value: 'ID', zh: '印尼', en: 'Indonesia' },
  { value: 'PH', zh: '菲律賓', en: 'Philippines' },
  { value: 'TH', zh: '泰國', en: 'Thailand' },
  { value: 'VN', zh: '越南', en: 'Vietnam' },
  { value: 'DE', zh: '德國', en: 'Germany' },
  { value: 'FR', zh: '法國', en: 'France' },
  { value: 'CH', zh: '瑞士', en: 'Switzerland' },
  { value: 'NL', zh: '荷蘭', en: 'Netherlands' },
  { value: 'RU', zh: '俄羅斯', en: 'Russia' },
  { value: 'BR', zh: '巴西', en: 'Brazil' },
  { value: 'AE', zh: '阿聯酋', en: 'UAE' },
  { value: 'SA', zh: '沙特阿拉伯', en: 'Saudi Arabia' },
  { value: 'ZA', zh: '南非', en: 'South Africa' },
  { value: 'OTHER', zh: '其他', en: 'Other' },
];

const GENDER_LABELS = {
  Male: '男 / Male',
  Female: '女 / Female',
  Other: '其他 / Other',
};

const CLS_CONFIG = {
  TRUE_HIT: {
    label: 'True Hit',
    icon: AlertTriangle,
    leftBar: 'bg-red-500',
    labelColor: 'text-red-700',
    cardBg: 'from-red-50 to-rose-100 border-red-200',
    text: 'text-red-700',
  },
  FALSE_HIT: {
    label: 'False Hit',
    icon: XCircle,
    leftBar: 'bg-amber-500',
    labelColor: 'text-amber-700',
    cardBg: 'from-amber-50 to-orange-100 border-amber-200',
    text: 'text-amber-700',
  },
  IRRELEVANT_MLTF: {
    label: 'Irrelevant ML/TF',
    icon: Info,
    leftBar: 'bg-slate-400',
    labelColor: 'text-slate-600',
    cardBg: 'from-slate-50 to-slate-100 border-slate-200',
    text: 'text-slate-600',
  },
  NO_HIT: {
    label: 'No Hit',
    icon: CheckCircle,
    leftBar: 'bg-emerald-500',
    labelColor: 'text-emerald-700',
    cardBg: 'from-emerald-50 to-teal-100 border-emerald-200',
    text: 'text-emerald-700',
  },
  MALFORMED: {
    label: '⚠️ Malformed',
    icon: AlertTriangle,
    leftBar: 'bg-yellow-500',
    labelColor: 'text-yellow-700',
    cardBg: 'from-yellow-50 to-yellow-100 border-yellow-300',
    text: 'text-yellow-700',
  },
  UNPROCESSED: {
    label: '⚠️ Unprocessed',
    icon: AlertTriangle,
    leftBar: 'bg-red-400',
    labelColor: 'text-red-700',
    cardBg: 'from-red-50 to-red-100 border-red-300',
    text: 'text-red-700',
  },
};

/* ════════════════════════════════════════════════════════════════
   MOCK DATA (for Demo before analysis)
   ════════════════════════════════════════════════════════════════ */

const MOCK_EN = [
  { rank: 1, cls: 'TRUE_HIT', reason: 'because the screened target "ABC Holdings Ltd" is directly named in a South China Morning Post article reporting that Hong Kong authorities have launched a formal money laundering investigation involving approximately USD 50 million.' },
  { rank: 2, cls: 'TRUE_HIT', reason: 'because Reuters reports the target faces multiple fraud allegations linked to sanctions-evasion transactions with sanctioned counterparties, directly implicating the entity in ML/TF-scope wrongdoing.' },
  { rank: 3, cls: 'FALSE_HIT', reason: 'because the named party "ABC Holdings Pty Ltd (Melbourne)" in The Australian is an Australian technology startup with a different jurisdiction and industry, so it is a different entity from the screened target.' },
  { rank: 4, cls: 'IRRELEVANT_MLTF', reason: 'because the HK Economic Journal article concerns a HKD 120 million commercial supply-contract dispute, which is a civil matter outside the ML/TF scope. There is no ML/TF negative news.' },
  { rank: 5, cls: 'NO_HIT', reason: 'because the Bloomberg article is general regulatory news about Hong Kong\'s new AML framework and does not mention the screened target at all.' },
];

const MOCK_ZH = MOCK_EN;

/* ════════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════════ */

function detectLanguageDetail(text) {
  if (!text) return 'en';
  const chinese = text.match(/[\u4e00-\u9fa5]/g);
  const chineseCount = chinese ? chinese.length : 0;
  const totalChars = text.replace(/[\s\p{P}]/gu, '').length;
  if (totalChars === 0 || chineseCount / totalChars <= 0.3) return 'en';
  const simpOnly = '国会们说这对开时问过机经还总从关动应实际认让产业专严临义书买亿';
  let simpScore = 0;
  for (const ch of text) if (simpOnly.includes(ch)) simpScore++;
  return simpScore > 0 ? 'zh_cn' : 'zh_tw';
}

ffunction buildQuery(entityName, mode, sanctionPart = 'part1') {
  const lang = detectLanguageDetail(entityName);
  let keywords;
  if (mode === 'sanction') {
    keywords = getSanctionKeywordsByPart(lang)[sanctionPart];
  } else {
    if (lang === 'zh_cn') keywords = ZH_KEYWORDS_CN;
    else if (lang === 'zh_tw') keywords = ZH_KEYWORDS_TW;
    else keywords = EN_KEYWORDS;
  }
  const kStr = keywords.map(k => `"${k}"`).join(' OR ');
  return { query: `"${entityName}" ${kStr}`, lang, keywords };
}

function formatEntityContext(info) {
  if (!info) return '';
  const parts = [];
  if (info.dob) parts.push(`Date of Birth: ${info.dob}`);
  if (info.nationality) {
    const nat = NATIONALITIES.find(n => n.value === info.nationality);
    parts.push(`Nationality: ${nat ? `${nat.en} / ${nat.zh}` : info.nationality}`);
  }
  if (info.gender) parts.push(`Gender: ${GENDER_LABELS[info.gender] || info.gender}`);
  if (info.company) parts.push(`Company/Title: ${info.company}`);
  if (info.idNumber) parts.push(`ID Number: ${info.idNumber}`);
  if (info.address) parts.push(`Address: ${info.address}`);
  if (info.notes) parts.push(`Other Notes: ${info.notes}`);
  return parts.join('\n');
}

function cleanGooglePdfText(rawText) {
  let text = rawText.normalize('NFKC');
  const aiStart = Math.max(text.indexOf('AI 概覽'), text.indexOf('AI Overview'));
  if (aiStart !== -1) {
    const searchMarker = Math.max(text.indexOf('的搜尋結果', aiStart), text.indexOf('search results', aiStart));
    if (searchMarker !== -1 && searchMarker > aiStart) {
      text = text.substring(0, aiStart) + '\n' + text.substring(searchMarker);
    }
  }
  text = text
    .replace(/AI 模式\s*全部\s*新聞\s*圖片\s*購物\s*短片\s*影片\s*更多\s*工具/g, '\n')
    .replace(/AI mode\s*All\s*News\s*Images\s*Shopping/gi, '\n')
    .replace(/顯示更多\s*[∨vV>↓]?/g, '\n')
    .replace(/翻譯這個網頁/g, '\n')
    .replace(/說明\s+發送意見\s+私隱權政策\s+條款/g, '\n')
    .replace(/About\s+Send feedback\s+Privacy\s+Terms/gi, '\n')
    .replace(/\n{4,}/g, '\n\n\n');
  return text.trim();
}

async function loadPdfJs() {
  if (window.pdfjsLib) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve();
    };
    s.onerror = () => reject(new Error('Failed to load PDF.js'));
    document.head.appendChild(s);
  });
}

async function extractPdfText(file) {
  await loadPdfJs();
  const arrayBuf = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target.result);
    reader.onerror = () => reject(new Error('Cannot read PDF'));
    reader.readAsArrayBuffer(file);
  });
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuf }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let lastY = null;
    let pageText = '';
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = item.transform ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) pageText += '\n';
      pageText += item.str + ' ';
      lastY = y;
    }
    fullText += pageText + '\n';
  }
  return cleanGooglePdfText(fullText);
}

/* ════════════════════════════════════════════════════════════════
   COUNT EXPECTED RESULTS FROM PDF TEXT
   (Counts numbered SERP entries — looks for "N 頁" / domain patterns)
   ════════════════════════════════════════════════════════════════ */
function estimateResultCount(pdfText) {
  // Heuristic: count the unique top-level result blocks.
  // Google SERP PDFs usually show domain + URL + snippet per entry.
  // We look for the typical pattern: "N 頁" page-count markers, or
  // distinct "https://" lines. Fall back to splitting on "—" date markers.
  const httpsMatches = pdfText.match(/https?:\/\/[^\s]+/g) || [];
  const uniqueDomains = new Set(
    httpsMatches.map(u => {
      try { return new URL(u).hostname; } catch { return u; }
    })
  );
  // Most Google SERPs show ~10 results per page
  // Use the larger of (unique domain count) or 10 as upper bound, but
  // do NOT trust this — return null so caller falls back to AI count.
  if (uniqueDomains.size >= 3 && uniqueDomains.size <= 20) {
    return uniqueDomains.size;
  }
  return null;
}

/* ════════════════════════════════════════════════════════════════
   PROMPT BUILDER
   ════════════════════════════════════════════════════════════════ */

function buildPrompt({ entityName, entityContext, pdfText, mode, explicitRanks = null }) {
  const ctxStr = formatEntityContext(entityContext);
  const hasContext = ctxStr.trim().length > 0;
  const isSanction = mode === 'sanction';
  const scopeLabel = isSanction ? 'sanction' : 'ML/TF';
  const irrelevantLabel = isSanction ? 'Irrelevant sanction' : 'Irrelevant ML/TF';
  const mandatorySuffix = isSanction
    ? 'There is no sanction negative news.'
    : 'There is no ML/TF negative news.';

  const retryNotice = explicitRanks
    ? `\n\n⚠️ RETRY MODE: You previously failed to return complete output for the following rank numbers: ${explicitRanks.join(', ')}.\nThis time, output EXACTLY these ranks: ${explicitRanks.join(', ')}.\nUse the original rank numbers (do NOT renumber).\nEach entry MUST be a full multi-sentence analysis — no shorthand, no truncation.\n`
    : '';

  return `You are a senior KYC/AML compliance analyst reviewing a Google search results PDF for a single screened target.
${retryNotice}
═══════════════════════════════════════════════════════
SCREENED TARGET
═══════════════════════════════════════════════════════
Name: "${entityName}"

${hasContext ? `Supplementary KYC identifiers (use to disambiguate same-name parties):
${ctxStr}` : 'Supplementary KYC identifiers: (none provided)'}

═══════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════
Read the Google search results PDF text below. It contains N numbered search results (typically 5-10). For EACH result in order, classify into EXACTLY ONE label:

  • True Hit          — the target is the DIRECT SUBJECT of ${scopeLabel}-related wrongdoing
                        (named as accused, charged, investigated, sanctioned, etc.)
  • False Hit         — the named party in the article is a DIFFERENT person/entity
                        (different jurisdiction, industry, or KYC info contradicts)
  • ${irrelevantLabel}  — target IS mentioned but content is outside ${scopeLabel} scope,
                        OR wrongdoing is against a THIRD PARTY and target is only
                        mentioned in passing (colleague, relative, alternate director)
  • No Hit            — target is not mentioned in this result at all

═══════════════════════════════════════════════════════
OUTPUT FORMAT — STRICT
═══════════════════════════════════════════════════════
One detailed entry per result, formatted as:

  <N>. <LABEL>: because <detailed multi-sentence analysis>

Allowed labels (case-sensitive): "True Hit" | "False Hit" | "${irrelevantLabel}" | "No Hit"

ENGLISH ONLY. No Chinese. No preamble. No summary. Numbered analysis only.

═══════════════════════════════════════════════════════
🚨 CRITICAL ANTI-LAZINESS RULES 🚨
═══════════════════════════════════════════════════════
1. EVERY single result MUST include the FULL format:
   "<rank>. <classification>: because <full reasoning of 3-5 sentences>"

2. DO NOT abbreviate later entries — even if the classification is the same
   as previous entries. Each result is a SEPARATE document and deserves its
   OWN complete reasoning.

3. DO NOT write shorthand like "10. Irrelevant" or "10. Irrelevant ML/TF: same as above".
   Such output will be REJECTED and you will be asked to redo it.

4. DO NOT merge, skip, or combine entries — even if content looks duplicated.
   Each numbered search result MUST get its own dedicated entry.

5. DO NOT output ranks outside the actual range of the PDF.

6. If the PDF has 10 results, you MUST output 10 entries (1 through 10).
   If the PDF has 7 results, you MUST output 7 entries (1 through 7).
   Count carefully before responding.

───────────────────────────────────────────────────────
EXAMPLES of the expected depth, length, and structure:
───────────────────────────────────────────────────────

1. ${irrelevantLabel}: because this MarketScreener article reports on bribery charges brought under the Prevention of Bribery Ordinance by Hong Kong's Independent Commission Against Corruption against Mr. Thomas Kwok and Mr. Raymond Kwok, the co-chairmen of Sun Hung Kai Properties, in connection with the long-running SHKP corruption case. The screened target is referenced in the snippet only in his incidental corporate-governance capacity as an alternate director appointed to the board during the period of the investigation, and is not himself named as a defendant, suspect, or person of interest in the proceedings. The article therefore concerns wrongdoing attributed exclusively to third parties, and the target's appearance is a passive board-disclosure mention rather than any allegation of predicate financial crime against him. ${mandatorySuffix}

2. No Hit: because this is a routine United States Securities and Exchange Commission Form N-PX proxy-voting record disclosing how a mutual fund cast its shareholder vote on the re-election of the target as an executive director of the listed company. The filing contains no narrative about the target's conduct and makes no allegation of misconduct of any kind. The token "ML" highlighted by the Google search appears as a fund-family ticker abbreviation embedded in the filing's tabular data, and bears no semantic relationship to "money laundering" — it is a false keyword match generated by substring search.

───────────────────────────────────────────────────────

Match the example's depth and specificity for EVERY result. Each entry should typically be 3-5 sentences covering: (a) what the article actually is about, (b) who the named wrongdoers are if any, (c) the target's specific role in the document, and (d) why your classification follows.

═══════════════════════════════════════════════════════
ANALYTICAL RULES (read carefully)
═══════════════════════════════════════════════════════
A. THIRD-PARTY-ACCUSED rule — If wrongdoing is attributed to a NAMED PARTY who
   is NOT the target, you MUST:
     (a) Name the actual accused party EXPLICITLY
     (b) State the target's incidental role
   → Classify as "${irrelevantLabel}".

B. KEYWORD-IN-CONTEXT rule — Search keywords may appear as website navigation,
   abbreviations/codes, or statute names. When keyword appears in such
   non-substantive context, classify as "${irrelevantLabel}" or "No Hit" and
   EXPLICITLY explain the keyword's true role.

C. KYC-DISAMBIGUATION rule — If the article's named party has identifying
   details that CLEARLY CONTRADICT the KYC info above → False Hit.

D. GROUND-TRUTH rule — Base your reason ONLY on text actually visible in the
   PDF snippet. Do NOT invent facts.

E. MANDATORY SUFFIX rule — Every "${irrelevantLabel}" entry MUST end with the
   EXACT sentence (verbatim, no paraphrase):

       "${mandatorySuffix}"

   Do NOT add this suffix to True Hit, False Hit, or No Hit entries.

═══════════════════════════════════════════════════════
GOOGLE SEARCH RESULTS PDF TEXT
═══════════════════════════════════════════════════════
${pdfText.slice(0, 30000)}

═══════════════════════════════════════════════════════
Now analyze each search result. Count the results carefully and output
ONE complete numbered entry for EACH result. Do not skip, merge, or
abbreviate any entry.
═══════════════════════════════════════════════════════`;
}

/* ════════════════════════════════════════════════════════════════
   LABEL NORMALISER
   ════════════════════════════════════════════════════════════════ */

function normaliseCls(rawLabel) {
  const k = rawLabel.trim().toLowerCase().replace(/\s+/g, ' ');
  if (k.startsWith('true hit')) return 'TRUE_HIT';
  if (k.startsWith('false hit')) return 'FALSE_HIT';
  if (k.startsWith('no hit')) return 'NO_HIT';
  if (k.startsWith('irrelevant')) return 'IRRELEVANT_MLTF';
  return 'IRRELEVANT_MLTF'; // safe default
}

/* ════════════════════════════════════════════════════════════════
   PARSER — Two-stage: rank-first then label match
   Never silently drops a line with a rank number.
   ════════════════════════════════════════════════════════════════ */

function parseAiResponse(text, mode) {
  const results = [];
  const malformedRanks = [];
  const lines = text.split(/\n/);

  // Stage 1: pull rank number off the line (very lenient)
  const rankLeadRe = /^\s*\**\s*(\d+)\s*[.\)\]\-:]\s*\**\s*(.*)$/;

  // Stage 2: validate full <label>: <reason> structure
  const fullLineRe = /^\**\s*(True Hit|False Hit|No Hit|Irrelevant(?:\s+ML\/TF|\s+sanction)?)\s*\**\s*[:：\-—]\s*(.+)$/i;

  for (const ln of lines) {
    const trimmed = ln.trim();
    if (!trimmed) continue;

    const rankMatch = trimmed.match(rankLeadRe);
    if (!rankMatch) continue;

    const rank = +rankMatch[1];
    const rest = rankMatch[2].trim();

    if (!rest) {
      // pure "10." with nothing after
      console.warn(`⚠️ Empty content for rank ${rank}: "${trimmed}"`);
      malformedRanks.push(rank);
      results.push({
        rank,
        cls: 'MALFORMED',
        reason: `⚠️ AI returned only the rank number with no content. Original line: "${trimmed}"`,
        _raw: trimmed,
        _malformed: true,
      });
      continue;
    }

    const fullMatch = rest.match(fullLineRe);
    if (fullMatch) {
      const [, rawCls, reason] = fullMatch;
      results.push({
        rank,
        cls: normaliseCls(rawCls),
        reason: reason.trim(),
        _raw: trimmed,
        _malformed: false,
      });
    } else {
      // Has rank + content but no recognisable label
      console.warn(`⚠️ Malformed line for rank ${rank}: "${trimmed}"`);
      malformedRanks.push(rank);
      results.push({
        rank,
        cls: 'MALFORMED',
        reason: `⚠️ AI returned incomplete output: "${trimmed}". Needs retry.`,
        _raw: trimmed,
        _malformed: true,
      });
    }
  }

  // Sort by rank (non-malformed first if duplicate rank)
  results.sort((a, b) => a.rank - b.rank || (a._malformed ? 1 : -1));

  // Dedup: keep first occurrence of each rank
  const seen = new Set();
  const deduped = results.filter(r => {
    if (seen.has(r.rank)) {
      console.warn(`⚠️ Duplicate rank ${r.rank} — keeping first occurrence only`);
      return false;
    }
    seen.add(r.rank);
    return true;
  });

  if (malformedRanks.length) {
    console.warn(`⚠️ Malformed ranks needing retry: ${malformedRanks.join(', ')}`);
  }

  return deduped;
}

/* ════════════════════════════════════════════════════════════════
   POST-PROCESSING — Enforce mandatory suffix on Irrelevant entries
   ════════════════════════════════════════════════════════════════ */

function enforceSuffix(parsedResults, mode) {
  const isSanction = mode === 'sanction';
  const REQUIRED_SUFFIX = isSanction
    ? 'There is no sanction negative news.'
    : 'There is no ML/TF negative news.';

  const paraphrasePatterns = isSanction
    ? [
        /\s*there (is|are) no sanction[^.]*\.?\s*$/i,
        /\s*no sanction (negative news|allegations?|concerns?|hits?|matches?)[^.]*\.?\s*$/i,
        /\s*the target is not (subject to|on)[^.]*sanction[^.]*\.?\s*$/i,
      ]
    : [
        /\s*there (is|are) no ML\/TF[^.]*\.?\s*$/i,
        /\s*there (is|are) no (money laundering|terrorist financing)[^.]*\.?\s*$/i,
        /\s*no ML\/TF (negative news|allegations?|concerns?|hits?)[^.]*\.?\s*$/i,
        /\s*the target is not (accused|implicated|involved)[^.]*ML\/TF[^.]*\.?\s*$/i,
      ];

  return parsedResults
    .map(entry => {
      if (entry.cls !== 'IRRELEVANT_MLTF') return entry;

      let reason = entry.reason.trim().replace(/\s+/g, ' ');
      if (reason.endsWith(REQUIRED_SUFFIX)) return entry;

      for (const pattern of paraphrasePatterns) {
        reason = reason.replace(pattern, '').trim();
      }
      if (!/[.!?]$/.test(reason)) reason += '.';
      reason = `${reason} ${REQUIRED_SUFFIX}`;
      return { ...entry, reason };
    })
    .sort((a, b) => a.rank - b.rank);
}

function assertSuffixCompliance(results, mode) {
  const isSanction = mode === 'sanction';
  const requiredSuffix = isSanction
    ? 'There is no sanction negative news.'
    : 'There is no ML/TF negative news.';

  const violations = results.filter(r =>
    r.cls === 'IRRELEVANT_MLTF' &&
    !r.reason.trim().endsWith(requiredSuffix)
  );

  if (violations.length > 0) {
    console.warn(
      `⚠️ Suffix enforcement: ${violations.length} Irrelevant entries lacked the required suffix and were auto-patched.`,
      violations.map(v => v.rank)
    );
  } else {
    console.log(`✅ Suffix compliance: all Irrelevant entries end with "${requiredSuffix}"`);
  }
}

/* ════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════ */

export default function ScreeningModuleV2({ entityName: initialEntityName, mode = 'adverseMedia', onFlagSTR }) {
  const isSanction = mode === 'sanction';
  const SESSION_KEY = `v2_${mode}_${initialEntityName || 'default'}`;

  const loadSession = () => {
    try { const s = sessionStorage.getItem(SESSION_KEY); if (s) return JSON.parse(s); } catch {}
    return null;
  };
  const saved = loadSession();

  /* ── State ── */
  const [activeTab, setActiveTab] = useState('start');
  const [searchEntity, setSearchEntity] = useState(saved?.searchEntity || initialEntityName || 'ABC Holdings Ltd');
  const [pdfFile, setPdfFile] = useState(null);
  const [apiKey, setApiKey] = useState(saved?.apiKey || '');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(saved?.analysisComplete || false);
  const [results, setResults] = useState(saved?.results || []);
  const [rawResponse, setRawResponse] = useState(saved?.rawResponse || '');
  const [expandedId, setExpandedId] = useState(null);
  const [filterType, setFilterType] = useState('ALL');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [showQuery, setShowQuery] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [strFlaggedRanks, setStrFlaggedRanks] = useState(new Set());
  const [expectedCount, setExpectedCount] = useState(null);
  const [retryAttempted, setRetryAttempted] = useState(false);
  const [sanctionPart, setSanctionPart] = useState(saved?.sanctionPart || 'part1'); 
  const [entityContext, setEntityContext] = useState(saved?.entityContext || {
    dob: '', nationality: '', gender: '', company: '', idNumber: '', address: '', notes: ''
  });

  const handleCtxChange = (field, value) => {
    setEntityContext(prev => ({ ...prev, [field]: value }));
  };

  /* ── Persist to sessionStorage ── */
  useEffect(() => {
    if (analysisComplete && results.length > 0) {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
          results, searchEntity, analysisComplete, entityContext, apiKey, rawResponse,
          sanctionPart,
        }));
      } catch {}
    }
  }, [results, analysisComplete, searchEntity, entityContext, apiKey, rawResponse, SESSION_KEY]);

  /* ── Derived ── */
  const lang = useMemo(() => detectLanguageDetail(searchEntity), [searchEntity]);
  const { query, keywords } = useMemo(
  () => buildQuery(searchEntity, mode, sanctionPart),  
  [searchEntity, mode, sanctionPart]                    
);
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  const counts = useMemo(() => {
    const c = { TRUE_HIT: 0, FALSE_HIT: 0, IRRELEVANT_MLTF: 0, NO_HIT: 0, MALFORMED: 0, UNPROCESSED: 0 };
    results.forEach(r => { if (c[r.cls] !== undefined) c[r.cls]++; });
    return c;
  }, [results]);

  const filteredResults = useMemo(() => {
    const base = filterType === 'ALL' ? results : results.filter(r => r.cls === filterType);
    return [...base].sort((a, b) => a.rank - b.rank);
  }, [results, filterType]);

  const hasMismatch = expectedCount !== null && results.length !== expectedCount;
  const malformedCount = useMemo(
    () => results.filter(r => r._malformed || r.cls === 'MALFORMED' || r.cls === 'UNPROCESSED').length,
    [results]
  );

  /* ── Helper: call Poe ── */
  const callPoe = async (userPrompt) => {
    const res = await fetch('https://api.poe.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Poe API HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const aiText = data?.choices?.[0]?.message?.content || '';
    if (!aiText) throw new Error('Poe API 回傳空白內容');
    return aiText;
  };

  /* ── Run Analysis ── */
  const runAnalysis = async () => {
    if (!pdfFile) { setErrorMsg('請先上傳搜尋結果 PDF 文件'); return; }
    if (!apiKey.trim()) { setErrorMsg('請輸入 POE API Key'); return; }

    setIsAnalyzing(true);
    setAnalysisComplete(false);
    setResults([]);
    setRawResponse('');
    setProgress(0);
    setErrorMsg('');
    setFilterType('ALL');
    setExpandedId(null);
    setExpectedCount(null);
    setRetryAttempted(false);

    try {
      // ── Step 1: PDF → text ──
      setProgress(15); setStage('正在讀取 PDF...');
      const pdfText = await extractPdfText(pdfFile);
      if (!pdfText.trim()) throw new Error('PDF 無法提取文字(可能是掃描圖片)');
      console.log(`📄 PDF text extracted: ${pdfText.length} chars`);

      // Heuristic estimate of result count from PDF
      const estimated = estimateResultCount(pdfText);
      if (estimated) console.log(`🔢 Estimated result count from PDF: ${estimated}`);

      // ── Step 2: Build prompt ──
      setProgress(30); setStage('正在組建 prompt...');
      const userPrompt = buildPrompt({
        entityName: searchEntity,
        entityContext,
        pdfText,
        mode,
      });
      console.log(`📝 Prompt length: ${userPrompt.length} chars`);

      // ── Step 3: First Poe API call ──
      setProgress(45); setStage('正在呼叫 Poe AI (gemini-3.5-flash)...');
      let aiText = await callPoe(userPrompt);
      console.log(`🤖 AI response length: ${aiText.length} chars`);
      console.log(aiText);
      setRawResponse(aiText);

      // ── Step 4: Parse ──
      setProgress(70); setStage('正在解析結果...');
      let parsed = parseAiResponse(aiText, mode);
      console.log(`✅ Parsed ${parsed.length} result(s)`);

      if (parsed.length === 0) {
        throw new Error('AI 回傳格式無法解析 — 請檢查 console.log 嘅 raw response。');
      }

      // ── Step 5: Determine expected count ──
      // Use max rank returned by AI as ground truth (since AI saw the PDF)
      const maxRank = Math.max(...parsed.map(r => r.rank));
      const targetCount = Math.max(maxRank, estimated || 0);
      setExpectedCount(targetCount);
      console.log(`🎯 Expected total result count: ${targetCount}`);

      // ── Step 6: Identify missing or malformed ranks → retry ──
      const okRanks = new Set(parsed.filter(r => !r._malformed).map(r => r.rank));
      const needsRetry = [];
      for (let i = 1; i <= targetCount; i++) {
        if (!okRanks.has(i)) needsRetry.push(i);
      }

      if (needsRetry.length > 0) {
        setProgress(80); setStage(`正在 retry 漏咗嘅 ${needsRetry.length} 條...`);
        console.warn(`🔄 Retrying ranks: ${needsRetry.join(', ')} (missing or malformed)`);
        setRetryAttempted(true);

        try {
          const retryPrompt = buildPrompt({
            entityName: searchEntity,
            entityContext,
            pdfText,
            mode,
            explicitRanks: needsRetry,
          });
          const retryText = await callPoe(retryPrompt);
          console.log(`🔄 Retry response:`, retryText);
          setRawResponse(prev => `${prev}\n\n========== RETRY RESPONSE ==========\n\n${retryText}`);

          const retryParsed = parseAiResponse(retryText, mode);

          // Replace malformed/missing entries with successful retry entries
          const retryGoodByRank = new Map();
          for (const r of retryParsed) {
            if (!r._malformed && needsRetry.includes(r.rank)) {
              retryGoodByRank.set(r.rank, r);
            }
          }

          parsed = parsed.filter(r => !needsRetry.includes(r.rank) || !retryGoodByRank.has(r.rank));
          for (const [, r] of retryGoodByRank) parsed.push(r);
          parsed.sort((a, b) => a.rank - b.rank);
          console.log(`✅ After retry: ${retryGoodByRank.size}/${needsRetry.length} ranks recovered`);
        } catch (retryErr) {
          console.error('Retry failed:', retryErr);
        }
      }

      // ── Step 7: Fill any still-missing ranks with placeholder ──
      const finalOkRanks = new Set(parsed.map(r => r.rank));
      for (let i = 1; i <= targetCount; i++) {
        if (!finalOkRanks.has(i)) {
          parsed.push({
            rank: i,
            cls: 'UNPROCESSED',
            reason: `⚠️ AI failed to return a valid result for entry #${i} after retry. Please re-run analysis or review the source PDF manually.`,
            _raw: '',
            _malformed: true,
          });
        }
      }

      // ── Step 8: Drop out-of-range ranks ──
      parsed = parsed.filter(r => r.rank >= 1 && r.rank <= targetCount);

      // ── Step 9: Final sort + enforce suffix ──
      setProgress(92); setStage('正在套用合規後處理...');
      parsed.sort((a, b) => a.rank - b.rank);
      parsed = enforceSuffix(parsed, mode);
      assertSuffixCompliance(parsed, mode);

      console.log(`✅ Self-check: expected ${targetCount}, got ${parsed.length}`);

      setProgress(100); setStage('完成 ✓');
      setTimeout(() => {
        setIsAnalyzing(false);
        setAnalysisComplete(true);
        setResults(parsed);
      }, 200);
    } catch (err) {
      console.error(err);
      setIsAnalyzing(false);
      setProgress(0);
      setStage('');
      setErrorMsg(`分析失敗: ${err.message}`);
    }
  };

  /* ── Manual override actions ── */
  const updateResultCls = (rank, newCls, note) => {
    setResults(prev => prev.map(r => {
      if (r.rank !== rank) return r;
      const prevLabel = CLS_CONFIG[r.cls]?.label || r.cls;
      return {
        ...r,
        cls: newCls,
        reason: `because ${note}. (Manually re-classified from "${prevLabel}" by analyst.)`,
        _manualOverride: true,
        _previousCls: r.cls,
        _malformed: false,
      };
    }));
  };

  const flagSTR = (rank, item) => {
    setStrFlaggedRanks(prev => {
      const next = new Set(prev);
      if (next.has(rank)) {
        next.delete(rank);
      } else {
        next.add(rank);
        if (onFlagSTR) {
          onFlagSTR({
            flagged: true,
            source: isSanction ? 'Sanction Screening v2' : 'Adverse Media Screening v2',
            title: `Result #${rank}`,
            riskCat: isSanction ? 'Sanctions' : 'ML/TF',
            confidence: 0.9,
          });
        }
      }
      return next;
    });
  };

  /* ── Copyable summary ── */
  const summaryText = useMemo(() => {
    if (!results.length) return '';
    return results.map(r => {
      const label = CLS_CONFIG[r.cls]?.label || r.cls;
      return `${r.rank}. ${label}: ${r.reason.replace(/^because\s/, 'because ')}`;
    }).join('\n\n');
  }, [results]);

  /* ════════════════════════════════════════════════════════════════
     RENDER — Result Card
     ════════════════════════════════════════════════════════════════ */
  const ResultCard = ({ r }) => {
    const c = CLS_CONFIG[r.cls] || CLS_CONFIG.NO_HIT;
    const isOpen = expandedId === r.rank;
    const label = isSanction && r.cls === 'IRRELEVANT_MLTF' ? 'Irrelevant sanction' : c.label;
    const reason = r.reason.replace(/^because\s/, 'because ');
    const isMalformed = r._malformed || r.cls === 'MALFORMED' || r.cls === 'UNPROCESSED';

    return (
      <div className="relative bg-white border border-slate-200 rounded-lg overflow-hidden hover:shadow-sm transition-shadow">
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${c.leftBar}`} />
        <div
          className="pl-4 pr-3 py-3 cursor-pointer flex items-start gap-2"
          onClick={() => setExpandedId(isOpen ? null : r.rank)}
        >
          <span className="text-sm font-bold text-slate-500 min-w-[24px] tabular-nums">{r.rank}.</span>
          <div className="flex-1 min-w-0">
            {isMalformed && (
              <div className="bg-yellow-100 border border-yellow-400 px-2 py-1 text-[10px] rounded mb-2 text-yellow-800 font-bold">
                ⚠️ AI returned incomplete output for this entry — manual review required
              </div>
            )}
            <div className="text-[13px] leading-relaxed">
              <span className={`font-bold ${c.labelColor}`}>{label}</span>
              <span className="text-slate-400">: </span>
              <span className="text-slate-800">{reason}</span>
            </div>
            {(r._manualOverride || strFlaggedRanks.has(r.rank)) && (
              <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[10px]">
                {r._manualOverride && <span className="text-indigo-600 font-bold">✏️ Manual override</span>}
                {strFlaggedRanks.has(r.rank) && <span className="text-red-600 font-bold">🚨 STR flagged</span>}
              </div>
            )}
          </div>
          <ChevronRight className={`w-4 h-4 text-slate-300 transition-transform mt-0.5 shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
        </div>
        {isOpen && (
          <div className="pl-4 pr-3 pb-3 border-t border-slate-100 bg-slate-50/30">
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {r.cls === 'TRUE_HIT' && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); flagSTR(r.rank, r); }} className={`text-[11px] px-2.5 py-1 rounded font-bold transition ${strFlaggedRanks.has(r.rank) ? 'bg-red-700 text-white' : 'bg-red-500 text-white hover:bg-red-600'}`}>
                    {strFlaggedRanks.has(r.rank) ? '✅ STR flagged' : '🚨 Flag STR'}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'FALSE_HIT', 'manually downgraded to False Hit by analyst'); }} className="text-[11px] px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 font-semibold">→ False Hit</button>
                  <button onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'IRRELEVANT_MLTF', 'manually re-classified to Irrelevant by analyst'); }} className="text-[11px] px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 font-semibold">→ Irrelevant</button>
                </>
              )}
              {r.cls === 'FALSE_HIT' && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'TRUE_HIT', 'manually upgraded to True Hit by analyst'); }} className="text-[11px] px-2.5 py-1 rounded bg-red-500 text-white hover:bg-red-600 font-bold">↑ True Hit</button>
                  <button onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'IRRELEVANT_MLTF', 'manually re-classified to Irrelevant by analyst'); }} className="text-[11px] px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 font-semibold">→ Irrelevant</button>
                </>
              )}
              {(r.cls === 'IRRELEVANT_MLTF' || r.cls === 'NO_HIT' || r.cls === 'MALFORMED' || r.cls === 'UNPROCESSED') && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'TRUE_HIT', 'manually upgraded to True Hit by analyst'); }} className="text-[11px] px-2.5 py-1 rounded bg-red-500 text-white hover:bg-red-600 font-bold">↑ True Hit</button>
                  <button onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'FALSE_HIT', 'manually re-classified to False Hit by analyst'); }} className="text-[11px] px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 font-semibold">→ False Hit</button>
                  {(r.cls === 'MALFORMED' || r.cls === 'UNPROCESSED') && (
                    <button onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'IRRELEVANT_MLTF', 'manually re-classified to Irrelevant by analyst'); }} className="text-[11px] px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 font-semibold">→ Irrelevant</button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── HEADER ── */}
      <div className={`relative overflow-hidden ${isSanction ? 'bg-gradient-to-br from-orange-600 via-orange-700 to-red-700' : 'bg-gradient-to-br from-emerald-700 via-teal-700 to-cyan-700'} text-white px-6 py-5`}>
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
        <div className="relative flex items-center gap-3 mb-1.5">
          <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur shadow-lg flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
              {isSanction ? 'Sanction Screening' : 'Adverse Media Screening'}
              <span className="text-[10px] font-bold bg-emerald-400/30 text-white border border-emerald-300/50 px-2 py-0.5 rounded-full">
                v2 · Poe Chat Port
              </span>
            </h1>
            <p className="text-[11px] mt-0.5 text-white/80">
              🚀 Single Poe API call · ~3-5 seconds · English-only output
            </p>
          </div>
        </div>
      </div>

      {/* ── TABS ── */}
      <div className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto flex overflow-x-auto px-4">
          {[
            { id: 'start', label: '開始', icon: '🎬' },
            { id: 'arch', label: '架構說明', icon: '🏗️' },
            { id: 'keywords', label: '關鍵字配置', icon: '🔑' },
          ].map(tb => {
            const isActive = activeTab === tb.id;
            return (
              <button
                key={tb.id}
                onClick={() => setActiveTab(tb.id)}
                className={`relative px-4 py-3 text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${isActive ? (isSanction ? 'text-orange-700' : 'text-emerald-700') : 'text-slate-500 hover:text-slate-800'}`}
              >
                <span className="text-base">{tb.icon}</span>
                {tb.label}
                {isActive && (
                  <span className={`absolute bottom-0 left-3 right-3 h-[3px] rounded-t-full ${isSanction ? 'bg-gradient-to-r from-orange-400 to-red-500' : 'bg-gradient-to-r from-emerald-400 to-cyan-500'}`} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4">
        {/* ════════════════════════ START TAB ════════════════════════ */}
        {activeTab === 'start' && (
          <div className="space-y-4">

            {/* ── STEP 1: Entity name + Google search ── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-lg ${isSanction ? 'bg-gradient-to-br from-orange-500 to-red-600' : 'bg-gradient-to-br from-emerald-500 to-teal-600'}`}>1</div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">執行 Google 搜尋</h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">輸入實體名稱,系統自動生成查詢字串</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <div className="flex-1">
                  <label className="text-[11px] font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">實體名稱</label>
                  <input
                    type="text"
                    value={searchEntity}
                    onChange={e => setSearchEntity(e.target.value)}
                    maxLength={200}
                    className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2.5 text-sm focus:bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">語言偵測</label>
                  <div className="h-[42px] px-4 rounded-lg border border-slate-200 bg-slate-50 flex items-center gap-2 min-w-[140px]">
                    <Globe className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-bold">
                      {lang === 'zh_cn' && <span className="text-emerald-600">🇨🇳 簡體</span>}
                      {lang === 'zh_tw' && <span className="text-red-600">🇹🇼 繁體</span>}
                      {lang === 'en' && <span className="text-blue-600">🇬🇧 英文</span>}
                    </span>
                  </div>
                </div>
              </div>


               {/* ★ Sanction Part Selector — 只喺 sanction mode 出現 */}
{isSanction && (
  <div className="mb-3 p-3 rounded-xl bg-orange-50 border border-orange-200">
    <div className="text-[11px] font-bold text-orange-700 mb-2">
      🛡️ 選擇 Sanction Part
    </div>
    <div className="grid grid-cols-3 gap-2">
      {[
        { v: 'part1', label: 'Part 1', desc: '最高風險' },
        { v: 'part2', label: 'Part 2', desc: '二級' },
        { v: 'part3', label: 'Part 3', desc: '三級' },
      ].map(p => {
        const kwCount = getSanctionKeywordsByPart(lang)[p.v].length;
        const active = sanctionPart === p.v;
        return (
          <button
            key={p.v}
            onClick={() => setSanctionPart(p.v)}
            className={`p-2 rounded-lg border-2 text-xs font-bold transition ${
              active
                ? 'border-orange-500 bg-orange-100 text-orange-800 shadow'
                : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300'
            }`}
          >
            <div>{p.label}</div>
            <div className="text-[9px] font-mono opacity-70">({kwCount} kw · {p.desc})</div>
          </button>
        );
      })}
    </div>
    <p className="mt-2 text-[10px] text-orange-700">
      💡 每個 Part 一次跑一次 (跑完 Part 1 → 切到 Part 2 重新 upload PDF)
    </p>
  </div>
)}

              
              <div className="flex flex-col sm:flex-row gap-2">
                <a href={googleUrl} target="_blank" rel="noopener noreferrer"
                  className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition ${searchEntity ? (isSanction ? 'bg-orange-600 text-white hover:bg-orange-700' : 'bg-emerald-600 text-white hover:bg-emerald-700') : 'bg-gray-200 text-gray-400 pointer-events-none'}`}>
                  <ExternalLink className="w-4 h-4" /> 在 Google 開啟搜尋
                </a>
                <button onClick={() => setShowQuery(!showQuery)} className={`text-xs font-bold flex items-center gap-1 hover:underline px-2 ${isSanction ? 'text-orange-600' : 'text-emerald-600'}`}>
                  {showQuery ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  預覽查詢字串
                </button>
              </div>
              {showQuery && (
                <div className="mt-2 bg-gray-900 rounded-lg p-3 overflow-x-auto">
                  <code className="text-xs text-green-400 break-all">{query}</code>
                </div>
              )}
              <div className={`mt-4 rounded-xl p-3 border-l-4 ${isSanction ? 'bg-orange-50 border-l-orange-500' : 'bg-emerald-50 border-l-emerald-500'}`}>
                <div className="text-xs">
                  <b>操作說明:</b> 點擊「在 Google 開啟搜尋」 → 確認結果 → 用
                  <kbd className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-white border border-slate-300 shadow-sm font-mono text-[10px]">Ctrl+P</kbd>
                  /
                  <kbd className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-white border border-slate-300 shadow-sm font-mono text-[10px]">Cmd+P</kbd>
                  → <b>另存為 PDF</b>
                </div>
              </div>
            </div>

            {/* ── STEP 2: Supplementary ID Info ── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-start gap-3 mb-4 flex-wrap">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
                  <span className="text-white text-base">🪪</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-bold text-slate-900">Supplementary ID Info</h2>
                    <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full text-[10px] font-bold">
                      <span>⚡</span> Recommended
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    More details = fewer false positives (used to disambiguate same-name parties)
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1">📅 Date of Birth</label>
                  <input type="date" value={entityContext.dob} onChange={e => handleCtxChange('dob', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:border-purple-400 focus:ring-2 focus:ring-purple-100 outline-none transition-all" />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1">🏳️ Nationality / Region</label>
                  <select value={entityContext.nationality} onChange={e => handleCtxChange('nationality', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:border-purple-400 focus:ring-2 focus:ring-purple-100 outline-none transition-all appearance-none">
                    <option value="">— Select —</option>
                    {NATIONALITIES.map(n => <option key={n.value} value={n.value}>{n.en} ({n.zh})</option>)}
                  </select>
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1">⚧ Gender</label>
                  <div className="flex gap-2">
                    {[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Other', label: 'Other' }].map(g => (
                      <button key={g.value} type="button"
                        onClick={() => handleCtxChange('gender', entityContext.gender === g.value ? '' : g.value)}
                        className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all ${entityContext.gender === g.value ? 'bg-purple-500 text-white border-purple-500 shadow-sm' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-purple-300 hover:bg-purple-50'}`}>
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1">🏢 Company / Title</label>
                  <input type="text" value={entityContext.company} onChange={e => handleCtxChange('company', e.target.value)}
                    placeholder="e.g. Alpha Holdings Ltd / Director"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:border-purple-400 focus:ring-2 focus:ring-purple-100 outline-none transition-all" />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1">🆔 ID Number</label>
                  <input type="text" value={entityContext.idNumber} onChange={e => handleCtxChange('idNumber', e.target.value)}
                    placeholder="Passport / ID / Registration No."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:border-purple-400 focus:ring-2 focus:ring-purple-100 outline-none transition-all" />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1">📍 Address</label>
                  <input type="text" value={entityContext.address} onChange={e => handleCtxChange('address', e.target.value)}
                    placeholder="Registered or residential address"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:border-purple-400 focus:ring-2 focus:ring-purple-100 outline-none transition-all" />
                </div>

                <div className="md:col-span-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1">📝 Other Notes</label>
                  <textarea value={entityContext.notes} onChange={e => handleCtxChange('notes', e.target.value)}
                    placeholder="Any other identifying info (e.g. known unrelated identities: not a lawyer, not a doctor)..."
                    rows={2}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:border-purple-400 focus:ring-2 focus:ring-purple-100 outline-none transition-all resize-none" />
                </div>
              </div>

              <p className="text-xs text-amber-600 mt-3 flex items-start gap-1">
                <span>💡</span>
                <span>The more details provided, the better AI can disambiguate. Data is only used for this analysis.</span>
              </p>
            </div>

            {/* ── STEP 3: Upload PDF ── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-lg ${isSanction ? 'bg-gradient-to-br from-orange-500 to-red-600' : 'bg-gradient-to-br from-emerald-500 to-teal-600'}`}>2</div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">上傳搜尋結果 PDF</h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">將 Google 搜尋頁面儲存為 PDF 後上傳</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 items-stretch">
                <label className="flex-1 cursor-pointer">
                  <div className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all ${pdfFile ? 'border-emerald-400 bg-emerald-50' : 'border-slate-300 hover:border-emerald-400 bg-slate-50/30'}`}>
                    {pdfFile ? (
                      <div className="flex items-center justify-center gap-3">
                        <CheckCircle className="w-6 h-6 text-emerald-600" />
                        <div className="text-left">
                          <div className="text-sm font-bold text-emerald-700">{pdfFile.name}</div>
                          <div className="text-[11px] text-emerald-600 mt-0.5">{(pdfFile.size / 1024).toFixed(0)} KB</div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-4xl mb-2">📄</div>
                        <div className="text-sm font-bold text-slate-700 mb-0.5">點擊上傳 PDF</div>
                        <div className="text-[11px] text-slate-500">支援 Google 搜尋結果頁面 PDF</div>
                      </div>
                    )}
                  </div>
                  <input type="file" accept="application/pdf" onChange={e => { const f = e.target.files[0]; if (f) { setPdfFile(f); setErrorMsg(''); } }} className="hidden" />
                </label>
                {pdfFile && (
                  <button onClick={() => setPdfFile(null)} className="text-xs text-slate-500 hover:text-red-600 px-4 py-2 border border-slate-200 hover:border-red-200 rounded-xl transition-all font-semibold">
                    <XCircle className="w-4 h-4 inline" /> 移除
                  </button>
                )}
              </div>
            </div>

            {/* ── STEP 4: AI Analysis ── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-start gap-3 mb-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-lg ${isSanction ? 'bg-gradient-to-br from-orange-500 to-red-600' : 'bg-gradient-to-br from-emerald-500 to-teal-600'}`}>3</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-bold text-slate-900">AI 分析 (with auto-retry)</h2>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      ⚡ 1-2 Poe API calls · ~3-8s
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">gemini-3.5-flash · single-shot + auto-retry malformed entries</p>
                </div>
              </div>

              {/* API Key */}
              <div className="mb-4 bg-slate-50 rounded-xl p-3 border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                    🔑 POE API Key
                  </label>
                  <button onClick={() => setShowKeyInput(!showKeyInput)} className="text-[11px] text-emerald-600 hover:text-emerald-700 font-bold hover:underline">
                    {showKeyInput ? '🙈 隱藏' : '👁️ 顯示/修改'}
                  </button>
                </div>
                {showKeyInput ? (
                  <input type="text" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="poe-..." className="w-full border border-slate-200 bg-white rounded-lg px-3 py-2 text-sm font-mono focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none" />
                ) : (
                  <div className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-400 bg-white font-mono flex items-center gap-2">
                    {apiKey ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>{apiKey.slice(0, 10)}{'•'.repeat(Math.min(20, apiKey.length - 10))}</span>
                      </>
                    ) : (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                        <span>(未設定)</span>
                      </>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1 flex-wrap">
                  <span>使用</span>
                  <span className="inline-block px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-bold text-[9px]">gemini-3.5-flash</span>
                  <span>via Poe API</span>
                  <a href="https://poe.com/api_key" target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline ml-auto font-semibold">
                    取得 API Key →
                  </a>
                </p>
              </div>

              {errorMsg && (
                <div className="mb-3 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="flex-1">{errorMsg}</span>
                </div>
              )}

              <button
                onClick={runAnalysis}
                disabled={isAnalyzing || !pdfFile || !searchEntity || !apiKey}
                className={`w-full py-3 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all shadow-lg text-white ${isSanction ? 'bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700' : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700'}`}
              >
                {isAnalyzing
                  ? <><Loader className="w-4 h-4 animate-spin" />AI 分析中...</>
                  : <><Brain className="w-4 h-4" />開始 AI 分析</>
                }
              </button>
            </div>

            {/* ── PROGRESS BAR ── */}
            {isAnalyzing && (
              <div className={`rounded-2xl p-4 border ${isSanction ? 'bg-orange-50 border-orange-200' : 'bg-emerald-50 border-emerald-200'}`}>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <Loader className={`w-4 h-4 animate-spin ${isSanction ? 'text-orange-600' : 'text-emerald-600'}`} />
                    <span className={`text-xs font-bold ${isSanction ? 'text-orange-700' : 'text-emerald-700'}`}>{stage}</span>
                  </div>
                  <span className={`text-base font-black ${isSanction ? 'text-orange-600' : 'text-emerald-600'}`}>{progress}%</span>
                </div>
                <div className="h-2.5 bg-white/70 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${isSanction ? 'bg-gradient-to-r from-orange-400 to-red-500' : 'bg-gradient-to-r from-emerald-400 to-teal-500'}`} style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {/* ── RESULTS ── */}
            {analysisComplete && (
              <>
                {/* Count assertion banner */}
                {expectedCount !== null && (
                  <div className={`rounded-xl p-3 text-xs flex items-start gap-2 ${
                    hasMismatch || malformedCount > 0
                      ? 'bg-red-50 border border-red-300 text-red-700'
                      : 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                  }`}>
                    {hasMismatch || malformedCount > 0 ? (
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <span className="font-bold">
                        Self-check: returned {results.length} / expected {expectedCount} result(s)
                      </span>
                      {malformedCount > 0 && (
                        <span className="ml-2 font-bold">
                          · {malformedCount} entry(s) need manual review
                        </span>
                      )}
                      {retryAttempted && (
                        <span className="ml-2 text-[10px] opacity-75">
                          (auto-retry was triggered)
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-5 gap-2.5">
                  <div className="bg-white rounded-2xl border border-slate-200 p-3 text-center">
                    <div className="text-2xl font-black text-slate-900">{results.length}</div>
                    <div className="text-[10px] text-slate-500 font-bold uppercase mt-0.5">Total</div>
                  </div>
                  {['TRUE_HIT', 'FALSE_HIT', 'IRRELEVANT_MLTF', 'NO_HIT'].map(key => {
                    const c = CLS_CONFIG[key];
                    const Icon = c.icon;
                    return (
                      <div key={key} className={`bg-gradient-to-br ${c.cardBg} rounded-2xl border p-3 text-center`}>
                        <div className={`text-2xl font-black ${c.text}`}>{counts[key]}</div>
                        <div className={`text-[10px] ${c.text} font-bold uppercase mt-0.5 flex items-center justify-center gap-1`}>
                          <Icon className="w-3 h-3" />
                          <span className="truncate">{isSanction && key === 'IRRELEVANT_MLTF' ? 'Irrelevant' : c.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Filter tabs */}
                <div className="bg-white rounded-2xl border border-slate-200 p-2">
                  <div className="flex gap-1 flex-wrap">
                    {[
                      { k: 'ALL', l: 'All', count: results.length },
                      ...['TRUE_HIT', 'FALSE_HIT', 'IRRELEVANT_MLTF', 'NO_HIT'].map(k => ({
                        k,
                        l: isSanction && k === 'IRRELEVANT_MLTF' ? 'Irrelevant' : CLS_CONFIG[k].label,
                        count: counts[k],
                      })),
                      ...(malformedCount > 0 ? [{ k: 'MALFORMED', l: '⚠️ Malformed', count: counts.MALFORMED + counts.UNPROCESSED }] : []),
                    ].map(f => {
                      const isActive = filterType === f.k;
                      return (
                        <button
                          key={f.k}
                          onClick={() => setFilterType(f.k)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                            isActive ? 'bg-gradient-to-r from-slate-700 to-slate-800 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {f.l}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-black ${isActive ? 'bg-white/25' : 'bg-slate-200 text-slate-700'}`}>
                            {f.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Result cards */}
                <div className="space-y-2">
                  {filteredResults.length === 0
                    ? <div className="text-center py-8 text-sm text-slate-400">No results</div>
                    : filteredResults.map(r => <ResultCard key={r.rank} r={r} />)
                  }
                </div>

                {/* Reset */}
                <button
                  onClick={() => { setAnalysisComplete(false); setResults([]); setPdfFile(null); setProgress(0); setRawResponse(''); setExpectedCount(null); setRetryAttempted(false); }}
                  className="w-full py-2 rounded-lg text-xs text-slate-500 border border-dashed hover:border-slate-400 hover:text-slate-700"
                >
                  🔄 Re-analyze (clear results)
                </button>

                {/* Copy summary */}
                <div className="bg-slate-50 rounded-xl border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold text-slate-700">📋 Analysis Summary (Copy & Paste)</h3>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(summaryText).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        });
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${copied ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-white hover:bg-slate-600'}`}
                    >
                      {copied ? '✅ Copied' : '📋 Copy All'}
                    </button>
                  </div>
                  <pre className="w-full max-h-96 overflow-y-auto text-xs font-mono bg-white border rounded-lg p-3 whitespace-pre-wrap text-slate-700 select-all">
                    {summaryText}
                  </pre>
                </div>

                {/* Raw AI Response (debug) */}
                {rawResponse && (
                  <details className="bg-slate-100 rounded-xl border p-3">
                    <summary className="text-xs font-bold text-slate-600 cursor-pointer">🔬 Raw AI Response (debug)</summary>
                    <pre className="mt-2 text-[10px] font-mono whitespace-pre-wrap text-slate-600 max-h-64 overflow-y-auto">{rawResponse}</pre>
                  </details>
                )}
              </>
            )}

            {/* ── Demo mock (before analysis) ── */}
            {!analysisComplete && !isAnalyzing && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">🎬</span>
                  <h3 className="text-sm font-bold text-amber-800">Demo 預覽</h3>
                  <span className="text-xs text-amber-600 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">使用 Mock 數據</span>
                </div>
                <p className="text-xs text-amber-700 mb-3">以下為模擬分析結果。完成步驟 1-3 後可獲取真實分析結果。</p>
                <div className="space-y-2">
                  {(lang === 'en' ? MOCK_EN : MOCK_ZH).map(r => <ResultCard key={r.rank} r={r} />)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════ ARCHITECTURE TAB ════════════════════════ */}
        {activeTab === 'arch' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">🏗️ v2 架構說明 (Poe Chat Port)</h2>
              <p className="text-xs text-slate-500 mt-1">Single-shot with auto-retry · 對比 legacy 嘅 multi-stage pipeline</p>
            </div>

            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4">
              <div className="text-xs font-bold text-emerald-800 mb-2">⚡ v2 流程 (1-2 API calls)</div>
              <ol className="text-xs text-emerald-900 space-y-2 list-decimal list-inside">
                <li><b>輸入實體名稱</b> → 自動生成 Google 查詢字串</li>
                <li><b>填寫 Supplementary ID Info</b>(選填但強烈推薦)</li>
                <li><b>上傳 Google SERP PDF</b> → pdf.js 抽取文字 → 清理 noise</li>
                <li><b>首次 Poe API call</b>(gemini-3.5-flash)→ 解析 numbered list</li>
                <li><b>Self-check</b>: 對比 expected count vs returned count</li>
                <li><b>Auto-retry</b>(如有 malformed/missing entries)→ 只重問漏咗嗰幾條</li>
                <li><b>Enforce mandatory suffix</b> + sort + dedup → 顯示結果</li>
              </ol>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-bold text-slate-700 mb-2">📊 v2 vs Legacy 對比</div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-white">
                    <th className="p-2 text-left border">指標</th>
                    <th className="p-2 text-center border text-emerald-700">v2</th>
                    <th className="p-2 text-center border text-amber-700">Legacy</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="p-2 border">API calls</td><td className="p-2 border text-center font-bold text-emerald-700">1-2</td><td className="p-2 border text-center font-bold text-amber-700">11-25</td></tr>
                  <tr><td className="p-2 border">分析時間</td><td className="p-2 border text-center font-bold text-emerald-700">~3-8s</td><td className="p-2 border text-center font-bold text-amber-700">~30-60s</td></tr>
                  <tr><td className="p-2 border">Code 行數</td><td className="p-2 border text-center font-bold text-emerald-700">~900</td><td className="p-2 border text-center font-bold text-amber-700">~2000</td></tr>
                  <tr><td className="p-2 border">Self-check</td><td className="p-2 border text-center font-bold text-emerald-700">✓ count + dedup + retry</td><td className="p-2 border text-center font-bold text-amber-700">無</td></tr>
                  <tr><td className="p-2 border">輸出格式</td><td className="p-2 border text-center text-emerald-700">Point-form English</td><td className="p-2 border text-center text-amber-700">Per-article facts → JS rules</td></tr>
                </tbody>
              </table>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
              <b>💡 三層 self-check:</b> (1) Parser 永遠唔 silently drop,malformed line 會標記 + warn (2) Expected count vs returned count 對比,差咗就 auto-retry 漏咗嗰幾條 (3) UI 紅色 banner 標示 mismatch + malformed,卡片有黃色警告。
            </div>
          </div>
        )}

        {/* ════════════════════════ KEYWORDS TAB ════════════════════════ */}
        {activeTab === 'keywords' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
                  <span className="text-white text-base">🔑</span>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">搜尋關鍵字</h2>
                  <p className="text-[11px] text-slate-500">
                    自動檢測語言 · 當前:
                    {lang === 'zh_cn' && <span className="ml-1 text-emerald-600 font-bold">🇨🇳 簡體</span>}
                    {lang === 'zh_tw' && <span className="ml-1 text-red-600 font-bold">🇹🇼 繁體</span>}
                    {lang === 'en' && <span className="ml-1 text-blue-600 font-bold">🇬🇧 英文</span>}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { name: '🇬🇧 English', list: EN_KEYWORDS, color: 'blue', active: lang === 'en' },
                  { name: '🇹🇼 繁體中文', list: ZH_KEYWORDS_TW, color: 'red', active: lang === 'zh_tw' },
                  { name: '🇨🇳 簡體中文', list: ZH_KEYWORDS_CN, color: 'emerald', active: lang === 'zh_cn' },
                ].map(g => (
                  <div key={g.name} className={`rounded-xl border-2 p-4 ${g.active ? `border-${g.color}-400 bg-${g.color}-50` : `border-${g.color}-100 bg-${g.color}-50/30`}`}>
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                      <h3 className={`text-sm font-bold text-${g.color}-700`}>
                        {g.name}
                        {g.active && <span className="ml-1 text-[10px] font-black bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded-full">✓ 使用中</span>}
                      </h3>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-md text-white bg-${g.color}-500`}>{g.list.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.list.map((kw, i) => (
                        <span key={i} className={`bg-white border px-2 py-1 rounded-md text-[11px] font-semibold text-${g.color}-700 border-${g.color}-200`}>
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

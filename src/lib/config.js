// ───────────────────────────────────────────
//  config.js — 所有 magic value 集中喺度
// ───────────────────────────────────────────

export const SCRAPER_API = import.meta.env.VITE_SCRAPER_API
  || 'http://localhost:3001';  // 改成你 deploy 嘅 URL

export const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── Model routing table ─────────────────────
// 邊一步用邊個 model + thinking budget
export const MODEL_ROUTES = {
  // GATE 3:抽 publisher / date / language → 純 extraction
  gate3_extract: {
    model: 'gemini-2.5-flash-lite',
    thinkingBudget: 0,
    maxTokens: 512
  },
  // Fact extraction:抽 key_observation / role / counterparty
  fact_extract: {
    model: 'gemini-2.5-flash-lite',
    thinkingBudget: 1024,
    maxTokens: 1024
  },
  // Final classification:TRUE HIT / NO HIT / FALSE HIT / Irrelevant ML/TF
  // ⚠️ 呢步用 Flash(唔好慳),要 reasoning
  final_classify: {
    model: 'gemini-2.5-flash',
    thinkingBudget: 2048,
    maxTokens: 1024
  },
  // NO_HIT 兜底(已知冇料,純粹 format)
  no_hit_fallback: {
    model: 'gemini-2.5-flash-lite',
    thinkingBudget: 0,
    maxTokens: 512
  }
};

// ── 你個 app 嘅 fixed labels ─────────────────
export const LABELS_NEGATIVE_NEWS = ['TRUE HIT', 'NO HIT', 'FALSE HIT', 'Irrelevant ML/TF'];
export const LABELS_SANCTION = ['TRUE HIT', 'NO HIT', 'FALSE HIT', 'Irrelevant sanction'];

// ── 內容門檻 ─────────────────────────────────
export const MIN_CONTENT_CHARS = 200;   // 少過呢個數 = content insufficient
export const CONTEXT_WINDOW_CHARS = 12000; // 餵俾 LLM 嘅 content 上限

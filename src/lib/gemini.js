import { GEMINI_API_KEY, GEMINI_ENDPOINT, MODEL_ROUTES } from './config.js';

/**
 * 統一 call Gemini 嘅入口
 * @param {keyof typeof MODEL_ROUTES} routeKey - 邊一步(e.g. 'final_classify')
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} options - { responseMimeType: 'application/json' }
 */
export async function callGemini(routeKey, systemPrompt, userPrompt, options = {}) {
  const route = MODEL_ROUTES[routeKey];
  if (!route) throw new Error(`Unknown route: ${routeKey}`);

  const url = `${GEMINI_ENDPOINT}/${route.model}:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: route.maxTokens,
      thinkingConfig: { thinkingBudget: route.thinkingBudget },
      ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {})
    }
  };

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const elapsed = Date.now() - t0;

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${route.model} failed (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data.usageMetadata || {};

  return {
    text,
    model: route.model,
    elapsed,
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    thinkingTokens: usage.thoughtsTokenCount || 0
  };
}

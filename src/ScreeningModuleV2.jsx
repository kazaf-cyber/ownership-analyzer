/**
 * ScreeningModuleV2 — Poe Chat workflow port
 *
 * Drop-in replacement for the legacy ScreeningModule.
 * Mimics the user's proven Poe Chat tuning:
 *   System prompt → user uploads PDF → AI returns point-form 1-N list.
 *
 * NO two-pass. NO 17 patches. NO sibling cross-checks.
 * Trust the model. Verify with manual override UI.
 *
 * Size: ~250 lines vs legacy ~2000 lines.
 */
import React, { useState, useRef } from 'react';
import { Shield, Loader, CheckCircle, AlertTriangle, XCircle, Info, ChevronRight } from 'lucide-react';

/* ════════════════════════════════════════════════════════════════
   SYSTEM PROMPT — 1:1 port of your tuned Poe Chat instructions
   ════════════════════════════════════════════════════════════════ */
const buildSystemPrompt = (mode) => {
  const isSanction = mode === 'sanction';
  const irrelevantLabel = isSanction ? 'Irrelevant sanction' : 'Irrelevant ML/TF';
  const suffix = isSanction ? 'no sanctions violations' : 'no ML/TF negative news';

  return `You are a CDD expert performing ${isSanction ? 'sanctions' : 'adverse media'} screening.

# YOUR TASK
Analyse the provided PDF (Google search results) and classify EACH search result against the target.

# 4 CLASSIFICATION LABELS

1. **True Hit** — the hit is confirmed to be the subject AND associated with ${isSanction ? 'sanctions designation/evasion' : 'ML/TF negative news'}
2. **False Hit** — Full name / DOB / age / nationality does NOT match the target (different person/entity)
3. **No Hit** — no search keywords found, or no result returned, or target not mentioned at all
4. **${irrelevantLabel}** — target name matches but NO ${isSanction ? 'sanctions' : 'ML/TF'} content. Per CDD rule, no need to fully verify identity when there is ${suffix}.

# OUTPUT FORMAT (STRICT)

Use point-form list, one per search result. Each line:
\`[Label]: because [English reason, 1-2 sentences with article-specific detail]\`

Rules:
- Start each point directly with the label. DO NOT repeat headers.
- English reasoning only.
- Include article-specific anchors (date / regulator / amount / role) so each reason is uniquely distinguishable.
- DO NOT fabricate facts not in the PDF.
- One point per search result, in display order (1, 2, 3...).

# EXAMPLE OUTPUT
1. **Irrelevant ML/TF**: because this is a standard regulatory disclosure dated 2024-03-15 from HKEX with no allegations of financial crime against the target.
2. **False Hit**: because the article refers to "ABC Holdings Pty Ltd" (an Australian entity), not the screened "ABC Holdings Ltd".
3. **True Hit**: because the target was indicted on 2026-01-20 by OFAC for facilitating USD 50M in sanctions evasion via shell companies.

Begin classification now.`;
};

/* ════════════════════════════════════════════════════════════════
   POE API CALL — single round-trip with full PDF text
   ════════════════════════════════════════════════════════════════ */
async function classifyWithPoe({ targetName, kycContext, pdfText, mode, apiKey }) {
  const systemPrompt = buildSystemPrompt(mode);

  const kycBlock = kycContext && Object.values(kycContext).some(v => v && String(v).trim())
    ? `\n\nKYC-supplied identifiers (use to disambiguate same-name cases):\n${
        Object.entries(kycContext).filter(([_, v]) => v).map(([k, v]) => `  ${k}: ${v}`).join('\n')
      }`
    : '';

  const userMessage =
    `TARGET: "${targetName}"${kycBlock}\n\n` +
    `PDF CONTENT (Google search results):\n${pdfText.slice(0, 50000)}\n\n` +
    `Please classify each search result above. Use point-form 1, 2, 3... in display order.`;

  const res = await fetch('https://api.poe.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: 'Gemini-3.5-Flash',  // ← your proven model
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.15,
      max_tokens: 4000,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Poe API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

/* ════════════════════════════════════════════════════════════════
   PARSER — point-form → structured array
   ════════════════════════════════════════════════════════════════ */
const LABEL_MAP = {
  'true hit': 'TRUE_HIT',
  'false hit': 'FALSE_HIT',
  'no hit': 'NO_HIT',
  'irrelevant ml/tf': 'IRRELEVANT_MLTF',
  'irrelevant sanction': 'IRRELEVANT_MLTF',
  'irrelevant sanctions': 'IRRELEVANT_MLTF',
};

function parseListOutput(text) {
  const lines = text.split('\n');
  const results = [];
  let currentRank = 0;

  for (const line of lines) {
    const m = line.match(/^\s*(\d+)[\.\)]\s*\**\s*([^*:]+?)\s*\**\s*[::]\s*(?:because\s+)?(.+)$/i);
    if (!m) continue;

    const rank = parseInt(m[1], 10);
    const labelRaw = m[2].trim().toLowerCase().replace(/\s+/g, ' ');
    const reason = m[3].trim();
    const cls = LABEL_MAP[labelRaw] || 'NO_HIT';

    if (rank > currentRank) {
      currentRank = rank;
      results.push({
        rank,
        cls,
        reason: `${m[2].trim()}, because ${reason}`,
        labelDisplay: m[2].trim(),
      });
    }
  }

  return results;
}

/* ════════════════════════════════════════════════════════════════
   UI CONFIG
   ════════════════════════════════════════════════════════════════ */
const CLS_UI = {
  TRUE_HIT:        { color: 'red',     icon: AlertTriangle, leftBar: 'bg-red-500',     labelColor: 'text-red-700' },
  FALSE_HIT:       { color: 'amber',   icon: XCircle,       leftBar: 'bg-amber-500',   labelColor: 'text-amber-700' },
  IRRELEVANT_MLTF: { color: 'slate',   icon: Info,          leftBar: 'bg-slate-400',   labelColor: 'text-slate-600' },
  NO_HIT:          { color: 'emerald', icon: CheckCircle,   leftBar: 'bg-emerald-500', labelColor: 'text-emerald-700' },
};

/* ════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════ */
export default function ScreeningModuleV2({ entityName, mode = 'adverseMedia', onFlagSTR }) {
  const [target, setTarget] = useState(entityName || '');
  const [pdfFile, setPdfFile] = useState(null);
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('poe_api_key') || '');
  const [kyc, setKyc] = useState({ dob: '', nationality: '', gender: '', company: '' });
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [results, setResults] = useState([]);
  const [rawOutput, setRawOutput] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [strFlagged, setStrFlagged] = useState(new Set());

  const run = async () => {
    if (!pdfFile)    return setError('請上傳 PDF');
    if (!target)     return setError('請輸入實體名稱');
    if (!apiKey)     return setError('請輸入 Poe API Key');
    sessionStorage.setItem('poe_api_key', apiKey);

    setBusy(true); setError(''); setResults([]); setRawOutput('');

    try {
      // 1. Load PDF.js if needed
      setStage('正在載入 PDF 解析器...');
      if (!window.pdfjsLib) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
          s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; res(); };
          s.onerror = rej;
          document.head.appendChild(s);
        });
      }

      // 2. Extract PDF text
      setStage('正在讀取 PDF...');
      const arrayBuf = await pdfFile.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuf }).promise;
      let pdfText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pdfText += content.items.map(it => it.str).join(' ') + '\n';
      }
      if (!pdfText.trim()) throw new Error('PDF 無法提取文字(可能係 scanned image)');

      // 3. Call Poe API
      setStage('🤖 Gemini-3.5-Flash 分析中...');
      const raw = await classifyWithPoe({ targetName: target, kycContext: kyc, pdfText, mode, apiKey });
      setRawOutput(raw);

      // 4. Parse
      setStage('解析結果...');
      const parsed = parseListOutput(raw);
      if (parsed.length === 0) throw new Error('AI 回應格式無法解析。檢查 raw output。');
      setResults(parsed);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false); setStage('');
    }
  };

  const updateCls = (rank, newCls, note) => {
    setResults(prev => prev.map(r => r.rank !== rank ? r : {
      ...r, cls: newCls,
      reason: `${newCls === 'TRUE_HIT' ? 'True Hit' : newCls === 'FALSE_HIT' ? 'False Hit' : newCls === 'IRRELEVANT_MLTF' ? 'Irrelevant' : 'No Hit'}, because ${note}. (Original: ${r.labelDisplay})`,
      _override: true,
    }));
  };

  return (
    <div className="space-y-3">
      {/* Compact header */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white p-3 rounded-xl flex items-center gap-2">
        <Shield className="w-5 h-5" />
        <div className="flex-1">
          <div className="text-sm font-bold">v2 · Poe Chat Workflow Port</div>
          <div className="text-[11px] opacity-90">Single-pass · Gemini-3.5-Flash · ~250 lines vs legacy ~2000</div>
        </div>
      </div>

      {/* Inputs */}
      <div className="bg-white rounded-xl border p-3 space-y-2">
        <input value={target} onChange={e => setTarget(e.target.value)}
          placeholder="實體名稱 (e.g., ABC Holdings Ltd)" className="w-full border rounded px-3 py-2 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <input value={kyc.dob} onChange={e => setKyc({ ...kyc, dob: e.target.value })}
            type="date" className="border rounded px-2 py-1.5 text-xs" placeholder="DOB" />
          <input value={kyc.nationality} onChange={e => setKyc({ ...kyc, nationality: e.target.value })}
            placeholder="Nationality" className="border rounded px-2 py-1.5 text-xs" />
          <input value={kyc.gender} onChange={e => setKyc({ ...kyc, gender: e.target.value })}
            placeholder="Gender" className="border rounded px-2 py-1.5 text-xs" />
          <input value={kyc.company} onChange={e => setKyc({ ...kyc, company: e.target.value })}
            placeholder="Company / Title" className="border rounded px-2 py-1.5 text-xs" />
        </div>
        <input value={apiKey} onChange={e => setApiKey(e.target.value)}
          placeholder="Poe API Key" type="password" className="w-full border rounded px-3 py-1.5 text-xs font-mono" />
        <label className="block">
          <input type="file" accept="application/pdf"
            onChange={e => { setPdfFile(e.target.files[0]); setError(''); }}
            className="hidden" id="v2-pdf" />
          <div className={`border-2 border-dashed rounded-lg p-3 text-center text-xs cursor-pointer ${pdfFile ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-500 hover:border-blue-400'}`}
            onClick={() => document.getElementById('v2-pdf').click()}>
            {pdfFile ? `✅ ${pdfFile.name} (${(pdfFile.size / 1024).toFixed(0)} KB)` : '📄 點擊上傳 Google SERP PDF'}
          </div>
        </label>
        <button onClick={run} disabled={busy}
          className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white py-2.5 rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2">
          {busy ? <><Loader className="w-4 h-4 animate-spin" />{stage}</> : '🚀 開始分析'}
        </button>
        {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">⚠️ {error}</div>}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-1.5">
          {results.map(r => {
            const ui = CLS_UI[r.cls] || CLS_UI.NO_HIT;
            const open = expanded === r.rank;
            return (
              <div key={r.rank} className="relative bg-white border rounded-lg overflow-hidden">
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${ui.leftBar}`} />
                <div className="pl-4 pr-3 py-2.5 cursor-pointer flex items-start gap-2"
                  onClick={() => setExpanded(open ? null : r.rank)}>
                  <span className="text-sm font-bold text-slate-500 min-w-[24px]">{r.rank}.</span>
                  <div className="flex-1 text-[13px] leading-relaxed">
                    <span className={`font-bold ${ui.labelColor}`}>{r.labelDisplay}</span>
                    <span className="text-slate-400">: </span>
                    <span className="text-slate-800">{r.reason.replace(/^[^,]+,\s*because\s+/i, 'because ')}</span>
                    {r._override && <span className="ml-2 text-[10px] text-indigo-600 font-bold">✏️ Override</span>}
                  </div>
                  <ChevronRight className={`w-4 h-4 text-slate-300 transition-transform ${open ? 'rotate-90' : ''}`} />
                </div>
                {open && (
                  <div className="pl-4 pr-3 pb-2.5 border-t bg-slate-50/30 flex gap-1.5 flex-wrap pt-2">
                    {r.cls !== 'TRUE_HIT' && <button onClick={() => updateCls(r.rank, 'TRUE_HIT', 'manually upgraded')} className="text-[11px] px-2.5 py-1 rounded bg-red-500 text-white font-bold">↑ True Hit</button>}
                    {r.cls !== 'FALSE_HIT' && <button onClick={() => updateCls(r.rank, 'FALSE_HIT', 'manually downgraded')} className="text-[11px] px-2.5 py-1 rounded border border-slate-300 font-semibold">→ False Hit</button>}
                    {r.cls !== 'IRRELEVANT_MLTF' && <button onClick={() => updateCls(r.rank, 'IRRELEVANT_MLTF', 'manually re-classified')} className="text-[11px] px-2.5 py-1 rounded border border-slate-300 font-semibold">→ Irrelevant</button>}
                    {r.cls === 'TRUE_HIT' && onFlagSTR && (
                      <button onClick={() => { onFlagSTR({ source: 'v2', title: `Rank ${r.rank}`, riskCat: 'ML/TF', confidence: 0.9 }); setStrFlagged(new Set([...strFlagged, r.rank])); }}
                        className={`text-[11px] px-2.5 py-1 rounded font-bold ${strFlagged.has(r.rank) ? 'bg-red-700 text-white' : 'bg-red-500 text-white'}`}>
                        {strFlagged.has(r.rank) ? '✅ STR flagged' : '🚨 Flag STR'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {rawOutput && (
            <details className="bg-slate-50 rounded-lg border p-2">
              <summary className="text-xs font-bold text-slate-600 cursor-pointer">🔍 Raw AI Output (debug)</summary>
              <pre className="text-[11px] font-mono text-slate-700 mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap">{rawOutput}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

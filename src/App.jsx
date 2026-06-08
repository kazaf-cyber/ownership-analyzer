/**
 * KYC/AML Compliance Management System
 * 
 * 修正日誌 (2026-04-01~04-09): [原有]
 * 修正日誌 (2026-04-13):
 * ✅ 15. 新增行業風險因子 (Industry Risk Factor)
 * ✅ 16. 新增暗黑模式 (Dark Mode)
 * ✅ 17. 結構圖升級：Zoom/Pan + Bezier 曲線 + Hover Tooltip
 * ✅ 18. 新增地理風險熱力圖 (Dashboard)
 */
import React, { useState, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom';
import { PieChart, Pie, Cell, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer } from 'recharts';
import { Search, Brain, AlertTriangle, CheckCircle, XCircle, Info, ChevronDown, ChevronRight, Globe, ExternalLink, Loader, Shield } from 'lucide-react';

/* ========== DESIGN SYSTEM TOKENS ========== */
const DS = {
  // Buttons
  btnPrimary: 'bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white shadow-md shadow-blue-500/20 hover:shadow-lg hover:shadow-blue-500/30 font-semibold transition-all',
  btnSecondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 font-semibold shadow-sm transition-all',
  btnDanger: 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-md shadow-red-500/20 font-semibold transition-all',
  btnSuccess: 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-md shadow-emerald-500/20 font-semibold transition-all',
  btnWarning: 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-md shadow-amber-500/20 font-semibold transition-all',
  btnGhost: 'bg-transparent hover:bg-slate-100 text-slate-600 hover:text-slate-900 font-semibold transition-all',
  btnIndigo: 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-md shadow-indigo-500/20 font-semibold transition-all',

  // Cards
  card: 'bg-white border border-slate-200 rounded-2xl shadow-[0_2px_8px_rgba(15,23,42,0.04)]',
  cardHover: 'bg-white border border-slate-200 rounded-2xl shadow-[0_2px_8px_rgba(15,23,42,0.04)] hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)] transition-all',

  // Inputs
  input: 'w-full text-sm rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-colors',
  
  // Section title
  sectionTitle: 'text-base font-bold tracking-tight text-slate-900',
  sectionDesc: 'text-xs text-slate-500 mt-0.5',
};

/* ========== END DESIGN TOKENS ========== */

/* ========== UBO DETECTION MODULE ========== */

const UBO_DEFAULTS = Object.freeze({
  OWNERSHIP_THRESHOLD: 25,
  CONTROL_THRESHOLD: 25,
  MAX_ITERATIONS: 100000,
  MAX_DEPTH: 30,
});

const UBO_OWNERSHIP = 'ownership';
const UBO_CONTROL = 'control';

function computeRelPercentage(rel, entityMap) {
  if (rel.shares != null && rel.shares > 0) {
    const target = entityMap.get(rel.targetId);
    if (target && target.totalShares > 0) {
      return Math.round((rel.shares / target.totalShares) * 10000) / 100;
    }
  }
  return rel.percentage != null ? rel.percentage : null;
}

function buildGraphIndex(entities, relationships) {
  const entityMap = new Map();
  const inboundRels = new Map();
  const outboundRels = new Map();
  for (const e of entities) entityMap.set(e.id, e);
  for (const r of relationships) {
    if (!inboundRels.has(r.targetId)) inboundRels.set(r.targetId, []);
    if (!outboundRels.has(r.sourceId)) outboundRels.set(r.sourceId, []);
    inboundRels.get(r.targetId).push(r);
    outboundRels.get(r.sourceId).push(r);
  }
  return { entityMap, inboundRels, outboundRels };
}

function findUBOsCore(targetId, graphIndex, options = {}) {
  const {
    ownershipThreshold = UBO_DEFAULTS.OWNERSHIP_THRESHOLD,
    controlThreshold = UBO_DEFAULTS.CONTROL_THRESHOLD,
    maxIterations = UBO_DEFAULTS.MAX_ITERATIONS,
    maxDepth = UBO_DEFAULTS.MAX_DEPTH,
    includeBelowThreshold = false,
  } = options;

  const { entityMap, inboundRels } = graphIndex;
  if (!entityMap.has(targetId)) return [];

  const ownershipThresholdBps = Math.round(ownershipThreshold * 100);
  const controlThresholdBps = Math.round(controlThreshold * 100);
  const aggregated = new Map();
  const queue = [{
    nodeId: targetId,
    multiplierBps: 10000,
    chain: [],
    depth: 0,
    visitedEdges: new Set(),
    inheritedControlBps: null,
  }];

  let iterCount = 0;
  let truncated = false;

  while (queue.length > 0) {
    if (++iterCount > maxIterations) { truncated = true; break; }
    const { nodeId, multiplierBps, chain, depth, visitedEdges, inheritedControlBps } = queue.shift();
    if (depth >= maxDepth) continue;
    const inbound = inboundRels.get(nodeId);
    if (!inbound) continue;

    for (const rel of inbound) {
      if (rel.type !== UBO_OWNERSHIP && rel.type !== UBO_CONTROL) continue;
      const edgeKey = `${rel.sourceId}|${rel.targetId}|${rel.type}`;
      if (visitedEdges.has(edgeKey)) continue;
      const owner = entityMap.get(rel.sourceId);
      if (!owner) continue;

      let edgePctBps, isControlEdge;
      if (rel.type === UBO_OWNERSHIP) {
        const pct = computeRelPercentage(rel, entityMap);
        if (pct == null || pct <= 0) continue;
        edgePctBps = Math.round(pct * 100);
        isControlEdge = false;
      } else {
        const ctrlPct = (rel.percentage != null && rel.percentage > 0) ? rel.percentage : 100;
        edgePctBps = Math.round(ctrlPct * 100);
        isControlEdge = true;
      }

      const flowBps = Math.round((multiplierBps * edgePctBps) / 10000);
      const pathControlBps = isControlEdge
        ? (inheritedControlBps == null ? edgePctBps : Math.min(inheritedControlBps, edgePctBps))
        : inheritedControlBps;

      const newChain = [owner.name, ...chain];
      const newVisited = new Set(visitedEdges);
      newVisited.add(edgeKey);

      if (owner.type === 'person') {
        if (!aggregated.has(owner.id)) {
          aggregated.set(owner.id, { entity: owner, ownershipBps: 0, maxControlBps: 0, paths: [] });
        }
        const rec = aggregated.get(owner.id);
        const isViaControl = pathControlBps != null;
        if (isViaControl) {
          rec.maxControlBps = Math.max(rec.maxControlBps, pathControlBps);
        } else {
          rec.ownershipBps += flowBps;
        }
        rec.paths.push({
          percentage: flowBps / 100,
          controlPct: pathControlBps != null ? pathControlBps / 100 : null,
          chain: newChain,
          direct: chain.length === 0,
          viaControl: isViaControl,
          edgeType: rel.type,
        });
      } else {
        queue.push({
          nodeId: owner.id,
          multiplierBps: flowBps,
          chain: newChain,
          depth: depth + 1,
          visitedEdges: newVisited,
          inheritedControlBps: pathControlBps,
        });
      }
    }
  }

  const results = [];
  for (const rec of aggregated.values()) {
    const passesOwnership = rec.ownershipBps >= ownershipThresholdBps;
    const passesControl = rec.maxControlBps >= controlThresholdBps;
    if (!includeBelowThreshold && !passesOwnership && !passesControl) continue;

    const hasDirect = rec.paths.some(p => p.direct);
    const hasIndirect = rec.paths.some(p => !p.direct);
    const hasControl = rec.paths.some(p => p.viaControl);
    const sortedPaths = rec.paths.slice().sort((a, b) => b.percentage - a.percentage);

    results.push({
      entity: rec.entity,
      percentage: Math.round(rec.ownershipBps) / 100,
      controlPercentage: rec.maxControlBps / 100,
      direct: hasDirect && !hasIndirect,
      mixed: hasDirect && hasIndirect,
      viaControl: hasControl,
      paths: sortedPaths,
      path: sortedPaths[0] ? sortedPaths[0].chain : [],
      qualifiedBy: passesOwnership && passesControl ? 'both' : passesOwnership ? 'ownership' : 'control',
      exceedsHundred: rec.ownershipBps > 10000,
    });
  }

  results.sort((a, b) => {
    if (b.percentage !== a.percentage) return b.percentage - a.percentage;
    return b.controlPercentage - a.controlPercentage;
  });

  if (truncated && typeof console !== 'undefined') {
    console.warn(`[findUBOs] Iteration cap reached on target=${targetId}; results may be incomplete.`);
  }
  return results;
}

function wouldCreateCycleCore(sourceId, targetId, graphIndex, excludeRelId = null) {
  if (sourceId === targetId) return true;
  const { outboundRels } = graphIndex;
  const visited = new Set();
  const queue = [targetId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === sourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const outs = outboundRels.get(current) || [];
    for (const r of outs) {
      if (r.id === excludeRelId) continue;
      if (r.type !== UBO_OWNERSHIP && r.type !== UBO_CONTROL) continue;
      queue.push(r.targetId);
    }
  }
  return false;
}

/* React Hook 包裝 */
function useUBO(entities, relationships) {
  const graphIndex = useMemo(
    () => buildGraphIndex(entities, relationships),
    [entities, relationships]
  );

  const findUBOs = useCallback((targetId, thresholdOrOptions, controlThreshold) => {
    const options = typeof thresholdOrOptions === 'number'
      ? { ownershipThreshold: thresholdOrOptions, controlThreshold: controlThreshold ?? thresholdOrOptions }
      : (thresholdOrOptions || {});
    return findUBOsCore(targetId, graphIndex, options);
  }, [graphIndex]);

  const wouldCreateCycle = useCallback(
    (sourceId, targetId, excludeRelId = null) =>
      wouldCreateCycleCore(sourceId, targetId, graphIndex, excludeRelId),
    [graphIndex]
  );

  const getRelPercentage = useCallback(
    (rel) => computeRelPercentage(rel, graphIndex.entityMap),
    [graphIndex]
  );

  return { findUBOs, wouldCreateCycle, getRelPercentage, graphIndex };
}

/* ========== END UBO MODULE ========== */



/* ========== STABLE SUB-COMPONENTS ========== */
function ModalShell({ title, onClose, children, wide, dark }) {
  return (
    <div 
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto" 
      style={{ animation: 'kycFadeIn 0.15s ease-out' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className={`${dark ? 'bg-slate-900 text-slate-100 border-slate-800' : 'bg-white border-slate-200'} 
          rounded-2xl shadow-[0_20px_60px_-15px_rgba(15,23,42,0.4)] border 
          ${wide ? 'max-w-4xl' : 'max-w-2xl'} w-full mt-8 mb-8 overflow-hidden`}
        style={{ animation: 'kycSlideUp 0.2s ease-out' }}
      >
        <div className={`flex items-center justify-between px-6 py-4 border-b ${dark ? 'border-slate-800' : 'border-slate-100'}`}>
          <h3 className={`text-base font-bold tracking-tight ${dark ? 'text-slate-100' : 'text-slate-900'}`}>
            {title}
          </h3>
          <button 
            onClick={onClose} 
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${
              dark 
                ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-200' 
                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
            }`}
          >
            ✕
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
function BadgeC({ color, children, dot = false, size = 'sm' }) {
  const colorMap = {
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    gray: 'bg-slate-50 text-slate-600 border-slate-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    teal: 'bg-teal-50 text-teal-700 border-teal-200',
    cyan: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  };
  const dotColor = {
    red: 'bg-red-500', amber: 'bg-amber-500', green: 'bg-emerald-500',
    blue: 'bg-blue-500', gray: 'bg-slate-400', purple: 'bg-purple-500',
    indigo: 'bg-indigo-500', teal: 'bg-teal-500', cyan: 'bg-cyan-500',
  };
  const sizeClass = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]';
  return (
    <span className={`inline-flex items-center gap-1 rounded-md font-semibold border ${sizeClass} ${colorMap[color] || colorMap.gray}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColor[color] || dotColor.gray}`} />}
      {children}
    </span>
  );
}
function RiskBadge({ rating, label }) { 
  return <BadgeC dot color={rating === 'High' ? 'red' : rating === 'Medium' ? 'amber' : 'green'}>{label || rating}</BadgeC>; 
}

function PriorityDot({ p }) { 
  const colors = {
    critical: 'bg-red-500 ring-red-200 animate-pulse',
    high: 'bg-orange-500 ring-orange-200',
    medium: 'bg-amber-500 ring-amber-200',
    low: 'bg-emerald-500 ring-emerald-200',
  };
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ring-2 ${colors[p] || colors.low}`} />; 
}
function FormField({ label, children, required, hint }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-slate-600 block mb-1.5 tracking-wide uppercase">
        {label}
        {required && <span className="text-red-500 ml-0.5 normal-case">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

/* ========== CONSTANTS ========== */
const gid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
};
const getToday = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const today = getToday();
const RISK_COLORS = { High: '#ef4444', Medium: '#f59e0b', Low: '#22c55e' };
const PIE_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
const DEFAULT_HIGH_RISK = ['Iran', 'North Korea', 'Myanmar', 'Syria', 'Afghanistan', 'Libya', 'Somalia', 'South Sudan', 'Yemen', 'Iraq'];
const DEFAULT_OFFSHORE = ['BVI', 'Cayman Islands', 'Panama', 'Bermuda', 'Jersey', 'Guernsey', 'Isle of Man', 'Liechtenstein', 'Vanuatu', 'Seychelles'];
const DEFAULT_MONITORED = ['Russia', 'Turkey', 'UAE', 'Pakistan', 'Cambodia', 'Nigeria', 'Albania', 'Philippines', 'Barbados', 'Senegal'];

/* ★ NEW: Industry Risk Factor */
const HIGH_RISK_INDUSTRIES = ['Gambling / Gaming','Cryptocurrency / Virtual Assets','Arms / Defence','Precious Metals & Stones','Cash-intensive Business','Money Services Business','Adult Entertainment','Cannabis','Art & Antiquities','Non-Profit / Charity','Correspondent Banking'];
const MEDIUM_RISK_INDUSTRIES = ['Construction','Import / Export','Logistics / Shipping','Mining','Pharmaceuticals','Tobacco','Real Estate'];
const ALL_INDUSTRIES = [...new Set([...HIGH_RISK_INDUSTRIES,...MEDIUM_RISK_INDUSTRIES,'Technology','Manufacturing','Retail','Healthcare','Education','Financial Services (Regulated)','Professional Services','Agriculture','Hospitality','Telecommunications','Other'])].sort();
const INDUSTRY_LABELS_ZH = {
  'Gambling / Gaming': '博彩 / 遊戲',
  'Cryptocurrency / Virtual Assets': '加密貨幣 / 虛擬資產',
  'Arms / Defence': '軍火 / 國防',
  'Precious Metals & Stones': '貴金屬與寶石',
  'Cash-intensive Business': '現金密集型業務',
  'Money Services Business': '貨幣服務業務',
  'Adult Entertainment': '成人娛樂',
  'Cannabis': '大麻產業',
  'Art & Antiquities': '藝術品與古董',
  'Non-Profit / Charity': '非營利 / 慈善機構',
  'Correspondent Banking': '代理銀行業務',
  'Construction': '建築業',
  'Import / Export': '進出口貿易',
  'Logistics / Shipping': '物流 / 航運',
  'Mining': '採礦業',
  'Pharmaceuticals': '製藥業',
  'Tobacco': '菸草業',
  'Real Estate': '房地產',
  'Technology': '科技業',
  'Manufacturing': '製造業',
  'Retail': '零售業',
  'Healthcare': '醫療保健',
  'Education': '教育業',
  'Financial Services (Regulated)': '金融服務（受監管）',
  'Professional Services': '專業服務',
  'Agriculture': '農業',
  'Hospitality': '餐旅業',
  'Telecommunications': '電信業',
  'Other': '其他',
};
const ALL_COUNTRIES = [...new Set([...DEFAULT_HIGH_RISK, ...DEFAULT_OFFSHORE, ...DEFAULT_MONITORED, 'USA', 'UK', 'Germany', 'France', 'Japan', 'Australia', 'Canada', 'Singapore', 'Hong Kong', 'Taiwan', 'Switzerland', 'Netherlands', 'Ireland', 'Luxembourg', 'China', 'India', 'Brazil', 'South Korea', 'New Zealand', 'Sweden', 'Norway'])].sort();
const DOC_COMPANY = ['Certificate of Incorporation', 'Register of Directors', 'Register of Shareholders', 'Memorandum & Articles', 'Financial Statements', 'Proof of Address', 'Sanctions Screening Report', 'Source of Funds Declaration', 'Tax Residency Certificate'];
const DOC_PERSON = ['Passport / ID', 'Proof of Address', 'Source of Wealth Declaration', 'CV / Profile', 'Sanctions Screening Report', 'PEP Screening Report', 'Bank Reference Letter'];
const DEFAULT_WEIGHTS = { jurisdiction: 20, pep: 20, sanctions: 20, negativeNews: 10, entityType: 10, ownership: 10, industry: 10 };
const WK = { jurisdiction: 'weightJurisdiction', pep: 'weightPep', sanctions: 'weightSanctions', negativeNews: 'weightNegativeNews', entityType: 'weightEntityType', ownership: 'weightOwnership', industry: 'weightIndustry' };

const AUTO_HIGH_RISK_SUBTYPES = ['Trust', 'Nominee', 'Nominee Shareholder'];
const SDD_ELIGIBLE_CATEGORIES = ['listed', 'government', 'stateOwned'];

const SAMPLE_ENTITIES = [
  { id: 'e1', name: 'Alpha Holdings Ltd', type: 'company', subType: 'Holding Company', companyCategory: 'private', jurisdiction: 'BVI', totalShares: 10000, industry: 'Financial Services (Regulated)', isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: '2025-01-15', score: 68, rating: 'Medium' }, { date: '2025-06-10', score: 72, rating: 'High' }, { date: '2025-12-01', score: 75, rating: 'High' }], lastReviewDate: '2025-12-01', nextReviewDate: '2026-06-01', documents: [{ id: 'd1', name: 'Certificate of Incorporation', status: 'received', expiry: null }, { id: 'd2', name: 'Register of Directors', status: 'received', expiry: null }, { id: 'd3', name: 'Register of Shareholders', status: 'pending', expiry: null }, { id: 'd4', name: 'Financial Statements', status: 'expired', expiry: '2025-12-31' }], screeningLogs: [{ id: 's1', date: '2025-12-01', system: 'External Database', type: 'Sanctions', result: 'Clear' }, { id: 's2', date: '2025-12-01', system: 'External Database', type: 'PEP', result: 'Clear' }], str: null, notes: [{ id: 'n1', text: 'Initial onboarding completed.', date: '2025-01-15', author: 'Analyst A' }, { id: 'n2', text: 'Annual review: risk elevated due to BVI.', date: '2025-12-01', author: 'CO' }], cddRecords: [] },
  { id: 'e2', name: 'Beta Trading Co', type: 'company', subType: 'Trading Company', companyCategory: 'listed', jurisdiction: 'Hong Kong', totalShares: 1000, industry: 'Import / Export', isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: '2025-03-10', score: 35, rating: 'Low' }, { date: '2025-09-15', score: 42, rating: 'Medium' }], lastReviewDate: '2025-09-15', nextReviewDate: '2026-03-15', documents: [{ id: 'd5', name: 'Certificate of Incorporation', status: 'received', expiry: null }], screeningLogs: [{ id: 's3', date: '2025-09-15', system: 'External Database', type: 'Sanctions', result: 'Clear' }], str: null, notes: [], cddRecords: [] },
  { id: 'e3', name: 'Gamma Trust', type: 'company', subType: 'Trust', companyCategory: 'private', jurisdiction: 'Cayman Islands', totalShares: null, industry: 'Non-Profit / Charity', isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: true, riskOverride: null, riskHistory: [{ date: '2025-02-20', score: 78, rating: 'High' }], lastReviewDate: '2025-02-20', nextReviewDate: '2025-08-20', documents: [{ id: 'd7', name: 'Trust Deed', status: 'received', expiry: null }, { id: 'd8', name: 'Register of Beneficiaries', status: 'pending', expiry: null }], screeningLogs: [{ id: 's4', date: '2025-02-20', system: 'External Database', type: 'Negative News', result: 'Hit - tax evasion' }], str: { flagged: true, submittedDate: '2025-03-01', mlroApproved: true, mlroDate: '2025-03-05' }, notes: [{ id: 'n4', text: 'Negative media flagged.', date: '2025-02-20', author: 'Analyst A' }], cddRecords: [] },
  { id: 'e4', name: 'John Smith', type: 'person', subType: 'Director', companyCategory: null, jurisdiction: 'UK', totalShares: null, industry: '', isPEP: true, pepCategory: 'domestic', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: '2025-01-15', score: 62, rating: 'Medium' }, { date: '2025-07-01', score: 65, rating: 'Medium' }], lastReviewDate: '2025-07-01', nextReviewDate: '2026-01-01', documents: [{ id: 'd9', name: 'Passport / ID', status: 'received', expiry: '2027-05-15' }], screeningLogs: [{ id: 's5', date: '2025-07-01', system: 'External Database', type: 'PEP', result: 'Hit - Former MP' }], str: null, notes: [{ id: 'n5', text: 'PEP: former MP.', date: '2025-01-15', author: 'Analyst A' }], cddRecords: [] },
  { id: 'e5', name: 'Jane Doe', type: 'person', subType: 'Shareholder', companyCategory: null, jurisdiction: 'USA', totalShares: null, industry: '', isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: '2025-01-15', score: 18, rating: 'Low' }], lastReviewDate: '2025-01-15', nextReviewDate: '2026-01-15', documents: [{ id: 'd11', name: 'Passport / ID', status: 'received', expiry: '2028-11-20' }], screeningLogs: [{ id: 's6', date: '2025-01-15', system: 'External Database', type: 'Sanctions', result: 'Clear' }], str: null, notes: [], cddRecords: [] },
  { id: 'e6', name: 'Delta Corp', type: 'company', subType: 'Operating Company', companyCategory: 'stateOwned', jurisdiction: 'Singapore', totalShares: 5000, industry: 'Technology', isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: '2025-04-01', score: 22, rating: 'Low' }], lastReviewDate: '2025-04-01', nextReviewDate: '2026-04-01', documents: [], screeningLogs: [], str: null, notes: [], cddRecords: [] },
  { id: 'e7', name: 'Epsilon Foundation', type: 'company', subType: 'Foundation', companyCategory: 'private', jurisdiction: 'Panama', totalShares: null, industry: 'Art & Antiquities', isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: '2025-05-15', score: 71, rating: 'High' }], lastReviewDate: '2025-05-15', nextReviewDate: '2025-11-15', documents: [], screeningLogs: [], str: null, notes: [], cddRecords: [] },
  { id: 'e8', name: 'David Chen', type: 'person', subType: 'Beneficiary', companyCategory: null, jurisdiction: 'China', totalShares: null, industry: '', isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: '2025-06-01', score: 45, rating: 'Medium' }], lastReviewDate: '2025-06-01', nextReviewDate: '2025-12-01', documents: [{ id: 'd15', name: 'Passport / ID', status: 'received', expiry: '2026-02-01' }], screeningLogs: [], str: null, notes: [], cddRecords: [] },
];
const SAMPLE_RELS = [
  { id: 'r1', sourceId: 'e4', targetId: 'e1', type: 'ownership', shares: 4000, percentage: null, description: 'Direct shareholding' },
  { id: 'r2', sourceId: 'e5', targetId: 'e1', type: 'ownership', shares: 3000, percentage: null, description: 'Direct shareholding' },
  { id: 'r3', sourceId: 'e7', targetId: 'e1', type: 'ownership', shares: 3000, percentage: null, description: 'Through foundation' },
  { id: 'r4', sourceId: 'e1', targetId: 'e2', type: 'ownership', shares: 1000, percentage: null, description: 'Wholly owned subsidiary' },
  { id: 'r5', sourceId: 'e1', targetId: 'e3', type: 'control', shares: null, percentage: 60, description: 'Trustee appointment' },
  { id: 'r6', sourceId: 'e3', targetId: 'e6', type: 'ownership', shares: 3000, percentage: null, description: 'Trust holding' },
  { id: 'r7', sourceId: 'e8', targetId: 'e6', type: 'ownership', shares: 1250, percentage: null, description: 'Direct shareholding' },
  { id: 'r8', sourceId: 'e4', targetId: 'e8', type: 'rca', shares: null, percentage: null, description: 'Business associate' },
];

const i18n = {
  en: {
    appTitle: 'KYC/AML', appSub: 'Compliance System', dashboard: 'Dashboard', workspace: 'Entities & Structure', search: 'Search', snapshots: 'Snapshots', settings: 'Settings', report: 'Report',
    entityList: 'Entity List', structureDiagram: 'Structure Diagram', totalEntities: 'Total Entities', highRisk: 'High Risk', overdueReviews: 'Overdue Reviews', expiredDocs: 'Expired Docs', strFlagged: 'STR Flagged', activeTodos: 'Active Todos',
    companies: 'companies', persons: 'persons', entitiesRatedHigh: 'Entities rated High', pastNextReview: 'Past next review date',
    riskDistribution: 'Risk Distribution', entityTypes: 'Entity Types', avgRiskScoreTrend: 'Avg Risk Score Trend', autoTodos: 'Auto-Generated Todos',
    noPendingTodos: '✅ No pending todos', urgentItems: 'urgent items',
    addEntity: '+ Add Entity', selected: 'selected', clear: 'Clear', clearSelection: 'Clear Selection',
    name: 'Name', type: 'Type', jurisdiction: 'Jurisdiction', risk: 'Risk', flags: 'Flags', docs: 'Docs', actions: 'Actions', delete: 'Delete',
    overview: 'Overview', documents: 'Documents', screening: 'Screening', str: 'STR', notes: 'Notes', riskTab: 'Risk',
    lastReview: 'Last Review', nextReview: 'Next Review', pep: 'PEP', sanctioned: 'Sanctioned', negativeNews: 'Negative News',
    crrScore: 'CRR Score', overridden: 'Overridden', uboDetection: 'UBO Detection', relationships: 'Relationships',
    completion: 'Completion', addDocument: '+ Add Document', expiry: 'Expiry',
    pending: 'Pending', received: 'Received', expired: 'Expired', notApplicable: 'N/A', noDocsYet: 'No documents yet.',
    screeningHistory: 'Screening History', addRecord: '+ Add Record', noScreeningRecords: 'No screening records.',
    suspiciousTransactionReport: 'Suspicious Transaction Report', flagForSTR: 'Flag for STR', submissionDate: 'Submission Date',
    mlroApproved: 'MLRO Approved', approvedOn: 'Approved on', awaitingMLRO: '⏳ Awaiting MLRO', strNotSubmitted: '❗ STR not yet submitted',
    notesTimeline: 'Notes Timeline', addNote: '+ Add Note', noNotesYet: 'No notes yet.',
    riskManagement: 'Risk Management', overrideRating: 'Override Rating', clearOverride: 'Clear Override',
    overrideActive: 'Override Active', reason: 'Reason', by: 'By', on: 'on',
    riskScoreTrend: 'Risk Score Trend', insufficientHistory: 'Insufficient history.', auditTrail: 'Audit Trail', score: 'Score', override: 'Override',
    lowRisk: 'Low Risk', mediumRisk: 'Medium Risk', ownership: 'Ownership', control: 'Control', rca: 'RCA',
    globalSearch: 'Global Search', searchPlaceholder: 'Search entities, notes, todos…', noResults: 'No results.', todos: 'Todos',
    snapshotDesc: 'Snapshot description…', saveSnapshot: '📸 Save', savesCurrentState: 'Saves current state', entitiesLabel: 'entities', relationshipsLabel: 'relationships',
    restore: 'Restore', compareSnapshots: 'Compare Snapshots', selectA: 'Select A', selectB: 'Select B',
    added: '+ Added', removed: '- Removed', changed: '~ Changed', noDifferences: 'No differences.', noSnapshotsYet: 'No snapshots yet.',
    riskWeights: '⚖️ Risk Weights', countryLists: '🌍 Country Lists', uboThreshold: '📐 UBO Threshold',
    adjustWeights: 'Adjust CRR risk factor weights.', resetDefaults: 'Reset defaults',
    highRiskCountries: '🔴 High Risk (FATF)', offshoreJurisdictions: '🟠 Offshore', monitoredCountries: '🟡 Monitored', addCountry: '+ Add country…',
    configureUBO: 'Configure UBO threshold.', commonValues: 'Common: EU 25%, Taiwan 25%, Cayman 10%, US 25%',
    previewUBO: 'Preview: UBOs at', complianceReport: 'Compliance Report', printHint: 'Ctrl+P / Cmd+P to print',
    reportTitle: 'KYC/AML Compliance Report', generated: 'Generated',
    executiveSummary: '1. Executive Summary', entityRiskAssessment: '2. Entity Risk Assessment', outstandingActions: '3. Outstanding Actions', uboSummary: '4. UBO Summary',
    entity: 'Entity', rating: 'Rating', crr: 'CRR',
    addEntityTitle: 'Add Entity', entityName: 'Entity name', subType: 'Sub Type', selectType: 'Select…',
    addRelTitle: 'Add Relationship', editRelTitle: 'Edit Relationship', sourceOwner: 'Source (Owner)', targetOwned: 'Target (Owned)', percentage: 'Percentage', description: 'Description',
    overrideTitle: 'Risk Override', overrideWarning: '⚠️ Override will be logged.',
    newRating: 'New Rating', reasonRequired: 'Reason (required)', overrideJustification: 'Justification…', applyOverride: 'Apply',
    addDocTitle: 'Add Document', docName: 'Document Name', selectOrType: 'Select…', expiryDate: 'Expiry Date',
    addScreenTitle: 'Add Screening', system: 'System', screenType: 'Type', result: 'Result', resultPlaceholder: 'Clear / Hit…',
    addNoteTitle: 'Add Note', author: 'Author', yourName: 'Your name', note: 'Note', enterNote: 'Enter note…',
    batchActionTitle: 'Batch Action', updateReviewDate: 'Update Review Date', applyTo: 'Apply to', selectedEntities: 'selected entities.', newReviewDate: 'New Review Date', apply: 'Apply',
    company: 'Company', person: 'Person',
    ownershipType: 'Ownership', controlType: 'Control', rcaType: 'RCA', associationType: 'Association',
    via: 'via', High: 'High', Medium: 'Medium', Low: 'Low', filterPlaceholder: 'Filter…',
    totalSharesLabel: 'Total Shares Issued', sharesLabel: 'Shares', inputByPercentage: 'By %', inputByShares: 'By Shares',
    autoCalcPercentage: 'Auto %', noTotalSharesWarning: 'Target has no total shares set.',
    shareholdingSummary: 'Shareholding Summary', unaccountedShares: 'Unaccounted', shareholder: 'Shareholder', totalLabel: 'Total',
    sharesUnit: 'sh', orText: 'or',
    weightJurisdiction: 'Jurisdiction', weightPep: 'PEP', weightSanctions: 'Sanctions', weightNegativeNews: 'Neg. News', weightEntityType: 'Entity Type', weightOwnership: 'Ownership',
    editEntity: '✏️ Edit', deleteSelected: '🗑️ Delete Selected', batchEdit: '✏️ Batch Edit', editEntityTitle: 'Edit Entity',
    saveChanges: 'Save Changes', confirmDeleteTitle: 'Confirm Delete', confirmDeleteMsg: 'Are you sure you want to delete the following entities? This will also remove all related relationships.',
    confirmDelete: 'Delete', cancel: 'Cancel', batchReview: '📅 Review',
    emptyStateTitle: 'No Entities Yet', emptyStateDesc: 'Start by adding your first entity, or load sample data to explore the system.',
    loadSample: '📦 Load Sample Data', loadSampleDesc: 'Load 8 sample entities with relationships for demo purposes.',
    clearAll: '🗑️ Clear All Data', clearAllConfirm: 'Clear all entities and relationships? This cannot be undone.',
    sampleLoaded: 'Sample data loaded successfully.',
    uboTab: 'UBO', adverseMediaTab: 'Adverse Media', sanctionScreeningTab: 'Sanction Search', noUBOs: 'No UBOs detected at current threshold.', uboChain: 'Chain', directOwnership: 'Direct Ownership', indirectOwnership: 'Indirect Ownership', mixedOwnership: 'Direct + Indirect',
    uboAnalysis: 'UBO Analysis', threshold: 'Threshold', detectedUBOs: 'Detected UBOs', selectAll: 'Select All',
    cddTab: 'CDD Records', saveCDD: '📋 Save CDD Record', cddHistory: 'CDD History',
    cddType: 'CDD Type', cddInitial: 'Initial', cddPeriodic: 'Periodic', cddEvent: 'Event-triggered',
    cddStatus: 'Status', cddInProgress: 'In Progress', cddCompleted: 'Completed', cddPendingApproval: 'Pending Approval',
    cddSummary: 'Summary / Findings', cddReviewer: 'Reviewer',
    cddRestore: '↻ Restore', cddViewDetails: 'View / Compare', cddHideDetails: 'Hide Details',
    noCDDRecords: 'No CDD records yet. Complete a CDD review and save the record.',
    cddSaveTitle: 'Save CDD Record', cddSaveDesc: 'Capture current entity state as a CDD record.',
    cddSaveSuccess: 'CDD record saved successfully.', cddRestoreSuccess: 'CDD record restored successfully.',
    cddRestoreConfirm: 'Restore this CDD record? Current entity state will be overwritten.',
    cddCurrentState: 'Current', cddSavedState: 'Saved', cddField: 'Field', cddChanged: 'Δ',
    cddRiskScore: 'Risk Score', cddRiskRating: 'Risk Rating', cddDocReceived: 'Docs Received', cddDocTotal: 'Docs Total',
    cddScreenings: 'Screenings', cddNotes: 'Notes', cddPEP: 'PEP', cddSanctioned: 'Sanctioned', cddNegNews: 'Neg. News', cddSTR: 'STR Flagged',
    cddLastReview: 'Last Review', cddNextReview: 'Next Review', cddNo: 'No', cddYes: 'Yes',
    cddSavedDocs: 'Saved Documents', cddSavedScreenings: 'Saved Screenings', cddSavedNotes: 'Saved Notes',
    cddTip: '💡 Save a CDD record after each review cycle.',
    cddCompareTitle: 'Comparison: Saved vs Current', cddRecordCount: 'CDD records',
    deleteSnapshot: '🗑️ Delete', confirmDeleteSnapshotTitle: 'Delete Snapshot', confirmDeleteSnapshotMsg: 'Are you sure?',
    snapshotDeleted: 'Snapshot deleted.', deleteAllSnapshots: 'Delete All', confirmDeleteAllSnapshotsMsg: 'Delete all snapshots?',
    companyCategory: 'Company Category', catPrivate: 'Private Limited', catListed: 'Listed Company', catGovernment: 'Government Agency', catStateOwned: 'State-Owned Enterprise',
    sddEligible: '💡 SDD Eligible: This entity is a {type}, simplified due diligence (SDD) may apply.',
    autoHighRiskNotice: '⚠️ Auto High Risk: {subType} entities are automatically classified as High Risk with mandatory annual review.',
    editRel: '✏️', personCannotBeOwned: '⚠️ A person cannot be the target of an ownership relationship.',
    annualReview: 'Annual Review Required', saveRel: 'Save Relationship',
    duplicateRelWarning: '⚠️ A relationship already exists between these two entities with the same type.',
    circularRelWarning: '⚠️ This would create a circular ownership chain.',
    selfRelWarning: '⚠️ Source and target cannot be the same entity.',
    sharesExceedWarning: '⚠️ Total allocated shares ({allocated}) would exceed total issued shares ({total}).',
    reviewCycleDays: 'Review Cycle (days)', eddRequired: '🔴 EDD Required: High-risk entity requires Enhanced Due Diligence.',
    docExpiringSoon: '⚠️ Document expiring within 30 days', exportCSV: '📥 Export CSV',
    lastUpdated: 'Last Updated', entityStatus: 'Status', pendingDocsCount: 'Pending Docs', relCount: 'Relationships',
    noRelWarning: '⚠️ This entity has no relationships.', percentageExceeds100: '⚠️ Total ownership of target exceeds 100%.',
    requiredField: 'This field is required.', dueDiligenceLevel: 'Due Diligence Level',
    sdd: 'SDD', cdd: 'CDD', edd: 'EDD', sddDesc: 'Simplified', cddDesc: 'Standard', eddDesc: 'Enhanced',
    reviewCycleHigh: 'High Risk: Review every 12 months', reviewCycleMedium: 'Medium Risk: Review every 24 months', reviewCycleLow: 'Low Risk: Review every 36 months',
    autoReviewReminder: 'Auto-calculated next review based on risk rating',
    pepCategory: 'PEP Category', selectPepCategory: 'Select PEP Category',
    pepForeign: 'Foreign PEP', pepDomestic: 'Domestic PEP', pepInternational: 'International Org. PEP',
    pepFamilyMember: 'PEP Family Member', pepCloseAssociate: 'PEP Close Associate',
    pepAutoHighRisk: 'Auto elevated to High Risk (PEP)',
    weightIndustry: 'Industry', industryLabel: 'Industry / Sector', selectIndustry: 'Select industry…',
    highRiskIndustry: '⚠️ High-Risk Industry', autoEDDIndustry: '🔴 Auto EDD: High-risk industry requires Enhanced Due Diligence.',
    darkMode: 'Dark Mode', lightMode: 'Light Mode', geoRiskMap: 'Geographic Risk Heatmap', geoNoData: 'No entity data to display.',
    zoomIn: 'Zoom In', zoomOut: 'Zoom Out', resetView: 'Reset View',
    adverseSubtitle: 'Auto Language Detection | Manual Google Search → PDF Upload → Full-Page Scraping → AI Classification',
    sanctionSubtitle: 'Auto Language Detection | Manual Google Search → PDF Upload → Full-Page Scraping → AI Sanctions Classification',
    tabStart: 'Start',
    tabArchitecture: 'Architecture',
    tabKeywords: 'Keyword Config',
    webScrapingSettings: 'Full-Page Scraping Settings',
    optional: 'Optional',
    stepGoogle: 'Google Search',
    autoDetectLang: 'Auto Detect Language',
    langEN: 'EN English',
    openInGoogle: 'Open in Google',
    previewQuery: 'Preview Query String',
    instructionText: 'Instructions: Click "Open in Google", review results, then Ctrl+P (Cmd+P) → Save as PDF (first page only).',
    stepUpload: 'Upload Search Results PDF',
    clickUpload: 'Click to Upload PDF',
    supportPDF: 'Supports Google search results page PDF',
    stepAI: 'AI Analysis',
    stepAISanction: 'AI Analysis (Sanctions List)',
    showEdit: 'Show/Edit',
    notSet: '(Not Set)',
    usingGemini: 'Using gemini-3.5-flash (via Poe API)',
    getPoeKey: 'Get Poe API Key →',
    startAI: 'Start AI Analysis',
    startAISanction: 'Start AI Sanctions Screening',
    demoPreview: 'Demo Preview',
    useMockData: 'Use Mock Data',
    mockDataNote: 'Below are simulated results. Complete steps 1-3 for real analysis results.',
    selectPart: 'Select Part:',
    previewAllQueries: 'Preview All Query Strings',
    addRelationship: '+ Add Rel',
  },
  zh: {
    appTitle: 'KYC/AML', appSub: '合規管理系統', dashboard: '儀表板', workspace: '實體與結構', search: '搜尋', snapshots: '快照', settings: '設定', report: '報告',
    entityList: '實體列表', structureDiagram: '結構圖', totalEntities: '實體總數', highRisk: '高風險', overdueReviews: '逾期審查', expiredDocs: '過期文件', strFlagged: 'STR 標記', activeTodos: '待辦事項',
    companies: '間公司', persons: '位自然人', entitiesRatedHigh: '高風險實體', pastNextReview: '已逾期',
    riskDistribution: '風險分佈', entityTypes: '實體類型', avgRiskScoreTrend: '平均風險趨勢', autoTodos: '自動待辦',
    noPendingTodos: '✅ 無待辦', urgentItems: '項緊急',
    addEntity: '+ 新增實體', selected: '已選', clear: '清除', clearSelection: '取消選取',
    name: '名稱', type: '類型', jurisdiction: '管轄地', risk: '風險', flags: '標記', docs: '文件', actions: '操作', delete: '刪除',
    overview: '總覽', documents: '文件', screening: '篩查', str: 'STR', notes: '備註', riskTab: '風險',
    lastReview: '上次審查', nextReview: '下次審查', pep: 'PEP 政治敏感人物', sanctioned: '受制裁', negativeNews: '負面新聞',
    crrScore: 'CRR 分數', overridden: '已覆寫', uboDetection: 'UBO 偵測', relationships: '關聯關係',
    completion: '完成率', addDocument: '+ 新增文件', expiry: '到期日',
    pending: '待收', received: '已收', expired: '已過期', notApplicable: '不適用', noDocsYet: '尚無文件。',
    screeningHistory: '篩查歷史', addRecord: '+ 新增記錄', noScreeningRecords: '無記錄。',
    suspiciousTransactionReport: '可疑交易報告', flagForSTR: '標記為可疑交易', submissionDate: '提交日期',
    mlroApproved: 'MLRO 已核准', approvedOn: '核准日期', awaitingMLRO: '⏳ 等待 MLRO', strNotSubmitted: '❗ 尚未提交',
    notesTimeline: '備註時間軸', addNote: '+ 新增備註', noNotesYet: '尚無備註。',
    riskManagement: '風險管理', overrideRating: '覆寫評級', clearOverride: '清除覆寫',
    overrideActive: '覆寫生效中', reason: '原因', by: '操作人', on: '於',
    riskScoreTrend: '風險趨勢', insufficientHistory: '資料不足。', auditTrail: '稽核軌跡', score: '分數', override: '覆寫',
    lowRisk: '低風險', mediumRisk: '中風險', ownership: '持股', control: '控制', rca: '密切關聯人',
    globalSearch: '全域搜尋', searchPlaceholder: '搜尋實體、備註、待辦…', noResults: '找不到結果。', todos: '待辦',
    snapshotDesc: '快照描述…', saveSnapshot: '📸 儲存', savesCurrentState: '儲存目前狀態', entitiesLabel: '個實體', relationshipsLabel: '個關係',
    restore: '還原', compareSnapshots: '比較快照', selectA: '選 A', selectB: '選 B',
    added: '+ 新增', removed: '- 移除', changed: '~ 變更', noDifferences: '無差異。', noSnapshotsYet: '尚無快照。',
    riskWeights: '⚖️ 風險權重', countryLists: '🌍 國家名單', uboThreshold: '📐 UBO 門檻',
    adjustWeights: '調整 CRR 風險因素權重。', resetDefaults: '重設預設',
    highRiskCountries: '🔴 高風險 (FATF)', offshoreJurisdictions: '🟠 離岸', monitoredCountries: '🟡 監控', addCountry: '+ 新增國家…',
    configureUBO: '設定 UBO 偵測門檻。', commonValues: '常見：歐盟 25%、台灣 25%、開曼 10%、美國 25%',
    previewUBO: '預覽：以門檻偵測 UBO', complianceReport: '合規報告', printHint: 'Ctrl+P / Cmd+P 列印',
    reportTitle: 'KYC/AML 合規報告', generated: '產生日期',
    executiveSummary: '1. 摘要', entityRiskAssessment: '2. 風險評估', outstandingActions: '3. 待辦事項', uboSummary: '4. UBO 摘要',
    entity: '實體', rating: '評級', crr: 'CRR',
    addEntityTitle: '新增實體', entityName: '實體名稱', subType: '子類型', selectType: '選擇…',
    addRelTitle: '新增關係', editRelTitle: '修改關係', sourceOwner: '來源（持有者）', targetOwned: '目標（被持有）', percentage: '持股比例', description: '說明',
    overrideTitle: '風險覆寫', overrideWarning: '⚠️ 覆寫將記入稽核軌跡。',
    newRating: '新評級', reasonRequired: '原因（必填）', overrideJustification: '請填理由…', applyOverride: '套用',
    addDocTitle: '新增文件', docName: '文件名稱', selectOrType: '選擇…', expiryDate: '到期日',
    addScreenTitle: '新增篩查', system: '系統', screenType: '類型', result: '結果', resultPlaceholder: '清除 / 命中…',
    addNoteTitle: '新增備註', author: '作者', yourName: '姓名', note: '備註', enterNote: '輸入備註…',
    batchActionTitle: '批量操作', updateReviewDate: '更新審查日期', applyTo: '套用至', selectedEntities: '個實體。', newReviewDate: '新審查日期', apply: '套用',
    company: '公司', person: '自然人',
    ownershipType: '持股', controlType: '控制', rcaType: '密切關聯人', associationType: '關聯',
    via: '經由', High: '高', Medium: '中', Low: '低', filterPlaceholder: '篩選…',
    totalSharesLabel: '已發行總股數', sharesLabel: '股數', inputByPercentage: '百分比', inputByShares: '股數',
    autoCalcPercentage: '自動計算 %', noTotalSharesWarning: '目標公司未設定總股數，無法自動計算。',
    shareholdingSummary: '持股摘要', unaccountedShares: '未分配', shareholder: '股東', totalLabel: '合計',
    sharesUnit: '股', orText: '或',
    weightJurisdiction: '管轄地', weightPep: 'PEP', weightSanctions: '制裁', weightNegativeNews: '負面新聞', weightEntityType: '實體類型', weightOwnership: '持股結構',
    editEntity: '✏️ 修改', deleteSelected: '🗑️ 刪除所選', batchEdit: '✏️ 批量修改', editEntityTitle: '修改實體',
    saveChanges: '儲存變更', confirmDeleteTitle: '確認刪除', confirmDeleteMsg: '確定要刪除以下實體嗎？相關的所有關係也會一併移除。',
    confirmDelete: '確認刪除', cancel: '取消', batchReview: '📅 審查',
    emptyStateTitle: '尚無實體', emptyStateDesc: '開始新增您的第一個實體，或載入範本資料以體驗系統功能。',
    loadSample: '📦 載入範本資料', loadSampleDesc: '載入 8 個範本實體及關係圖。',
    clearAll: '🗑️ 清除所有資料', clearAllConfirm: '確定清除所有實體和關係？此操作無法還原。',
    sampleLoaded: '範本資料已成功載入。',
    uboTab: 'UBO', adverseMediaTab: '不良媒體篩查', sanctionScreeningTab: '制裁篩查', noUBOs: '在目前門檻下未偵測到 UBO。', uboChain: '鏈路', directOwnership: '直接持股', indirectOwnership: '間接持股', mixedOwnership: '直接+間接持股',
    uboAnalysis: 'UBO 分析', threshold: '門檻', detectedUBOs: '偵測到的 UBO', selectAll: '全選',
    cddTab: 'CDD 記錄', saveCDD: '📋 儲存 CDD 記錄', cddHistory: 'CDD 歷史',
    cddType: 'CDD 類型', cddInitial: '初始 CDD', cddPeriodic: '定期審查', cddEvent: '事件觸發',
    cddStatus: '狀態', cddInProgress: '進行中', cddCompleted: '已完成', cddPendingApproval: '待審批',
    cddSummary: '摘要 / 發現', cddReviewer: '審查人',
    cddRestore: '↻ 還原', cddViewDetails: '檢視 / 比較', cddHideDetails: '收起詳情',
    noCDDRecords: '尚無 CDD 記錄。完成 CDD 審查後請儲存記錄。',
    cddSaveTitle: '儲存 CDD 記錄', cddSaveDesc: '將目前實體狀態儲存為 CDD 記錄。',
    cddSaveSuccess: 'CDD 記錄已成功儲存。', cddRestoreSuccess: 'CDD 記錄已成功還原。',
    cddRestoreConfirm: '確定還原此 CDD 記錄？目前實體狀態將被覆蓋。',
    cddCurrentState: '目前', cddSavedState: '記錄', cddField: '欄位', cddChanged: '差異',
    cddRiskScore: '風險分數', cddRiskRating: '風險評級', cddDocReceived: '已收文件', cddDocTotal: '文件總數',
    cddScreenings: '篩查紀錄', cddNotes: '備註數', cddPEP: 'PEP', cddSanctioned: '受制裁', cddNegNews: '負面新聞', cddSTR: 'STR 標記',
    cddLastReview: '上次審查', cddNextReview: '下次審查', cddNo: '否', cddYes: '是',
    cddSavedDocs: '記錄中的文件', cddSavedScreenings: '記錄中的篩查', cddSavedNotes: '記錄中的備註',
    cddTip: '💡 每次完成 CDD 審查後請儲存記錄。',
    cddCompareTitle: '比較：記錄 vs 目前', cddRecordCount: '次 CDD',
    deleteSnapshot: '🗑️ 刪除', confirmDeleteSnapshotTitle: '刪除快照', confirmDeleteSnapshotMsg: '確定要刪除此快照嗎？',
    snapshotDeleted: '快照已刪除。', deleteAllSnapshots: '全部刪除', confirmDeleteAllSnapshotsMsg: '確定要刪除所有快照嗎？',
    companyCategory: '公司分類', catPrivate: '私人有限公司', catListed: '上市公司', catGovernment: '政府機構', catStateOwned: '國有企業',
    sddEligible: '💡 SDD 適用提示：此實體為{type}，可考慮適用簡化盡職調查。',
    autoHighRiskNotice: '⚠️ 自動高風險：{subType} 類型實體依規自動歸類為高風險，須每年強制審查一次。',
    editRel: '✏️', personCannotBeOwned: '⚠️ 自然人不能作為持股關係的目標。',
    annualReview: '強制年審', saveRel: '儲存關係',
    duplicateRelWarning: '⚠️ 這兩個實體之間已存在相同類型的關係。',
    circularRelWarning: '⚠️ 此操作將形成循環持股鏈。',
    selfRelWarning: '⚠️ 來源與目標不能為同一實體。',
    sharesExceedWarning: '⚠️ 分配股數總計（{allocated}）將超過已發行總股數（{total}）。',
    reviewCycleDays: '審查週期（天）', eddRequired: '🔴 需要 EDD：高風險實體需進行加強盡職調查。',
    docExpiringSoon: '⚠️ 文件將於 30 天內到期', exportCSV: '📥 匯出 CSV',
    lastUpdated: '最後更新', entityStatus: '狀態', pendingDocsCount: '待收文件', relCount: '關係數',
    noRelWarning: '⚠️ 此實體尚無任何關係。請考慮將其連結至持股結構。',
    percentageExceeds100: '⚠️ 目標公司的持股比例合計超過 100%。',
    requiredField: '此欄位為必填。', dueDiligenceLevel: '盡職調查等級',
    sdd: 'SDD 簡化', cdd: 'CDD 標準', edd: 'EDD 加強',
    sddDesc: '簡化盡職調查', cddDesc: '標準盡職調查', eddDesc: '加強盡職調查',
    reviewCycleHigh: '高風險：每 12 個月審查', reviewCycleMedium: '中風險：每 24 個月審查', reviewCycleLow: '低風險：每 36 個月審查',
    autoReviewReminder: '依據風險評級自動計算下次審查日',
    pepCategory: 'PEP 類別', selectPepCategory: '請選擇 PEP 類別',
    pepForeign: '外國 PEP', pepDomestic: '國內 PEP', pepInternational: '國際組織 PEP',
    pepFamilyMember: 'PEP 家屬成員', pepCloseAssociate: 'PEP 密切關係人',
    pepAutoHighRisk: '已自動提升為高風險（PEP）',
    weightIndustry: '行業', industryLabel: '行業 / 業務範疇', selectIndustry: '選擇行業…',
    highRiskIndustry: '⚠️ 高風險行業', autoEDDIndustry: '🔴 自動 EDD：高風險行業實體須進行加強盡職調查。',
    darkMode: '暗黑模式', lightMode: '明亮模式', geoRiskMap: '地理風險熱力圖', geoNoData: '無實體資料可顯示。',
    zoomIn: '放大', zoomOut: '縮小', resetView: '重置視圖',
    adverseSubtitle: '自動語言檢測 | 手動 Google 搜尋 → PDF 上傳 → 網頁全文抓取 → AI 分類',
    sanctionSubtitle: '自動語言檢測 | 手動 Google 搜尋 → PDF 上傳 → 網頁全文抓取 → AI 制裁名單分類',
    tabStart: '開始',
    tabArchitecture: '架構說明',
    tabKeywords: '關鍵字配置',
    webScrapingSettings: '網頁全文抓取設定',
    optional: '選項',
    stepGoogle: '執行 Google 搜尋',
    autoDetectLang: '自動檢測語言',
    langEN: 'GB 英文',
    openInGoogle: '在 Google 開啟搜尋',
    previewQuery: '預覽查詢字串',
    instructionText: '操作說明：點擊「在 Google 開啟搜尋」，確認結果後用 Ctrl+P（Cmd+P）→ 另存為 PDF 儲存第一頁。',
    stepUpload: '上傳搜尋結果 PDF',
    clickUpload: '點擊上傳 PDF',
    supportPDF: '支援 Google 搜尋結果頁面 PDF',
    stepAI: 'AI 分析',
    stepAISanction: 'AI 分析（制裁名單命中）',
    showEdit: '顯示/修改',
    notSet: '(未設定)',
    usingGemini: '使用 gemini-3.5-flash（via Poe API）',
    getPoeKey: '取得 Poe API Key →',
    startAI: '開始 AI 分析',
    startAISanction: '開始 AI 制裁篩查',
    demoPreview: 'Demo 預覽',
    useMockData: '使用 Mock 數據',
    mockDataNote: '以下為模擬分析結果，完成步驟 1-3 後可獲取真實分析結果。',
    selectPart: '選擇 Part：',
    previewAllQueries: '預覽全部查詢字串',
    addRelationship: '+ 新增關係',
  }
};


/* ========== SHARED: LANGUAGE DETECTION & CLASSIFICATION CONFIG ========== */

function detectLanguage(text) {
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g);
  const chineseCount = chineseChars ? chineseChars.length : 0;
  const totalChars = text.replace(/[\s\p{P}]/gu, '').length;
  const chineseRatio = totalChars > 0 ? chineseCount / totalChars : 0;
  return chineseRatio > 0.3 ? 'zh' : 'en';
}

const CLS_CONFIG = {
  'TRUE_HIT': {
    label: 'True Hit',
    desc: 'The hit is confirmed to be the subject and is associated with negative news related to ML/TF or sanctions',
    icon: AlertTriangle,
    bg: 'bg-red-50',
    border: 'border-red-300',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-800 border-red-200'
},
  'FALSE_HIT': {
    label: 'False Hit',
    desc: 'The article does NOT mention the target, OR the named party is a different person/entity',
    icon: XCircle,
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    text: 'text-amber-700',
    badge: 'bg-amber-100 text-amber-800 border-amber-200'
  },
  'IRRELEVANT_MLTF': {
    label: 'Irrelevant ML/TF',
    desc: 'No ML/TF-related negative news. Per CDD rule, no need to fully verify identity when there is no ML/TF content.',
    icon: Info,
    bg: 'bg-slate-50',
    border: 'border-slate-300',
    text: 'text-slate-600',
    badge: 'bg-slate-100 text-slate-700 border-slate-200'
  },
  'NO_HIT': {
    label: 'No Hit',
    desc: 'No search keywords found, or the search returned no result, or target not mentioned at all',
    icon: CheckCircle,
    bg: 'bg-green-50',
    border: 'border-green-300',
    text: 'text-green-700',
    badge: 'bg-green-100 text-green-800 border-green-200'
  }
};


/* ========== ADVERSE MEDIA SCREENING MODULE ========== */

const EN_KEYWORDS = [
  'market abuse', 'regulatory breach', 'tax evasion',
  'allegation', 'bribery', 'corruption', 'criminal',
  'fraud', 'illegal', 'indict', 'investigation',
  'laundering', 'lawsuit', 'penalty', 'prosecution',
  'sanctions', 'terrorist', 'trafficking', 'ML', 'AML'
];

const ZH_KEYWORDS = [
  '市場濫用', '監管違規', '逃稅', '指控', '賄賂',
  '腐敗', '刑事', '欺詐', '非法', '起訴',
  '調查', '洗錢', '訴訟', '處罰', '檢舉',
  '制裁', '恐怖分子', '販運', '洗錢', '反洗錢'
];

const ZH_KEYWORDS_CN = [
  '市场滥用', '监管违规', '逃税', '指控', '贿赂',
  '腐败', '刑事', '欺诈', '非法', '起诉',
  '调查', '洗钱', '诉讼', '处罚', '检举',
  '制裁', '恐怖分子', '贩运', '洗钱', '反洗钱'
];

const ZH_KEYWORDS_TW = ZH_KEYWORDS;

function buildQueryAuto(entityName) {
  // 🆕 用詳細偵測,區分 en / zh_tw / zh_cn
  const fullLang = detectLanguageDetail(entityName);

  let keywords;
  if (fullLang === 'zh_cn')      keywords = ZH_KEYWORDS_CN;
  else if (fullLang === 'zh_tw') keywords = ZH_KEYWORDS_TW;
  else                            keywords = EN_KEYWORDS;

  const keywordString = keywords.map(k => `"${k}"`).join(' OR ');
  const query = `"${entityName}" ${keywordString}`;

  // detectedLang 返回兼容 UI 嘅 'zh' / 'en'(其他地方仲用緊)
  const detectedLang = fullLang === 'en' ? 'en' : 'zh';
  return { query, detectedLang, keywords, fullLang };
}

const MOCK_EN = [
  { rank: 1, title: 'ABC Holdings Ltd Director Under Investigation for Money Laundering Scheme', source: 'South China Morning Post', date: '2026-02-15', snippet: 'Hong Kong authorities have launched a formal investigation into ABC Holdings Ltd and its director John Chen for allegedly laundering approximately USD 50 million...', matchedKeywords: ['laundering', 'investigation'], cls: 'TRUE_HIT', confidence: 0.94, reason: 'Article directly names ABC Holdings Ltd. Money laundering is a core ML/TF concern.', riskCat: 'Money Laundering' },
  { rank: 2, title: 'ABC Holdings Ltd Faces Fraud Allegations Linked to Sanctions Evasion', source: 'Reuters', date: '2026-01-20', snippet: 'ABC Holdings Ltd is facing multiple fraud allegations after investigators discovered the company may have facilitated transactions with sanctioned entities...', matchedKeywords: ['fraud', 'allegation', 'sanctions'], cls: 'TRUE_HIT', confidence: 0.92, reason: 'Exact entity name match. Fraud + sanctions evasion are directly related to ML/TF.', riskCat: 'Sanctions Evasion / Fraud' },
  { rank: 3, title: 'HKMA Names ABC Holdings Ltd in Terrorist Financing Probe', source: 'Financial Times', date: '2025-11-30', snippet: 'The Hong Kong Monetary Authority has named ABC Holdings Ltd among several companies being investigated for potential terrorist financing activities...', matchedKeywords: ['terrorist', 'investigation'], cls: 'TRUE_HIT', confidence: 0.96, reason: 'Named by HKMA in terrorist financing investigation—highest severity ML/TF category.', riskCat: 'Terrorist Financing' },
  { rank: 4, title: 'ABC Holdings Pty Ltd (Melbourne) Recognised for Innovation Excellence', source: 'The Australian', date: '2026-01-10', snippet: 'ABC Holdings Pty Ltd, an Australian technology startup, has been awarded the 2025 Innovation Excellence Award...', matchedKeywords: [], cls: 'FALSE_HIT', confidence: 0.91, reason: 'Different entity: Australian tech startup. Different jurisdiction, industry, no adverse information.', riskCat: 'N/A' },
  { rank: 5, title: 'ABC Holdings Ltd Sued by Former Partner for Breach of Commercial Contract', source: 'HK Economic Journal', date: '2026-02-01', snippet: 'ABC Holdings Ltd is facing a civil lawsuit over alleged breach of a commercial supply contract worth HKD 120 million...', matchedKeywords: ['lawsuit'], cls: 'IRRELEVANT_MLTF', confidence: 0.88, reason: 'Entity matches but this is a commercial contract dispute—not related to ML/TF.', riskCat: 'N/A (Commercial Dispute)' },
  { rank: 6, title: 'Hong Kong Introduces New AML Framework for Financial Institutions in 2026', source: 'Bloomberg', date: '2026-03-01', snippet: 'The Hong Kong government has unveiled a comprehensive new anti-money laundering framework...', matchedKeywords: ['AML'], cls: 'NO_HIT', confidence: 0.93, reason: 'General regulatory news. No mention of ABC Holdings Ltd.', riskCat: 'N/A' }
];

const MOCK_ZH = [
  { rank: 1, title: 'ABC控股有限公司董事涉洗錢 廉署正式調查', source: '南華早報', date: '2026-02-10', snippet: '香港廉政公署已對 ABC控股有限公司及其董事陳志明展開正式調查，涉嫌透過多間空殼公司洗錢約 5000 萬美元...', matchedKeywords: ['洗錢', '調查'], cls: 'TRUE_HIT', confidence: 0.96, reason: '文章直接點名 ABC控股有限公司為廉署調查對象，涉及洗錢。', riskCat: '洗錢' },
  { rank: 2, title: 'ABC控股有限公司董事涉賄賂案 遭檢控', source: '明報', date: '2026-01-25', snippet: '律政司已正式檢控 ABC控股有限公司董事陳志明，指其涉嫌向內地官員行賄以取得工程合約...', matchedKeywords: ['賄賂', '檢舉'], cls: 'TRUE_HIT', confidence: 0.93, reason: '實體名稱完全吻合，董事遭檢控賄賂案。賄賂是 ML/TF 的上游犯罪。', riskCat: '賄賂' },
  { rank: 3, title: 'ABC控股有限公司遭前合作夥伴起訴違約', source: '香港經濟日報', date: '2026-01-30', snippet: 'ABC控股有限公司遭前合作夥伴入稟法院，指控其違反價值 1.2 億港元的商業合約...', matchedKeywords: ['訴訟'], cls: 'IRRELEVANT_MLTF', confidence: 0.86, reason: '實體名稱吻合但這是民事商業合約糾紛，與 ML/TF 無關。', riskCat: 'N/A（商業糾紛）' },
  { rank: 4, title: '香港金管局公佈 2026 年反洗錢新指引', source: '信報財經新聞', date: '2026-03-10', snippet: '香港金融管理局今日公佈 2026 年反洗錢及恐怖融資新指引...', matchedKeywords: ['反洗錢'], cls: 'NO_HIT', confidence: 0.92, reason: '一般監管新聞。全文未提及 ABC控股有限公司。', riskCat: 'N/A' }
];


/* ========== SANCTION SCREENING MODULE (NEW) ========== */

/* ── 制裁篩查：國家關鍵字（3 Parts × 3 Languages）── */

// Part 1 — Comprehensive Sanctions / Highest Risk
const SANCTION_EN_PART1 = [
  "Syria", "Cuba", "Iran", "North Korea", "Crimea",
  "Democratic People's Republic of Korea", "DPRK",
  "DONETSK", "LUHANSK REGIONS", "Zaporizhzhia", "Kherson"
];
const SANCTION_ZH_TW_PART1 = [
  "敘利亞", "古巴", "伊朗", "北韓", "克里米亞",
  "朝鮮民主主義人民共和國", "頓內茨克", "盧甘斯克",
  "札波羅熱", "赫爾松"
];
const SANCTION_ZH_CN_PART1 = [
  "叙利亚", "古巴", "伊朗", "朝鲜", "克里米亚",
  "朝鲜民主主义人民共和国", "顿涅茨克", "卢甘斯克",
  "扎波罗热", "赫尔松"
];

// Part 2 — Second Tier
const SANCTION_EN_PART2 = [
  "Afghanistan", "Albania", "Belarus", "Bosnia and Herzegovina",
  "Bulgaria", "Central African Republic", "Congo", "Croatia",
  "Ethiopia", "Guinea-Bissau", "Haiti", "Iraq",
  "Kosovo", "Kyrgyzstan", "Lebanon", "Libya"
];
const SANCTION_ZH_TW_PART2 = [
  "阿富汗", "阿爾巴尼亞", "白俄羅斯", "波士尼亞與赫塞哥維納",
  "保加利亞", "中非共和國", "剛果", "克羅埃西亞",
  "衣索比亞", "幾內亞比紹", "海地", "伊拉克",
  "科索沃", "吉爾吉斯斯坦", "黎巴嫩", "利比亞"
];
const SANCTION_ZH_CN_PART2 = [
  "阿富汗", "阿尔巴尼亚", "白俄罗斯", "波斯尼亚和黑塞哥维那",
  "保加利亚", "中非共和国", "刚果", "克罗地亚",
  "埃塞俄比亚", "几内亚比绍", "海地", "伊拉克",
  "科索沃", "吉尔吉斯斯坦", "黎巴嫩", "利比亚"
];

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

/* ── 繁簡體中文偵測 ── */
function detectLanguageDetail(text) {
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g);
  const chineseCount = chineseChars ? chineseChars.length : 0;
  const totalChars = text.replace(/[\s\p{P}]/gu, '').length;
  if (totalChars === 0 || chineseCount / totalChars <= 0.3) return 'en';
  // 常見簡體字（有別於繁體的字形）
  const simpOnly = '国会们说这对开时问过机经还总从关动应实际认让产业专严临义书买亿仅仓价众优传伤亩';
  let simpScore = 0;
  for (const ch of text) { if (simpOnly.includes(ch)) simpScore++; }
  return simpScore > 0 ? 'zh_cn' : 'zh_tw';
}

/* ── 按語言取得 3 Parts 關鍵字 ── */
function getSanctionKeywordsByPart(lang) {
  const m = {
    en:    { part1: SANCTION_EN_PART1,    part2: SANCTION_EN_PART2,    part3: SANCTION_EN_PART3 },
    zh_tw: { part1: SANCTION_ZH_TW_PART1, part2: SANCTION_ZH_TW_PART2, part3: SANCTION_ZH_TW_PART3 },
    zh_cn: { part1: SANCTION_ZH_CN_PART1, part2: SANCTION_ZH_CN_PART2, part3: SANCTION_ZH_CN_PART3 },
  };
  return m[lang] || m.en;
}

/* ── 為指定 Part 組建 Google 搜尋查詢 ── */
function buildSanctionQueryForPart(entityName, part) {
  const lang = detectLanguageDetail(entityName);
  const kws = getSanctionKeywordsByPart(lang)[part];
  const kString = kws.map(k => `"${k}"`).join(' OR ');
  // ★ 新格式：實體名稱在前 + 關鍵字在後（OR 連接，無外層括號）
  return { query: `"${entityName}" ${kString}`, detectedLang: lang, keywords: kws };
}

/* ── 保留舊 API（合併全部 Parts，供 Mock / 向下相容）── */
function buildSanctionQueryAuto(entityName) {
  const lang = detectLanguageDetail(entityName);
  const all = getSanctionKeywordsByPart(lang);
  const keywords = [...all.part1, ...all.part2, ...all.part3];
  const kString = keywords.map(k => `"${k}"`).join(' OR ');
  // ★ 新格式：實體名稱在前 + 關鍵字在後（OR 連接，無外層括號）
  return { query: `"${entityName}" ${kString}`, detectedLang: lang === 'zh_cn' ? 'zh' : lang === 'zh_tw' ? 'zh' : 'en', keywords };
}

const SANCTION_MOCK_EN = [
  { rank: 1, title: 'ABC Holdings Ltd Added to OFAC SDN List for Iran-Related Transactions', source: 'U.S. Treasury Dept.', date: '2026-03-01', snippet: 'The U.S. Department of the Treasury\'s OFAC has designated ABC Holdings Ltd as a Specially Designated National (SDN) for facilitating illicit transactions with Iranian entities...', matchedKeywords: ['OFAC', 'SDN list', 'designated', 'sanction'], cls: 'TRUE_HIT', confidence: 0.97, reason: 'STAGE 1: Exact entity name match—ABC Holdings Ltd explicitly named by U.S. Treasury. STAGE 2: Designated on OFAC SDN List for Iran-related transactions. Direct sanctions hit.', riskCat: 'OFAC SDN Designation' },
  { rank: 2, title: 'EU Council Adds ABC Holdings Ltd to Sanctions List Under Ukraine-Related Measures', source: 'Official Journal of the EU', date: '2026-02-20', snippet: 'The Council of the European Union has added ABC Holdings Ltd to its consolidated sanctions list under Regulation (EU) 269/2014 concerning Ukraine...', matchedKeywords: ['EU sanctions', 'sanctions', 'asset freeze'], cls: 'TRUE_HIT', confidence: 0.95, reason: 'STAGE 1: Exact entity match. STAGE 2: Listed under EU sanctions regulation with asset freeze measures. Confirmed sanctions designation.', riskCat: 'EU Sanctions Designation' },
  { rank: 3, title: 'ABC Holdings Ltd Investigated for Potential Sanctions Evasion via Shell Companies', source: 'Financial Times', date: '2026-01-15', snippet: 'Investigators are examining whether ABC Holdings Ltd used a network of offshore shell companies to circumvent international sanctions imposed on Russian oligarchs...', matchedKeywords: ['sanctions evasion', 'sanction'], cls: 'TRUE_HIT', confidence: 0.91, reason: 'STAGE 1: Name match confirmed. STAGE 2: Under investigation for sanctions evasion—a serious sanctions-related offence.', riskCat: 'Sanctions Evasion' },
  { rank: 4, title: 'ABC Holdings Pty Ltd (Melbourne) Wins Government Contract', source: 'The Australian', date: '2026-01-10', snippet: 'ABC Holdings Pty Ltd, an Australian defence contractor, has been awarded a major government procurement contract...', matchedKeywords: [], cls: 'FALSE_HIT', confidence: 0.92, reason: 'STAGE 1: Different entity—ABC Holdings Pty Ltd is an Australian company in a different industry and jurisdiction.', riskCat: 'N/A' },
  { rank: 5, title: 'ABC Holdings Ltd Implements New Sanctions Compliance Programme', source: 'Company Press Release', date: '2026-02-28', snippet: 'ABC Holdings Ltd today announced the launch of a comprehensive sanctions compliance programme to ensure full adherence to international sanctions regimes...', matchedKeywords: ['sanctions'], cls: 'IRRELEVANT_MLTF', confidence: 0.89, reason: 'STAGE 1: Name match. STAGE 2: Entity is implementing compliance measures—not being sanctioned or investigated. No adverse sanctions information.', riskCat: 'N/A (Compliance Initiative)' },
  { rank: 6, title: 'Global Sanctions Landscape: New OFAC Guidance for Financial Institutions', source: 'Bloomberg Law', date: '2026-03-05', snippet: 'OFAC has released updated guidance for financial institutions on sanctions screening best practices and risk-based approaches...', matchedKeywords: ['OFAC', 'sanctions'], cls: 'NO_HIT', confidence: 0.94, reason: 'General regulatory guidance. ABC Holdings Ltd is not mentioned in this article.', riskCat: 'N/A' }
];

const SANCTION_MOCK_ZH = [
  { rank: 1, title: 'ABC控股有限公司被列入美國OFAC制裁名單', source: '美國財政部', date: '2026-03-01', snippet: '美國財政部海外資產控制辦公室（OFAC）已將ABC控股有限公司列為特別指定國民（SDN），因其涉嫌協助伊朗實體進行非法交易...', matchedKeywords: ['制裁', '制裁名單', '特別指定國民'], cls: 'TRUE_HIT', confidence: 0.97, reason: '階段一：實體名稱完全吻合。階段二：被OFAC列入SDN名單，屬直接制裁命中。', riskCat: 'OFAC SDN 列名' },
  { rank: 2, title: 'ABC控股有限公司涉嫌透過空殼公司規避制裁遭調查', source: '金融時報中文版', date: '2026-01-15', snippet: '調查人員正在審查ABC控股有限公司是否利用離岸空殼公司網絡規避針對俄羅斯寡頭的國際制裁...', matchedKeywords: ['制裁規避', '制裁'], cls: 'TRUE_HIT', confidence: 0.91, reason: '階段一：名稱吻合。階段二：涉嫌制裁規避，屬嚴重制裁相關違規。', riskCat: '制裁規避' },
  { rank: 3, title: 'ABC控股有限公司推出全新制裁合規計劃', source: '公司新聞稿', date: '2026-02-28', snippet: 'ABC控股有限公司今日宣佈推出全面的制裁合規計劃，以確保完全遵守國際制裁制度...', matchedKeywords: ['制裁'], cls: 'IRRELEVANT_MLTF', confidence: 0.88, reason: '階段一：名稱吻合。階段二：實體正在實施合規措施，並非被制裁或調查對象。無不利制裁信息。', riskCat: 'N/A（合規措施）' },
  { rank: 4, title: '全球制裁動態：OFAC發佈金融機構新指引', source: '彭博法律', date: '2026-03-05', snippet: 'OFAC已發佈更新的金融機構制裁篩查最佳實踐指引...', matchedKeywords: ['制裁'], cls: 'NO_HIT', confidence: 0.93, reason: '一般監管指引。全文未提及ABC控股有限公司。', riskCat: 'N/A' }
];

/* ========== Google PDF 文字預處理 ========== */
function cleanGooglePdfText(rawText) {
  let text = rawText.normalize('NFKC');

  // 1. 移除 AI 概覽區塊（"AI 概覽" 到 "的搜尋結果" 之間）
  const aiOverviewStart = text.indexOf('AI 概覽');
  // 也處理英文 "AI Overview"
  const aiOverviewStartEN = text.indexOf('AI Overview');
  const actualStart = aiOverviewStart !== -1 ? aiOverviewStart : aiOverviewStartEN;

  if (actualStart !== -1) {
    // 找到第一個「的搜尋結果」或「search results」標記
    const searchMarkerZH = text.indexOf('的搜尋結果', actualStart);
    const searchMarkerEN = text.indexOf('search results', actualStart);
    const searchMarker = searchMarkerZH !== -1 ? searchMarkerZH : searchMarkerEN;
    if (searchMarker !== -1 && searchMarker > actualStart) {
      text = text.substring(0, actualStart) + '\n' + text.substring(searchMarker);
    }
  }

  // 2. 移除 Google UI 導航噪音
  const uiNoisePatterns = [
    /AI 模式\s*全部\s*新聞\s*圖片\s*購物\s*短片\s*影片\s*更多\s*工具/g,
    /AI mode\s*All\s*News\s*Images\s*Shopping\s*Videos\s*More\s*Tools/gi,
    /顯示更多\s*[∨vV>↓]?/g,
    /Show more/gi,
    /翻譯這個網頁/g,
    /Translate this page/gi,
    /正在顯示個人化結果.*?搜尋結果/gs,
    /香港\s+觀塘區.*?更新位置/gs,
    /說明\s+發送意見\s+私隱權政策\s+條款/g,
    /About\s+Send feedback\s+Privacy\s+Terms/gi,
    /超過\s*\d+\s*個追蹤者/g,
    /\d+\s*則回應\s*·\s*\d+\s*年前/g,
    /\d+\s*\u2A2F?\s*(下一頁|Next)/g,
  ];
  for (const pattern of uiNoisePatterns) {
    text = text.replace(pattern, '\n');
  }

  // 3. 如果有「沒有引號」標記，優先取無引號搜尋的結果
  const unquotedMarkerZH = text.indexOf('沒有引號');
  const unquotedMarkerEN = text.indexOf('without quotes');
  const unquotedMarker = unquotedMarkerZH !== -1 ? unquotedMarkerZH : unquotedMarkerEN;

  if (unquotedMarker !== -1) {
    // 找到「沒有引號」或 "without quotes" 之後的下一行開始
    const afterMarker = text.indexOf('\n', unquotedMarker);
    if (afterMarker !== -1) {
      // 保留標記前的「搵唔到結果」訊息作為上下文，但主要分析後面的結果
      const beforeQuotedSearch = text.substring(0, text.lastIndexOf('\n', Math.max(0, unquotedMarker - 200)));
      text = beforeQuotedSearch + '\n--- UNQUOTED SEARCH RESULTS BELOW ---\n' + text.substring(afterMarker);
    }
  }

  // 4. 移除頁尾
  const footerMarkers = ['正在顯示個人化結果', 'Personalized results', '下一頁', 'Next page'];
  for (const marker of footerMarkers) {
    const lastIdx = text.lastIndexOf(marker);
    if (lastIdx !== -1 && lastIdx > text.length * 0.7) {
      text = text.substring(0, lastIdx);
    }
  }

  // 5. 壓縮連續空行
  text = text.replace(/\n{4,}/g, '\n\n\n');

  return text.trim();
}

/**
 * 🆕 FIX B — Rank-aligned PDF segmentation for Google SERP PDFs.
 *
 * PROBLEM: findArticleContextInPdf() probes the PDF text by URL path
 *   fragments. When two results share the same domain (e.g. 3x HKEXnews,
 *   2x SHKP.com), or when path probes fall back to bare hostname,
 *   results 1, 4, 5, etc. all hit the SAME PDF position → all get the
 *   same snippet → cross-contaminated reasons in the final output.
 *
 * SOLUTION: Pre-slice the PDF into N blocks ONCE, in display order.
 *   Each block = [previous breadcrumb line .. next breadcrumb line - 1],
 *   with a 6-line look-back to capture the title above the breadcrumb.
 *   Articles then use pdfBlocks[rank - 1] — GUARANTEED unique per rank.
 */
function sliceSerpPdfByResultBlocks(pdfText) {
  if (!pdfText) return [];

  const lines = pdfText.split('\n');
  const anchorLineIndices = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length < 8 || trimmed.length > 250) continue;

    // Anchor = line that looks like a breadcrumb ("domain.tld › path")
    //          OR a bare http(s) URL inside a SERP result.
    const hasBreadcrumb = /[a-z0-9][a-z0-9-]*\.[a-z]{2,}.*\s*›/i.test(trimmed);
    const hasUrl = /https?:\/\/[a-z0-9]/i.test(trimmed);
    if (!hasBreadcrumb && !hasUrl) continue;

    // Skip Google infrastructure anchors (search results page UI)
    const lc = trimmed.toLowerCase();
    if (lc.includes('google.com/search') ||
        lc.includes('googleadservices') ||
        lc.includes('gstatic.com') ||
        lc.includes('accounts.google') ||
        lc.includes('support.google') ||
        lc.includes('policies.google') ||
        lc.includes('maps.google') ||
        lc.includes('translate.google')) continue;

    anchorLineIndices.push(i);
  }

  if (anchorLineIndices.length === 0) return [];

  const blocks = [];
  for (let k = 0; k < anchorLineIndices.length; k++) {
    const anchorIdx = anchorLineIndices[k];
    // Include up to 6 lines BEFORE this anchor (title sits above breadcrumb)
    const lookbackFloor = k === 0 ? 0 : anchorLineIndices[k - 1] + 1;
    const start = Math.max(lookbackFloor, anchorIdx - 6);
    // Up to the line BEFORE the next anchor
    const end = k < anchorLineIndices.length - 1 ? anchorLineIndices[k + 1] : lines.length;

    const block = lines.slice(start, end).join('\n').trim();
    if (block.length >= 20) blocks.push(block);
  }

  console.log(`📦 FIX B: SERP PDF sliced into ${blocks.length} per-rank blocks (${anchorLineIndices.length} breadcrumb anchors detected)`);
  return blocks;
}


function findArticleContextInPdf(pdfText, url) {
  if (!pdfText || !url) return '';
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\d*\./i, '').toLowerCase();
    const path = u.pathname.replace(/^\/+|\/+$/g, '');
    const parts = path.split('/').filter(p => p.length > 0);

    // 由最 specific (last path segment) 到最 generic (host) 試 anchor
    const probes = [];
    const last = parts[parts.length - 1]?.replace(/\.[a-z0-9]+$/i, '');
    if (last && last.length >= 5) probes.push(last);
    parts.forEach(p => {
      const clean = p.replace(/\.[a-z0-9]+$/i, '');
      if (clean.length >= 5 && !probes.includes(clean)) probes.push(clean);
    });
    if (host) probes.push(host);

    const pdfLc = pdfText.toLowerCase();
    let hitIdx = -1;
    for (const p of probes) {
      const idx = pdfLc.indexOf(p.toLowerCase());
      if (idx !== -1) { hitIdx = idx; break; }
    }
    if (hitIdx === -1) return '';

    // 用「下一個 https://」做下邊界 = 下一個 result 嘅 breadcrumb
    const nextRe = /https?:\/\//g;
    nextRe.lastIndex = hitIdx + 10;
    const nextMatch = nextRe.exec(pdfText);
    const downBoundary = nextMatch ? nextMatch.index : Math.min(pdfText.length, hitIdx + 800);

    // 上邊界 = 上一個 https://(即 previous result 嘅 breadcrumb)之後
    let upBoundary = 0;
    const before = pdfText.slice(0, hitIdx);
    const prevs = [...before.matchAll(/https?:\/\//g)];
    if (prevs.length > 0) {
      const lastPrev = prevs[prevs.length - 1];
      const eol = pdfText.indexOf('\n', lastPrev.index);
      upBoundary = eol !== -1 ? eol : lastPrev.index;
    }

    return pdfText.slice(
      Math.max(upBoundary, hitIdx - 600),
      Math.min(downBoundary, hitIdx + 400)
    ).trim();
  } catch {
    return '';
  }
}


/* ★ GeoRiskMap — Real World Map (D3.js + TopoJSON) */
function GeoRiskMap({ entities, getEffectiveRating, t, lang }) {
  const wrapRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const tipRef = React.useRef(null);
  const zoomObjRef = React.useRef(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [unmatchedList, setUnmatchedList] = React.useState([]);

  const NAME_TO_ISO = useMemo(() => ({
    'USA':'840','UK':'826','Germany':'276','France':'250','Japan':'392',
    'Australia':'036','Canada':'124','Singapore':'702','Taiwan':'158',
    'Switzerland':'756','Netherlands':'528','Ireland':'372','Luxembourg':'442',
    'China':'156','India':'356','Brazil':'076','South Korea':'410',
    'New Zealand':'554','Sweden':'752','Norway':'578','Iran':'364',
    'North Korea':'408','Myanmar':'104','Syria':'760','Afghanistan':'004',
    'Libya':'434','Somalia':'706','South Sudan':'728','Yemen':'887','Iraq':'368',
    'Panama':'591','Liechtenstein':'438','Vanuatu':'548','Seychelles':'690',
    'Russia':'643','Turkey':'792','UAE':'784','Pakistan':'586','Cambodia':'116',
    'Nigeria':'566','Albania':'008','Philippines':'608','Barbados':'052',
    'Senegal':'686','Cuba':'192','Venezuela':'862','Nicaragua':'558','Haiti':'332',
    'Mali':'466','Central African Republic':'140','Congo':'180','Ethiopia':'231',
    'Guinea-Bissau':'624','Macedonia':'807','Montenegro':'499','Serbia':'688',
    'Slovenia':'705','Croatia':'191','Bulgaria':'100','Romania':'642',
    'Belarus':'112','Bosnia and Herzegovina':'070','Kyrgyzstan':'417',
    'Ukraine':'804','Lebanon':'422','Sudan':'729','South Africa':'710',
    'Kenya':'404','Italy':'380','Spain':'724','Mexico':'484','Saudi Arabia':'682',
    'Egypt':'818','Indonesia':'360','Thailand':'764','Malaysia':'458',
    'Cayman Islands':'136',
    'Hong Kong':null,'BVI':null,'Bermuda':null,'Jersey':null,'Guernsey':null,
    'Isle of Man':null,'Kosovo':null,'Macau':null,
  }), []);

  const POINT_COORDS = useMemo(() => ({
    'Hong Kong':[114.17,22.32],'Singapore':[103.82,1.35],'BVI':[-64.6,18.4],
    'Cayman Islands':[-81.25,19.31],'Bermuda':[-64.78,32.3],'Jersey':[-2.13,49.21],
    'Guernsey':[-2.58,49.45],'Isle of Man':[-4.48,54.24],'Liechtenstein':[9.55,47.17],
    'Macau':[113.54,22.2],'Luxembourg':[6.13,49.81],'Kosovo':[20.9,42.6],
    'Barbados':[-59.5,13.2],'Seychelles':[55.5,-4.7],'Vanuatu':[166.9,-15.4],
    'Taiwan':[121,23.7],
  }), []);

  const geoData = useMemo(() => {
    const data = {};
    entities.forEach(e => {
      const j = e.jurisdiction;
      if (!data[j]) data[j] = { name: j, total: 0, high: 0, medium: 0, low: 0 };
      data[j].total++;
      const r = getEffectiveRating(e).rating;
      if (r === 'High') data[j].high++;
      else if (r === 'Medium') data[j].medium++;
      else data[j].low++;
    });
    return data;
  }, [entities, getEffectiveRating]);

  const getCol = useCallback((g) => !g ? '#172340' : g.high > 0 ? '#ef4444' : g.medium > 0 ? '#f59e0b' : '#22c55e', []);
  const hovCol = useCallback((g) => !g ? '#1e3050' : g.high > 0 ? '#fca5a5' : g.medium > 0 ? '#fcd34d' : '#86efac', []);

  React.useEffect(() => {
    let cancelled = false;
    const load = (src) => new Promise((res, rej) => {
      if (src.includes('d3') && window.d3) return res();
      if (src.includes('topojson') && window.topojson) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error(src));
      document.head.appendChild(s);
    });
    (async () => {
      try {
        await load('https://d3js.org/d3.v7.min.js');
        await load('https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js');
        if (!cancelled) setLoading(false);
      } catch (e) { if (!cancelled) setErr(lang === 'zh' ? '地圖庫載入失敗' : 'Map library load failed'); }
    })();
    return () => { cancelled = true; };
  }, [lang]);

  React.useEffect(() => {
    if (loading || err || !mapRef.current || Object.keys(geoData).length === 0) return;
    const d3 = window.d3, topojson = window.topojson;
    if (!d3 || !topojson) return;

    d3.select(mapRef.current).selectAll('*').remove();
    const W = mapRef.current.clientWidth || 800;
    const H = Math.max(Math.min(W * 0.5, 480), 240);

    const svg = d3.select(mapRef.current).append('svg').attr('width', W).attr('height', H).style('display', 'block');

    const defs = svg.append('defs');
    const og = defs.append('radialGradient').attr('id','geo-og2').attr('cx','50%').attr('cy','40%').attr('r','65%');
    og.append('stop').attr('offset','0%').attr('stop-color','#0f1d32');
    og.append('stop').attr('offset','100%').attr('stop-color','#060e1a');
    const gl = defs.append('filter').attr('id','geo-gl2');
    gl.append('feGaussianBlur').attr('stdDeviation','2.5').attr('result','b');
    const fmg = gl.append('feMerge');
    fmg.append('feMergeNode').attr('in','b');
    fmg.append('feMergeNode').attr('in','SourceGraphic');

    svg.append('rect').attr('width', W).attr('height', H).attr('fill','url(#geo-og2)');

    const proj = d3.geoNaturalEarth1().scale(W / 5.5).translate([W / 2, H / 2]);
    const pathGen = d3.geoPath().projection(proj);
    const g = svg.append('g');

    const zm = d3.zoom().scaleExtent([1, 10]).on('zoom', e => g.attr('transform', e.transform));
    svg.call(zm);
    zoomObjRef.current = { svg, zm };

    g.append('path').datum(d3.geoGraticule().step([20, 20])())
      .attr('d', pathGen).attr('fill','none').attr('stroke','rgba(30,58,95,0.4)').attr('stroke-width', 0.3);

    const tip = tipRef.current;
    const showT = (evt, data) => {
      if (!tip) return;
      tip.style.opacity = '1';
      const pct = v => data.total ? Math.round(v / data.total * 100) : 0;
      tip.innerHTML = '<div style="font-weight:700;font-size:13px;margin-bottom:4px">' + data.name + '</div>' +
        '<div style="height:1px;background:rgba(148,163,184,0.2);margin:4px 0"></div>' +
        '<div style="display:flex;justify-content:space-between;padding:2px 0"><span>📊 ' + (lang === 'zh' ? '總實體' : 'Total') + '</span><b>' + data.total + '</b></div>' +
        '<div style="display:flex;justify-content:space-between;padding:2px 0"><span>🔴 ' + (lang === 'zh' ? '高風險' : 'High') + '</span><b>' + data.high + ' (' + pct(data.high) + '%)</b></div>' +
        '<div style="display:flex;justify-content:space-between;padding:2px 0"><span>🟡 ' + (lang === 'zh' ? '中風險' : 'Med') + '</span><b>' + data.medium + ' (' + pct(data.medium) + '%)</b></div>' +
        '<div style="display:flex;justify-content:space-between;padding:2px 0"><span>🟢 ' + (lang === 'zh' ? '低風險' : 'Low') + '</span><b>' + data.low + ' (' + pct(data.low) + '%)</b></div>';
      moveT(evt);
    };
    const moveT = (evt) => {
      if (!tip || !wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      let x = evt.clientX - r.left + 14, y = evt.clientY - r.top - 8;
      if (x + 175 > r.width) x -= 195;
      if (y + 130 > r.height) y -= 140;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    };
    const hideT = () => { if (tip) tip.style.opacity = '0'; };

    const iso2j = {};
    Object.entries(NAME_TO_ISO).forEach(([n, iso]) => { if (iso && geoData[n]) iso2j[iso] = n; });

    d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(world => {
      const countries = topojson.feature(world, world.objects.countries);
      const borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
      const matched = new Set();

      g.selectAll('.gc').data(countries.features).enter().append('path')
        .attr('d', pathGen)
        .attr('fill', d => { const j = iso2j[d.id]; return j ? getCol(geoData[j]) : '#172340'; })
        .attr('fill-opacity', d => iso2j[d.id] ? 0.8 : 0.45)
        .attr('stroke', d => iso2j[d.id] ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)')
        .attr('stroke-width', d => iso2j[d.id] ? 0.7 : 0.3)
        .style('cursor', d => iso2j[d.id] ? 'pointer' : 'default')
        .style('transition', 'fill 0.2s')
        .on('mouseenter', function(evt, d) {
          const j = iso2j[d.id]; if (!j) return;
          d3.select(this).attr('fill', hovCol(geoData[j])).attr('fill-opacity', 1).attr('stroke-width', 1.5).raise();
          showT(evt, geoData[j]);
        })
        .on('mousemove', moveT)
        .on('mouseleave', function(evt, d) {
          const j = iso2j[d.id];
          d3.select(this).attr('fill', j ? getCol(geoData[j]) : '#172340').attr('fill-opacity', j ? 0.8 : 0.45).attr('stroke-width', j ? 0.7 : 0.3);
          hideT();
        });

      g.append('path').datum(borders).attr('d', pathGen).attr('fill','none').attr('stroke','rgba(255,255,255,0.08)').attr('stroke-width', 0.5).style('pointer-events','none');

      Object.entries(iso2j).forEach(([iso, jName]) => {
        const data = geoData[jName]; if (!data) return;
        const feat = countries.features.find(f => String(f.id) === String(iso));
        if (!feat) return;
        const c = pathGen.centroid(feat); if (isNaN(c[0])) return;
        matched.add(jName);
        const r = Math.max(5, Math.min(14, 4 + data.total * 2));
        const col = getCol(data);
        const pu = g.append('circle').attr('cx', c[0]).attr('cy', c[1]).attr('r', r).attr('fill', col).attr('fill-opacity', 0.2).style('pointer-events','none');
        pu.append('animate').attr('attributeName','r').attr('values', r + ';' + (r + 8) + ';' + r).attr('dur','2.5s').attr('repeatCount','indefinite');
        pu.append('animate').attr('attributeName','fill-opacity').attr('values','.2;.04;.2').attr('dur','2.5s').attr('repeatCount','indefinite');
        g.append('circle').attr('cx', c[0]).attr('cy', c[1]).attr('r', r).attr('fill', col).attr('stroke','rgba(255,255,255,0.85)').attr('stroke-width', 1.2).style('filter','url(#geo-gl2)').style('pointer-events','none');
        if (data.total >= 2) g.append('text').attr('x', c[0]).attr('y', c[1] + 0.5).attr('text-anchor','middle').attr('dominant-baseline','middle').attr('font-size', r >= 8 ? '9px' : '7px').attr('font-weight','700').attr('fill','white').style('pointer-events','none').text(data.total);
      });

      Object.entries(POINT_COORDS).forEach(([name, coords]) => {
        const data = geoData[name]; if (!data || matched.has(name)) return;
        matched.add(name);
        const p = proj(coords); if (!p || isNaN(p[0])) return;
        const r = Math.max(5, Math.min(12, 4 + data.total * 1.5));
        const col = getCol(data);
        const pu = g.append('circle').attr('cx', p[0]).attr('cy', p[1]).attr('r', r).attr('fill', col).attr('fill-opacity', 0.2).style('pointer-events','none');
        pu.append('animate').attr('attributeName','r').attr('values', r + ';' + (r + 7) + ';' + r).attr('dur','2.5s').attr('repeatCount','indefinite');
        pu.append('animate').attr('attributeName','fill-opacity').attr('values','.2;.04;.2').attr('dur','2.5s').attr('repeatCount','indefinite');
        g.append('circle').attr('cx', p[0]).attr('cy', p[1]).attr('r', r).attr('fill', col).attr('stroke','rgba(255,255,255,0.85)').attr('stroke-width', 1.2).style('filter','url(#geo-gl2)').style('pointer-events','none');
        if (data.total >= 1) g.append('text').attr('x', p[0]).attr('y', p[1] + 0.5).attr('text-anchor','middle').attr('dominant-baseline','middle').attr('font-size','8px').attr('font-weight','700').attr('fill','white').style('pointer-events','none').text(data.total);
        g.append('text').attr('x', p[0]).attr('y', p[1] + r + 10).attr('text-anchor','middle').attr('font-size','7px').attr('fill','rgba(255,255,255,0.45)').attr('font-weight','500').style('pointer-events','none').text(name.length > 14 ? name.slice(0, 12) + '…' : name);
        g.append('circle').attr('cx', p[0]).attr('cy', p[1]).attr('r', r + 5).attr('fill','transparent').style('cursor','pointer')
          .on('mouseenter', evt => showT(evt, data)).on('mousemove', moveT).on('mouseleave', hideT);
      });

      setUnmatchedList(Object.keys(geoData).filter(c => !matched.has(c)));
    }).catch(() => setErr(lang === 'zh' ? '地圖數據載入失敗' : 'Map data load failed'));

  }, [loading, err, geoData, lang, NAME_TO_ISO, POINT_COORDS, getCol, hovCol]);

  const handleZoom = (action) => {
    if (!zoomObjRef.current || !window.d3) return;
    const { svg, zm } = zoomObjRef.current;
    if (action === 'in') svg.transition().duration(300).call(zm.scaleBy, 1.5);
    else if (action === 'out') svg.transition().duration(300).call(zm.scaleBy, 0.67);
    else svg.transition().duration(400).call(zm.transform, window.d3.zoomIdentity);
  };

  if (Object.keys(geoData).length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border p-3 mb-4">
      <h3 className="text-xs font-semibold text-gray-600 mb-2">🌍 {t.geoRiskMap}</h3>
      <div ref={wrapRef} className="relative w-full overflow-hidden rounded-lg" style={{ minHeight: '240px', background: 'linear-gradient(180deg, #0c1929, #132744, #1a3556)' }}>
        <div ref={mapRef} />
        {loading && !err && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs" style={{ color: '#64748b' }}>
            <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(99,102,241,0.2)', borderTopColor: '#6366f1' }} />
            {lang === 'zh' ? '正在載入真實世界地圖…' : 'Loading world map…'}
          </div>
        )}
        {err && <div className="absolute inset-0 flex items-center justify-center text-xs" style={{ color: '#ef4444' }}>⚠ {err}</div>}
        <div ref={tipRef} style={{ position: 'absolute', pointerEvents: 'none', zIndex: 100, background: 'rgba(8,15,30,0.96)', border: '1px solid rgba(99,102,241,0.4)', borderRadius: '10px', padding: '10px 14px', fontSize: '11px', color: '#e2e8f0', opacity: 0, transition: 'opacity 0.15s', minWidth: '160px', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }} />
        {!loading && !err && (
          <div className="absolute bottom-2 right-2 flex flex-col gap-1" style={{ zIndex: 10 }}>
            <button onClick={() => handleZoom('in')} className="w-7 h-7 rounded-lg text-white text-sm flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} title={t.zoomIn}>+</button>
            <button onClick={() => handleZoom('out')} className="w-7 h-7 rounded-lg text-white text-sm flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} title={t.zoomOut}>−</button>
            <button onClick={() => handleZoom('reset')} className="w-7 h-7 rounded-lg text-white text-sm flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} title={t.resetView}>⟳</button>
          </div>
        )}
      </div>
      {unmatchedList.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {unmatchedList.map(c => {
            const gd = geoData[c];
            return (
              <span key={c} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs border bg-gray-50">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getCol(gd) }} />
                {c} ({gd.total})
              </span>
            );
          })}
        </div>
      )}
      <div className="flex gap-3 mt-2 text-xs text-gray-400 flex-wrap">
        <span>🔴 {t.highRisk}</span>
        <span>🟡 {lang === 'zh' ? '中風險' : 'Medium'}</span>
        <span>🟢 {lang === 'zh' ? '低風險' : 'Low'}</span>
        <span className="ml-auto text-gray-300">{lang === 'zh' ? '滾輪縮放 · 拖曳平移 · 懸停查看' : 'Scroll zoom · Drag pan · Hover details'}</span>
      </div>
    </div>
  );
}

/* ========== ENTITY CONTEXT HELPERS (module-level constants & pure functions) ========== */

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

function formatEntityContext(info) {
  if (!info) return '';
  const parts = [];
  if (info.dob) parts.push(`出生日期 / DOB: ${info.dob}`);
  if (info.nationality) {
    const nat = NATIONALITIES.find(n => n.value === info.nationality);
    parts.push(`國籍 / Nationality: ${nat ? `${nat.en} / ${nat.zh}` : info.nationality}`);
  }
  if (info.gender) {
    parts.push(`性別 / Gender: ${GENDER_LABELS[info.gender] || info.gender}`);
  }
  if (info.company) parts.push(`公司/職稱 / Company/Title: ${info.company}`);
  if (info.idNumber) parts.push(`證件號碼 / ID Number: ${info.idNumber}`);
  if (info.address) parts.push(`地址 / Address: ${info.address}`);
  if (info.notes) parts.push(`其他 / Other: ${info.notes}`);
  return parts.join('\n');
}

/* ════════════════════════════════════════════════════════════════
   TWO-PASS ARCHITECTURE
   Pass 1: Per-article LLM fact extraction (short prompt, isolated)
   Pass 2: Pure JS deterministic classifier (no LLM, template reason)
   ════════════════════════════════════════════════════════════════ */

const PASS1_SYSTEM_PROMPT = `You are a fact extractor for KYC/AML screening. You do NOT classify. You do NOT judge risk. You do NOT assign labels.

Your single task: extract verifiable facts from ONE article about ONE target. Read the BODY, not just the title. If unsure, return "ambiguous" or empty string. NEVER fabricate identifiers. NEVER import names or facts from other articles.

Output strict JSON only. No markdown, no commentary. Start with { end with }.`;

function buildPass1Prompt({ targetName, kycInfo, articleTitle, articleSource, articleBody, articleUrl, hasFullBody }) {
  //                                                                                                ^^^^^^^^^^^^^
  //                                                                                                🆕 加新參數
  const hasKyc = kycInfo && Object.values(kycInfo).some(v => v && String(v).trim());
  const kycBlock = hasKyc
    ? `KYC-supplied identifiers:\n${formatEntityContext(kycInfo)}`
    : `KYC-supplied identifiers: (none provided)`;

// 🆕 GATE 3: publisher / articleDate / specificEvent 已改由 JS 從 PDF block 直接抽
  //   AI 唔再負責呢 3 個 field → 結構性消滅 cross-block fact contamination
  const bodyHeader = hasFullBody
    ? `Body (FULL article scraped from the URL):`
    : `Body ⚠️ NOTE — full article scrape was NOT available for this URL.
The text below is the Google SERP context block extracted from the user's manually-saved search PDF.
It contains the title line + source + breadcrumb + snippet (often ending in "..." because Google truncates).

🎯 EXTRACTION RULES FOR SNIPPETS:
• If the snippet clearly names the target WITH role context (e.g. "X being his Alternate Director"),
  extract that role faithfully — DO NOT default to targetMentioned=false just because the body is short.
• Hyphen / comma / case / space variants of the same name count as EXACT match.
  ✅ "Kwok Kai fai Adam" ↔ "KWOK Kai-fai, Adam" → 4 tokens identical → nameMatch = EXACT
• If the snippet shows target as "Alternate / Successor / Deputy / Replacing" the real subject,
  set targetRole = "alternate" or "successor", and actualSubjectName = the named real subject.
• Lower factsConfidence (0.5 – 0.7) only when role is GENUINELY ambiguous in the snippet text.

🔑 YOUR JOB — extract ONLY semantic facts (publisher / articleDate / specificEvent are JS-derived, NOT your job):

(1) targetActionInArticle (5-15 words — the SPECIFIC verb-phrase about the target IN THIS BLOCK ONLY)
  • Read ONLY this block. Do NOT use knowledge from training data or other blocks.
  • Examples: "appointed as Alternate Director", "ceased to be Alternate Director on 19 Dec 2014",
    "listed in shareholding table with 160,000 long position",
    "voted against by ISS proxy advisor", "named in board composition disclosure".

(2) wrongdoingDescribed + targetRole CONSISTENCY:
  • If THIS BLOCK mentions "Bribery Ordinance", "ICAC", "Independent Commission Against Corruption",
    "Prevention of Bribery", "fraud charges", "criminal prosecution", "released on bail",
    → wrongdoingDescribed = true.
  • If wrongdoingDescribed = true AND target is shown as Alternate/Successor of another NAMED person
    (e.g. "KWOK Kai-fai, Adam being his Alternate Director" where "his" refers to KWOK Ping-luen),
    → targetRole = "alternate"/"successor", and actualSubjectName = that other NAMED person.
  • If target appears ONLY in a shareholding / voting / board-list table with NO wrongdoing context,
    → targetRole = "passing_mention", wrongdoingDescribed = false.

⚠️ HARD CONSTRAINT — BLOCK ISOLATION
   You only see ONE block. Your wrongdoingDescribed, targetRole, actualSubjectName, evidenceQuote
   MUST come from THIS block's text alone. NEVER import facts (e.g. "ICAC bail", "Thomas Kwok")
   that appear in a sibling's content but NOT literally in this block — those belong to a different result.`;
  
  return `# TARGET
Name: "${targetName}"
${kycBlock}

# ARTICLE (this is the ONLY article you analyse)
URL: ${articleUrl || '(unknown)'}
Title: ${articleTitle || '(unknown)'}
Source: ${articleSource || '(unknown)'}

${bodyHeader}
${(articleBody || '').slice(0, 12000)}

# EXTRACT THESE FACTS AS JSON

{
  "targetMentioned": <true if target name (full name or all its tokens) literally appears in the body above; false otherwise>,
  "nameInArticle": "<exact party name as it appears in the article; empty string if target not mentioned>",
  "nameMatch": "<one of: EXACT | VARIANT | SUPERSET | DIFFERENT | ABSENT>",
  "nameMatchReason": "<one short sentence justifying nameMatch>",

  "kycContradiction": "<if KYC info EXPLICITLY contradicts the article's named party, describe in one sentence; else empty string>",

 "articleGenre": "<one of: news | regulatory_filing | academic | court_judgment | fiction | social_media | directory_profile | self_published | fraud_alert | violation_tracker | other>",

  "targetActionInArticle": "<the SPECIFIC action/status THIS BLOCK attributes to the screened target in 5-15 words, e.g. 'appointed as Alternate Director', 'ceased to be Alternate Director', 'recommended against by ISS', 'listed in board composition table'. Use ONLY facts literally present in this block.>",

  "wrongdoingDescribed": <true if the article describes any wrongdoing, investigation, allegation, charge, conviction, or designation; false otherwise>,
  "wrongdoingType": "<one of: money_laundering | sanctions | bribery | fraud | tax_evasion | terrorist_financing | export_control | customs_fraud | civil_dispute | regulatory_violation | environmental | none | other>",
  "wrongdoingInMLTFScope": <true if wrongdoingType is one of: money_laundering, sanctions, bribery, fraud, tax_evasion, terrorist_financing, export_control, customs_fraud; false otherwise>,

  "targetRole": "<one of: subject | successor | alternate | victim | witness | plaintiff | colleague | passing_mention | unrelated_same_name | not_present>",
  "actualSubjectName": "<if targetRole is NOT 'subject', the name of the actual wrongdoer AS IT APPEARS IN THIS ARTICLE'S BODY; empty string otherwise. NEVER copy a name from other articles or sources.>",
  "evidenceQuote": "<the single most decisive ≤25-word verbatim quote from the body supporting targetRole>",

  "factsConfidence": <0.0 to 1.0>
}

# DEFINITIONS

nameMatch:
  EXACT     — exact same name, OR same name with only hyphen/comma/case/space differences, OR trivial corporate-suffix variant (Ltd / Limited / Inc).
  VARIANT   — same person with surname-order swap.
  SUPERSET  — article name has STRICTLY MORE name tokens than target. NOT a match.
  DIFFERENT — shares some tokens but is clearly a different person/entity.
  ABSENT    — target name does not appear in the body.

targetRole:
  subject              — target IS the wrongdoer / investigated / charged / sanctioned party.
  successor            — target REPLACES the subject.
  alternate            — target is alternate / substitute / deputy director of the subject.
  victim               — target is the victim.
  witness              — target is interviewee, commentator, or expert only.
  plaintiff            — target is the plaintiff / employer suing someone else.
  colleague            — target works at the same organisation but is NOT implicated.
  passing_mention      — target named briefly, not central to any wrongdoing.
  unrelated_same_name  — same name appears but article context clearly indicates a different person.
  not_present          — target name does not appear in the body.

# CRITICAL RULES
1. Trace pronouns to their antecedent. "He replaces X, who was charged" — "he" = target, "X" = subject. Target is SUCCESSOR.
2. actualSubjectName MUST contain a name that literally appears in THIS article's body.
3. specificEvent and targetActionInArticle MUST be unique enough that two different articles about the same overall matter would still produce DIFFERENT phrasings.
4. Output JSON only.`;
}
async function extractArticleFacts({ targetName, kycInfo, article, apiKey }) {
  try {
    const userPrompt = buildPass1Prompt({
      targetName,
      kycInfo,
      articleTitle: article.title,
      articleSource: article.source,
      articleBody: article.body,
      articleUrl: article.url,
      hasFullBody: article.hasFullBody, 
    });

    const res = await fetch('https://api.poe.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        messages: [
          { role: 'system', content: PASS1_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.05,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (e) {
    console.warn(`Pass 1 fact extraction failed:`, e.message);
    return null;
  }
}


/* ════════════════════════════════════════════════════════════════
   SIMILARITY GUARD — Detect & repair duplicate reasons
   ════════════════════════════════════════════════════════════════ */

function normalizeReasonForCompare(reason) {
  if (!reason) return '';
  return String(reason)
    .toLowerCase()
    .replace(/"[^"]+"/g, '"X"')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, 'DATE')
    .replace(/\b\d{1,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*\d{2,4}\b/gi, 'DATE')
    .replace(/\s+/g, ' ')
    .trim();
}

function findDuplicateReasonGroups(parsed) {
  const groups = new Map();
  for (const r of parsed) {
    if (r.cls === 'NO_HIT' && r.riskCat === 'N/A (Extraction Failed)') continue;
    const sig = normalizeReasonForCompare(r.reason);
    if (!sig) continue;
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(r);
  }
  const dupes = [];
  for (const [sig, items] of groups.entries()) {
    if (items.length > 1) {
      dupes.push({ signature: sig, ranks: items.map(i => i.rank), items });
    }
  }
  return dupes;
}

const PASS1B_SYSTEM_PROMPT = `You are a fact extractor for KYC/AML screening. Your previous extraction produced facts that resulted in a reason indistinguishable from another article. You must now re-extract WITH DELIBERATE EMPHASIS on what makes THIS article UNIQUE compared to its siblings.

You do NOT classify. You do NOT judge risk. Output strict JSON only.`;

function buildPass1BPrompt({ targetName, kycInfo, article, siblingsInfo }) {
  const hasKyc = kycInfo && Object.values(kycInfo).some(v => v && String(v).trim());
  const kycBlock = hasKyc
    ? `KYC-supplied identifiers:\n${formatEntityContext(kycInfo)}`
    : `KYC-supplied identifiers: (none provided)`;

  const siblingBlock = siblingsInfo.length > 0
    ? siblingsInfo.map((s, i) =>
        `[Sibling ${i + 1}]\n` +
        `  URL: ${s.url || '(unknown)'}\n` +
        `  Previous targetActionInArticle: "${s.targetActionInArticle || '(empty)'}"`
      ).join('\n\n')
    : '(none)';

  return `# TARGET
Name: "${targetName}"
${kycBlock}

# THIS ARTICLE (the one you re-analyse)
URL: ${article.url || '(unknown)'}
Title: ${article.title || '(unknown)'}
Source: ${article.source || '(unknown)'}

Body:
${(article.body || '').slice(0, 12000)}

# SIBLINGS — Other articles that produced the SAME generic reason
${siblingBlock}

# YOUR TASK
Re-extract facts for THIS article. Your output for targetActionInArticle MUST be CLEARLY DIFFERENT from every sibling above. (publisher / articleDate / specificEvent are now JS-derived from THIS block — NOT your responsibility.)

REQUIREMENT:

1. targetActionInArticle — Target's SPECIFIC status / role / action IN THIS BLOCK ONLY (5-15 words). MUST differ from siblings.
   ❌ Bad (generic, copies sibling): "alternate director"
   ✅ Good (uses date / setting unique to this block): "newly appointed as Alternate Director on 13 Jul 2012"
   ✅ Good: "ceased to serve as Alternate Director effective 19 Dec 2014"
   ✅ Good: "listed in 2024/25 annual report board composition table"
   ✅ Good: "voted against by ISS proxy advisor for re-election"

⚠️ BLOCK ISOLATION
   Use ONLY facts that are LITERALLY in THIS block. NEVER copy a fact (e.g. "ICAC bail",
   "Thomas Kwok") that appears in a sibling's block but is NOT in this block's own text.

# OUTPUT SCHEMA
{
  "targetMentioned": <true/false>,
  "nameInArticle": "<string>",
  "nameMatch": "<EXACT | VARIANT | SUPERSET | DIFFERENT | ABSENT>",
  "nameMatchReason": "<string>",
  "kycContradiction": "<string>",
  "articleGenre": "<news | regulatory_filing | academic | court_judgment | fiction | social_media | directory_profile | self_published | fraud_alert | violation_tracker | other>",
  "targetActionInArticle": "<UNIQUE phrase, 5-15 words, from THIS block only>",
  "wrongdoingDescribed": <true/false>,
  "wrongdoingType": "<money_laundering | sanctions | bribery | fraud | tax_evasion | terrorist_financing | export_control | customs_fraud | civil_dispute | regulatory_violation | environmental | none | other>",
  "wrongdoingInMLTFScope": <true/false>,
  "targetRole": "<subject | successor | alternate | victim | witness | plaintiff | colleague | passing_mention | unrelated_same_name | not_present>",
  "actualSubjectName": "<string>",
  "evidenceQuote": "<≤25-word verbatim quote from THIS block>",
  "factsConfidence": <0.0-1.0>
}

Output JSON only. Start with { end with }.`;
}

async function reExtractWithDistinguishing({ targetName, kycInfo, article, siblings, apiKey }) {
  try {
    const siblingsInfo = siblings.map(s => ({
      url: s.url,
      targetActionInArticle: s._facts?.targetActionInArticle || '',
    }));

    const userPrompt = buildPass1BPrompt({ targetName, kycInfo, article, siblingsInfo });

    const res = await fetch('https://api.poe.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        messages: [
          { role: 'system', content: PASS1B_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.15,
        max_tokens: 1800,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (e) {
    console.warn('Pass 1B re-extraction failed:', e.message);
    return null;
  }
}

/* ════════════════════════════════════════════════════════════════
   END SIMILARITY GUARD
   ════════════════════════════════════════════════════════════════ */

  
function classifyFromFacts({ facts, targetName, mode }) {
  const isSanction = mode === 'sanction';
  const irrelevantLabel = isSanction ? 'Irrelevant sanction' : 'Irrelevant ML/TF';
  const suffix = isSanction ? ' There is no sanctions violations.' : ' There is no ML/TF negative news.';

  const roleText = {
    subject: 'the wrongdoer', successor: 'a successor to the actual subject',
    alternate: 'an Alternate Director', victim: 'the victim',
    witness: 'a witness or commentator', plaintiff: 'the plaintiff',
    colleague: 'a colleague at the same organisation', passing_mention: 'a passing mention',
    unrelated_same_name: 'an unrelated party with the same name', not_present: 'not present',
  };

  const wrongdoingText = {
    money_laundering: 'money laundering', sanctions: 'sanctions violations',
    bribery: 'bribery and corruption', fraud: 'fraud',
    tax_evasion: 'criminal tax evasion', terrorist_financing: 'terrorist financing',
    export_control: 'export control violations', customs_fraud: 'customs fraud',
    civil_dispute: 'a civil dispute', regulatory_violation: 'a regulatory violation',
    environmental: 'environmental violations', none: 'no wrongdoing',
    other: 'an unspecified matter',
  };

  const genreText = {
    news: 'this is a news article',
    regulatory_filing: 'this is a regulatory disclosure document',
    academic: 'this is an academic publication and any matching keywords appear in a scholarly context',
    court_judgment: 'this is a court judgment',
    fiction: 'this is a fictional or creative work, and any matching keywords are plot elements or character names, not real-world findings',
    social_media: 'this is a social media post',
    directory_profile: 'this is a professional directory profile',
    self_published: "this is the entity's own self-published content",
    fraud_alert: 'this is a fraud-alert warning issued by the named organisation against third-party impersonators',
    violation_tracker: 'this is a corporate violations tracker page',
    other: 'this is a publicly accessible article',
  };

  const mapRiskCat = () => {
    if (isSanction) return 'Sanctions';
    const m = {
      money_laundering: 'Money Laundering', sanctions: 'Sanctions',
      bribery: 'Bribery & Corruption', fraud: 'Fraud', tax_evasion: 'Tax Evasion',
      terrorist_financing: 'Terrorist Financing', export_control: 'Export Control',
      customs_fraud: 'Customs Fraud',
    };
    return m[facts.wrongdoingType] || 'Other ML/TF';
  };

  // ── RULE 1 — Target absent in body → FALSE_HIT
  if (!facts.targetMentioned || facts.nameMatch === 'ABSENT' || facts.targetRole === 'not_present') {
    return {
      cls: 'FALSE_HIT',
      reason: `False Hit, because the screened target "${targetName}" is not mentioned in this article. ${facts.nameMatchReason || ''}`.trim(),
      riskCat: 'N/A',
      identityMatch: 'NO_INFO',
      actualSubjectName: '',
      _factsConfidence: facts.factsConfidence,
    };
  }

  // ── RULE 2 — Token superset → FALSE_HIT
  if (facts.nameMatch === 'SUPERSET') {
    return {
      cls: 'FALSE_HIT',
      reason: `False Hit, because the article refers to "${facts.nameInArticle || 'a different party'}", whose name contains additional tokens beyond the screened target "${targetName}". This indicates a different individual or entity. ${facts.nameMatchReason || ''}`.trim(),
      riskCat: 'N/A',
      identityMatch: 'CONTRADICTED',
      actualSubjectName: facts.nameInArticle || '',
      _factsConfidence: facts.factsConfidence,
    };
  }

  // ── RULE 3 — Different person/entity → FALSE_HIT
  if (facts.nameMatch === 'DIFFERENT' || facts.targetRole === 'unrelated_same_name') {
    return {
      cls: 'FALSE_HIT',
      reason: `False Hit, because the article concerns "${facts.nameInArticle || 'a party with the same name'}", which is a different individual or entity from the screened target "${targetName}". ${facts.nameMatchReason || ''}`.trim(),
      riskCat: 'N/A',
      identityMatch: 'CONTRADICTED',
      actualSubjectName: facts.nameInArticle || '',
      _factsConfidence: facts.factsConfidence,
    };
  }

  // ── RULE 4 — KYC contradiction → FALSE_HIT
  if (facts.kycContradiction && facts.kycContradiction.trim()) {
    return {
      cls: 'FALSE_HIT',
      reason: `False Hit, because the KYC-supplied identifying information contradicts the article's named party: ${facts.kycContradiction}`,
      riskCat: 'N/A',
      identityMatch: 'CONTRADICTED',
      actualSubjectName: facts.nameInArticle || '',
      _factsConfidence: facts.factsConfidence,
    };
  }

  // ── RULE 5 — Fiction / fraud-alert / self-published → IRRELEVANT
  if (['fiction', 'fraud_alert', 'self_published'].includes(facts.articleGenre)) {
    return {
      cls: 'IRRELEVANT_MLTF',
      reason: `${irrelevantLabel}, because ${genreText[facts.articleGenre]}.${suffix}`,
      riskCat: 'N/A',
      identityMatch: 'PARTIAL_MATCH',
      actualSubjectName: '',
      _factsConfidence: facts.factsConfidence,
    };
  }

  // 🆕 Helper: build article-specific context clause
  const buildContextClause = () => {
    const parts = [];
    if (facts.articleDate && facts.articleDate !== 'unknown' && facts.articleDate.trim()) {
      parts.push(`dated ${facts.articleDate}`);
    }
    if (facts.publisher && facts.publisher.trim()) {
      parts.push(`issued by ${facts.publisher}`);
    }
    return parts.length > 0 ? ` (${parts.join(', ')})` : '';
  };

  const buildEventClause = () => {
    if (facts.specificEvent && facts.specificEvent.trim()) {
      return ` Specifically, this article documents: ${facts.specificEvent}.`;
    }
    return '';
  };

  const buildTargetActionClause = () => {
    if (facts.targetActionInArticle && facts.targetActionInArticle.trim()) {
      return ` The target's role here is: ${facts.targetActionInArticle}.`;
    }
    return '';
  };

  const contextClause = buildContextClause();
  const eventClause = buildEventClause();
  const actionClause = buildTargetActionClause();

  // ── RULE 6 — No wrongdoing OR out of ML/TF scope → IRRELEVANT
  if (!facts.wrongdoingDescribed || !facts.wrongdoingInMLTFScope) {
    const scopeNote = facts.wrongdoingDescribed
      ? ` The article describes ${wrongdoingText[facts.wrongdoingType] || 'a matter'}, which is outside ML/TF scope.`
      : ' The article does not describe any wrongdoing concerning the target.';
    return {
      cls: 'IRRELEVANT_MLTF',
      reason: `${irrelevantLabel}, because ${genreText[facts.articleGenre]}${contextClause} and the screened target appears in the role of ${roleText[facts.targetRole] || 'a connected party'}.${actionClause}${eventClause}${scopeNote}${suffix}`,
      riskCat: 'N/A',
      identityMatch: 'PARTIAL_MATCH',
      actualSubjectName: '',
      _factsConfidence: facts.factsConfidence,
    };
  }

  // ── RULE 7 — ML/TF wrongdoing exists but target NOT the subject → IRRELEVANT
  if (facts.targetRole !== 'subject') {
    const subjectClause = facts.actualSubjectName && facts.actualSubjectName.trim()
      ? ` The actual subject of the wrongdoing is "${facts.actualSubjectName}", not the screened target.`
      : '';
    return {
      cls: 'IRRELEVANT_MLTF',
      reason: `${irrelevantLabel}, because although the article${contextClause} describes ${wrongdoingText[facts.wrongdoingType] || 'wrongdoing'}, the screened target "${targetName}" appears only as ${roleText[facts.targetRole] || 'a connected party'}.${actionClause}${eventClause}${subjectClause}${suffix}`,
      riskCat: facts.actualSubjectName ? `N/A (Subject = ${facts.actualSubjectName})` : 'N/A',
      identityMatch: 'PARTIAL_MATCH',
      actualSubjectName: facts.actualSubjectName || '',
      _factsConfidence: facts.factsConfidence,
    };
  }

  // ── RULE 8 — TRUE_HIT: target IS subject of in-scope wrongdoing
  const ev = facts.evidenceQuote && facts.evidenceQuote.trim()
    ? ` Evidence from the article: "${facts.evidenceQuote}".`
    : '';
  return {
    cls: 'TRUE_HIT',
    reason: `True Hit, because the screened target "${targetName}" is the direct subject of ${wrongdoingText[facts.wrongdoingType] || 'wrongdoing'} described in this article${contextClause}.${actionClause}${eventClause}${ev}`,
    riskCat: mapRiskCat(),
    identityMatch: 'FULL_MATCH',
    actualSubjectName: '',
    _factsConfidence: facts.factsConfidence,
  };
}
/* ════════════════════════════════════════════════════════════════
   END TWO-PASS ARCHITECTURE
   ════════════════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════════════════════
   🆕 FIX A — JS-LEVEL NAME-TOKEN OVERRIDE
   
   Hard rule (user requirement):
     If all target name tokens literally appear in the article body
     (case/hyphen/comma/space-insensitive), the result CANNOT be
     FALSE_HIT. The AI sometimes returns targetMentioned=false even
     when the snippet clearly shows "KWOK Kai-fai, Adam" — this
     override patches that failure deterministically.
   ════════════════════════════════════════════════════════════════ */

function tokenizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')   // strip punctuation (hyphens, commas, etc.)
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

function preCheckTargetMentioned(facts, targetName, body) {
  if (!facts || !targetName || !body) return facts;

  const targetTokens = tokenizeName(targetName);
  if (targetTokens.length < 2) return facts;     // need ≥2 tokens to be meaningful

  const bodyLc = String(body)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');          // normalise punctuation in body too

  const allTokensPresent = targetTokens.every(tok => bodyLc.includes(tok));

  // CASE 1 — AI said "not mentioned" / ABSENT but tokens ARE present → OVERRIDE
  if (allTokensPresent && (!facts.targetMentioned || facts.nameMatch === 'ABSENT' || facts.targetRole === 'not_present')) {
    console.log(`🔧 FIX A: Overriding targetMentioned=false → true (all ${targetTokens.length} tokens [${targetTokens.join(', ')}] present in body)`);
    return {
      ...facts,
      targetMentioned: true,
      nameMatch: 'EXACT',
      nameInArticle: facts.nameInArticle || targetName,
      targetRole: facts.targetRole === 'not_present' ? 'passing_mention' : (facts.targetRole || 'passing_mention'),
      nameMatchReason: `JS-level token-equivalence override: all ${targetTokens.length} target name tokens (${targetTokens.join(', ')}) literally appear in the article body. ${facts.nameMatchReason || ''}`.trim(),
    };
  }

  // CASE 2 — AI flagged SUPERSET/DIFFERENT but ALL tokens of the target are still present
  //          → at minimum, prevent FALSE_HIT (downgrade to EXACT match, let Rule 6/7 take it to IRRELEVANT)
  if (allTokensPresent && (facts.nameMatch === 'SUPERSET' || facts.nameMatch === 'DIFFERENT')) {
    console.log(`🔧 FIX A: Overriding nameMatch=${facts.nameMatch} → EXACT (all target tokens present; strict rule forbids FALSE_HIT)`);
    return {
      ...facts,
      targetMentioned: true,
      nameMatch: 'EXACT',
      nameMatchReason: `JS-level token-equivalence override: although AI flagged ${facts.nameMatch}, all ${targetTokens.length} target name tokens (${targetTokens.join(', ')}) are literally present in the body, so this CANNOT be a False Hit. ${facts.nameMatchReason || ''}`.trim(),
    };
  }

  return facts;
}


/* ════════════════════════════════════════════════════════════════
   🆕 GATE 3 — JS METADATA EXTRACTION (replaces AI-extracted
   publisher / articleDate / specificEvent)

   Why JS not AI:
   • AI sometimes imports facts from sibling blocks (e.g. result #9
     borrowed "ICAC bail" content from #10) → cross-block contamination.
   • JS sees ONE block + ONE url at a time → contamination is
     STRUCTURALLY IMPOSSIBLE.
   ════════════════════════════════════════════════════════════════ */

const PUBLISHER_DOMAIN_MAP = {
  'hkexnews.hk': 'HKEXnews',
  'di.hkex.com.hk': 'HKEX (Disclosure of Interests)',
  'hkex.com.hk': 'HKEX',
  'sec.gov': 'SEC.gov',
  'shkp.com': 'Sun Hung Kai Properties',
  'etnet.com.hk': 'etnet 經濟通',
  'marketscreener.com': 'MarketScreener',
  'ifastgm.com.sg': 'iFAST Global Markets',
  'reuters.com': 'Reuters',
  'bloomberg.com': 'Bloomberg',
  'ft.com': 'Financial Times',
  'wsj.com': 'Wall Street Journal',
  'scmp.com': 'South China Morning Post',
  'mingpao.com': '明報',
  'hkej.com': '信報財經新聞',
  'on.cc': '東網',
  'singtao.com': '星島日報',
  'rthk.hk': 'RTHK',
  'now.com': 'Now News',
  'hk01.com': 'HK01',
};

function extractBlockMetadata(block, url) {
  const result = { publisher: '', articleDate: '' };

  // ── Publisher: from URL hostname (deterministic) ──
  if (url) {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase().replace(/^www\d*\./, '');
      for (const [domain, name] of Object.entries(PUBLISHER_DOMAIN_MAP)) {
        if (host === domain || host.endsWith('.' + domain)) {
          result.publisher = name;
          break;
        }
      }
      if (!result.publisher) result.publisher = host;
    } catch {}
  }

  // ── PATCH ⑤: articleDate — full-block scan + priority + future filter ──
  if (block && typeof block === 'string') {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const candidates = [];
    let m;

    // Priority 0 (highest) — Chinese YYYY年M月D日
    const zhRe = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
    while ((m = zhRe.exec(block)) !== null) {
      candidates.push({ y: +m[1], mo: +m[2], d: +m[3], pos: m.index, fmt: 0, raw: m[0] });
    }

    // Priority 1 — English "Mon DD, YYYY"
    const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const enRe = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/gi;
    while ((m = enRe.exec(block)) !== null) {
      candidates.push({ y: +m[3], mo: MONTHS[m[1].toLowerCase().slice(0,3)], d: +m[2], pos: m.index, fmt: 1, raw: m[0] });
    }

    // Priority 1 (same as English) — English "DD Mon YYYY"
    const enRe2 = /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(20\d{2})\b/gi;
    while ((m = enRe2.exec(block)) !== null) {
      candidates.push({ y: +m[3], mo: MONTHS[m[2].toLowerCase().slice(0,3)], d: +m[1], pos: m.index, fmt: 1, raw: m[0] });
    }

    // Priority 2 (lowest) — ISO YYYY-MM-DD / YYYY/MM/DD (PDF gen-stamps use this)
    const isoRe = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/g;
    while ((m = isoRe.exec(block)) !== null) {
      candidates.push({ y: +m[1], mo: +m[2], d: +m[3], pos: m.index, fmt: 2, raw: m[0] });
    }

    // Validate + filter future dates
    const valid = candidates.filter(c => {
      if (c.mo < 1 || c.mo > 12 || c.d < 1 || c.d > 31) return false;
      const dt = new Date(c.y, c.mo - 1, c.d);
      if (isNaN(dt.getTime())) return false;
      if (dt > today) {
        console.log(`  🗓️  Patch ⑤ filtered future date: ${c.raw}`);
        return false;
      }
      return true;
    });

    if (valid.length > 0) {
      // Sort: format priority first, then earliest position in block
      valid.sort((a, b) => (a.fmt - b.fmt) || (a.pos - b.pos));
      const pick = valid[0];
      result.articleDate = `${pick.y}-${String(pick.mo).padStart(2,'0')}-${String(pick.d).padStart(2,'0')}`;
    }
  }

  return result;
}

// ============================================================================
// PATCH ⑥ — Block-isolation verify (anti-hallucination)
// ============================================================================
function _normalizeForMatch(s) {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s\-_.,'"·、,。:;()\[\]【】]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
}

function verifyFactsAgainstBlock(facts, blockText, rank) {
  if (!facts || !facts.actualSubjectName) return facts;

  const normBlock = _normalizeForMatch(blockText);
  const normName  = _normalizeForMatch(facts.actualSubjectName);
  if (!normName) return facts;

  // (a) Direct substring match
  if (normBlock.includes(normName)) return facts;

  // (b) Multi-token fallback
  const tokens = facts.actualSubjectName
    .split(/[\s\-]+/)
    .map(_normalizeForMatch)
    .filter(t => t.length >= 2);

  if (tokens.length >= 2 && tokens.every(t => normBlock.includes(t))) {
    return facts;
  }

  // FAIL → hallucination, clear it
  console.warn(
    `🚨 Patch ⑥ HALLUCINATION rank ${rank}: "${facts.actualSubjectName}" ` +
    `not in block — clearing actualSubjectName + wrongdoingType`
  );
  facts.actualSubjectName     = "";
  facts.wrongdoingType        = "";
  facts._hallucinationCleared = true;
  return facts;
}


function buildDeterministicSpecificEvent({ articleDate, publisher, targetActionInArticle, wrongdoingDescribed, wrongdoingType }) {
  const parts = [];
  if (articleDate && articleDate !== 'unknown') parts.push(articleDate);
  if (publisher) parts.push(publisher);

  const action = (targetActionInArticle || '').trim();
  if (action) {
    parts.push(`records target as: ${action}`);
  } else if (wrongdoingDescribed) {
    const w = (wrongdoingType && wrongdoingType !== 'none' && wrongdoingType !== 'other')
      ? wrongdoingType.replace(/_/g, ' ')
      : 'a matter';
    parts.push(`mentions ${w} in context of the target`);
  } else {
    parts.push('document referencing the target');
  }

  return parts.join(' — ');
}

/* ════════════════════════════════════════════════════════════════
   END GATE 3
   ════════════════════════════════════════════════════════════════ */


/* ========== GENERIC SCREENING COMPONENT (shared by Adverse Media & Sanction) ========== */

function ScreeningModule({ entityName: initialEntityName, mode, onFlagSTR }) {
  const isAdverseMedia = mode === 'adverseMedia';
  const isSanction = mode === 'sanction';
  // 🆕 Mode-aware terminology constants
const IRRELEVANT_LABEL = isSanction ? 'Irrelevant sanction' : 'Irrelevant ML/TF';
const IRRELEVANT_SUFFIX = isSanction ? 'There is no sanctions violations.' : 'There is no ML/TF negative news.';
const IRRELEVANT_SUFFIX_REGEX = isSanction ? /no\s+sanctions\s+violations/i : /no\s+ML\/TF\s+negative\s+news/i;

// 🆕 Component-local clsConfig — overrides CLS_CONFIG for UI label only
const clsConfig = useMemo(() => ({
  TRUE_HIT: CLS_CONFIG.TRUE_HIT,
  FALSE_HIT: CLS_CONFIG.FALSE_HIT,
  IRRELEVANT_MLTF: {
    ...CLS_CONFIG.IRRELEVANT_MLTF,
    label: IRRELEVANT_LABEL,
    desc: isSanction
      ? 'Name matches the target BUT no sanctions content concerning the target. Per CDD rule, no need to fully verify identity when there is no sanctions content.'
      : CLS_CONFIG.IRRELEVANT_MLTF.desc,
  },
  NO_HIT: CLS_CONFIG.NO_HIT,
}), [isSanction]);
  const SESSION_KEY = `${mode}_state_${initialEntityName || 'default'}`;

  const _loadSession = () => {
    try { const s = sessionStorage.getItem(SESSION_KEY); if (s) return JSON.parse(s); } catch {}
    return null;
  };
  const _saved = _loadSession();

  const [activeTab, setActiveTab] = useState('demo');
  const [searchEntity, setSearchEntity] = useState(_saved?.searchEntity || initialEntityName || 'ABC Holdings Ltd');
  const [pdfFile, setPdfFile] = useState(null);
  const [apiKey, setApiKey] = useState(_saved?.apiKey || '');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(_saved?.analysisComplete || false);
  const [results, setResults] = useState(_saved?.results || []);
  const [expandedId, setExpandedId] = useState(null);
  const [filterType, setFilterType] = useState(_saved?.filterType || 'ALL');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [showQuery, setShowQuery] = useState(false);
  const [detectedLang, setDetectedLang] = useState(_saved?.detectedLang || 'en');
  const [errorMsg, setErrorMsg] = useState('');
  const [sanctionPart, setSanctionPart] = useState('part1');
  const [workerStatus, setWorkerStatus] = useState('');
  const [copied, setCopied] = useState(false);
  const [entityContext, setEntityContext] = useState({ dob: '', nationality: '', gender: '', company: '', idNumber: '', address: '', notes: '' });
  const handleExtraChange = (field, value) => { setEntityContext(prev => ({ ...prev, [field]: value })); };

  React.useEffect(() => {
    if (analysisComplete && results.length > 0) {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
          results, searchEntity, analysisComplete, detectedLang, filterType, apiKey,
        }));
      } catch {}
    }
  }, [results, analysisComplete, detectedLang, filterType, searchEntity, apiKey]);

  const timerIdsRef = React.useRef([]);
  const clearAllTimers = () => { timerIdsRef.current.forEach(id => clearTimeout(id)); timerIdsRef.current = []; };
  React.useEffect(() => { return () => clearAllTimers(); }, []);

  const buildQuery = isSanction ? buildSanctionQueryAuto : buildQueryAuto;
  const sanctionLang = isSanction ? detectLanguageDetail(searchEntity) : null;
  const sanctionParts = isSanction ? getSanctionKeywordsByPart(sanctionLang || 'en') : null;
  // 🆕 Adverse Media 嘅 full lang(en / zh_tw / zh_cn)
  const adverseLang = isAdverseMedia ? detectLanguageDetail(searchEntity) : null;
  const adverseKeywords = isAdverseMedia
  ? (adverseLang === 'zh_cn' ? ZH_KEYWORDS_CN : adverseLang === 'zh_tw' ? ZH_KEYWORDS_TW : EN_KEYWORDS)
  : null;
  const currentKeywordsEN = EN_KEYWORDS;          // adverse media 用
  const currentKeywordsZH = ZH_KEYWORDS;          // adverse media 用
  const mockEN = isSanction ? SANCTION_MOCK_EN : MOCK_EN;
  const mockZH = isSanction ? SANCTION_MOCK_ZH : MOCK_ZH;


  const moduleTitle = isSanction ? 'Sanction Screening' : 'Adverse Media Screening';
  const moduleSubtitle = isSanction
    ? '🛡️ 自動語言檢測 | 手動 Google 搜尋 → PDF 上傳 → 📰 網頁全文抓取 → AI 制裁名單分類'
    : '🔍 自動語言檢測 | 手動 Google 搜尋 → PDF 上傳 → 📰 網頁全文抓取 → AI 分類';
  const moduleIcon = isSanction ? <Shield className="w-5 h-5 text-orange-300" /> : <Shield className="w-5 h-5" />;
  const headerBg = isSanction ? 'bg-orange-800' : 'bg-slate-800';

  const searchQuery = isSanction
    ? buildSanctionQueryForPart(searchEntity, sanctionPart).query
    : buildQueryAuto(searchEntity).query;
  const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
  // 制裁篩查 3 Parts 的 URL
  const sanctionPartUrls = isSanction ? {
    part1: `https://www.google.com/search?q=${encodeURIComponent(buildSanctionQueryForPart(searchEntity, 'part1').query)}`,
    part2: `https://www.google.com/search?q=${encodeURIComponent(buildSanctionQueryForPart(searchEntity, 'part2').query)}`,
    part3: `https://www.google.com/search?q=${encodeURIComponent(buildSanctionQueryForPart(searchEntity, 'part3').query)}`,
  } : null;

  const callWorker = async (path, body) => {
  const cleanPath = path.replace(/^\/api/, '');
  const resp = await fetch(`/api${cleanPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
};

const fetchPageContent = async (url) => {
  try {
    const data = await callWorker('/api/scrape', { url, maxLength: 12000 });
    return data.text || null;
  } catch { return null; }
};
  
const resolveBreadcrumb = async ({ domain, pathHint, title }) => {
  try {
    const data = await callWorker('/api/resolve', { domain, pathHint, title });
    return {
      url: data.url || null,
      query: data.query || '',
      error: data.error || null,
    };
  } catch (e) {
    return { url: null, query: '', error: e.message };
  }
};

/**
 * 🆕 Fix 3: Poe Web-Search bot pre-search enrichment
 * 仿真 Poe Chat 嘅 auto-browsing 行為 —
 * 喺主分析之前先用 Poe 嘅 dedicated Web-Search bot 搜集 entity 背景,
 * 包括中文名、role、listed company affiliation 等。
 *
 * 重要:只用真正有 web search capability 嘅 bot,
 *      絕對唔 fall back 去 model training data(防止 hallucination)。
 *      如果 Web-Search bot 失敗(plan 唔包 / quota 用完 / 等等),
 *      就 silently skip,主分析 flow 唔受影響。
 */
const enrichWithPoeWebSearch = async (entityName, apiKeyVal, knownInfo) => {
  if (!entityName || !apiKeyVal) return null;

  const knownInfoStr = knownInfo && Object.values(knownInfo).some(v => v && String(v).trim())
    ? formatEntityContext(knownInfo)
    : '';

  const searchPrompt = `Search the web for FACTUAL information about this entity for KYC/AML screening:

ENTITY: "${entityName}"
${knownInfoStr ? `\nKYC team context:\n${knownInfoStr}\n` : ''}
Find specifically (only state what is verifiable from public sources):
1. Chinese name(s) / 中文姓名 / aliases / romanization variants
2. Current and past roles (director / CEO / shareholder of which company)
3. Listed company affiliations (HKEX / SSE / SGX / NASDAQ etc.) with stock codes if known
4. Jurisdictions of operation
5. Any publicly reported regulatory enforcement or legal proceedings (facts only, no speculation)

Constraints:
- Maximum 400 words.
- Stick strictly to verifiable public information. NEVER fabricate.
- If web search returns NOTHING relevant or you have no factual data, output ONLY: "NO_BACKGROUND_AVAILABLE"
- Cite source URLs at the end.`;

  try {
    const res = await fetch('https://api.poe.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKeyVal.trim()}`,
      },
      body: JSON.stringify({
        model: 'Web-Search',
        messages: [
          { role: 'user', content: searchPrompt }
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    if (!res.ok) {
      console.warn(`⚠️ Poe Web-Search HTTP ${res.status} — bot may not be available, skipping`);
      return null;
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';

    if (!text || text.length < 80 || text.includes('NO_BACKGROUND_AVAILABLE')) {
      console.log(`⏭️ Poe Web-Search returned no useful background (${text.length} chars)`);
      return null;
    }

    console.log(`✅ Poe Web-Search pre-search succeeded (${text.length} chars of context)`);
    return text;
  } catch (e) {
    console.warn(`⚠️ Poe Web-Search exception (skipping):`, e.message);
    return null;
  }
};

  
  const extractUrlsFromPdf = (pdfText) => {
  const urlRegex = /https?:\/\/[^\s)>\]"'›\n]+/g;
  const rawUrls = pdfText.match(urlRegex) || [];

  const skipped = [];
  const kept = [];

  for (const raw of rawUrls) {
    // 1. 清掉尾巴標點
    let u = raw.replace(/[.,;:!?)\]>'"›]+$/, '');

    // 2. 跳過 Google 基礎設施
    if (
      u.includes('google.com') ||
      u.includes('googleapis.com') ||
      u.includes('gstatic.com') ||
      u.includes('schema.org') ||
      u.includes('accounts.google')
    ) {
      skipped.push({ url: u, reason: 'google-infra' });
      continue;
    }

    // 3. 跳過「光禿域名」(沒有 path,scrape 回來只會是首頁廢料)
    try {
      const parsed = new URL(u);
      const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
      // path 少於 3 個字元 = 基本上是首頁(例如 "/", "/zh", "/news")
      if (path.length < 4) {
        skipped.push({ url: u, reason: 'no-article-path' });
        continue;
      }
    } catch {
      skipped.push({ url: u, reason: 'invalid-url' });
      continue;
    }

    // 4. 去重
    if (!kept.includes(u)) kept.push(u);
  }

  // 5. Log 供 debug
  if (skipped.length > 0) {
    console.log(`⏭️ Skipped ${skipped.length} unscrapable URL(s):`);
    skipped.forEach(s => console.log(`   [${s.reason}] ${s.url}`));
  }
  console.log(`✅ Kept ${kept.length} scrapable URL(s) with article paths`);

  return kept.slice(0, 10);
};

/**
 * F.6: Try to reconstruct article URLs from Google breadcrumb format.
 * Google PDF shows: "reuters.com › energy › pe..."
 * We can ask the Worker to resolve this to the real article URL via search.
 */
const reconstructUrlsFromAnchors = (resultUrls) => {
  // ⭐ Same helper as in extractResultAnchors (keeps publisher prefix out of resolve query)
  const stripPublisherPrefix = (line) => {
    if (!line) return '';
    const s = String(line).trim();
    const urlIdx = s.search(/https?:\/\//);
    if (urlIdx > 0) return s.slice(urlIdx).trim();
    if (urlIdx === 0) return s;
    const domMatch = s.match(/\b([a-z0-9][a-z0-9-]*\.[a-z][a-z0-9.-]*[a-z0-9])\b/i);
    if (domMatch) {
      const idx = s.indexOf(domMatch[0]);
      return s.slice(idx).trim();
    }
    return s;
  };

  const reconstructed = [];

  for (const anchor of resultUrls) {
    const cleaned = stripPublisherPrefix(anchor);   // ⭐ 第一步:去掉 "每日頭條 · " 之類前綴

    // Case 1: 已經係真實 URL with path
    if (cleaned.startsWith('http')) {
      try {
        const urlPart = cleaned.split(/\s/)[0];     // ⭐ 取 URL,唔包之後嘅 breadcrumb
        const parsed = new URL(urlPart);
        const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
        if (path.length >= 3) {
          reconstructed.push({
            kind: 'full_url',
            url: parsed.toString(),
            original: anchor,
          });
          continue;
        }
      } catch {}
    }

    // Case 2: Breadcrumb format
    if (cleaned.includes('›')) {
      const parts = cleaned.split(/\s*›\s*/).map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const domain = parts[0]
          .replace(/^https?:\/\//, '')     // ⭐ 而家會 work,因為 cleaned 已去 publisher
          .replace(/^www\./, '');
        const pathHint = parts.slice(1)
          .map(p => p.replace(/\.{2,}/g, '').trim())
          .filter(p => p.length > 0);
        reconstructed.push({
          kind: 'breadcrumb',
          domain,
          pathHint,
          original: anchor,
        });
        continue;
      }
    }

    // Case 3: Social platform marker (Facebook · Page Name)
    if (anchor.includes('·')) {
      reconstructed.push({ kind: 'social', original: anchor });
    }
  }

  return reconstructed;
};
  
const testWorkerConnection = async () => {
  setWorkerStatus('');
  try {
    const r = await fetch('/api/health');
    const d = await r.json();
    setWorkerStatus(d.ok
      ? `✅ 連線成功 | 路由: ${d.routes?.join(', ') || 'N/A'}`
      : '❌ 回應異常');
  } catch (e) { setWorkerStatus(`❌ ${e.message}`); }
};

  const handlePdfUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') { setPdfFile(file); setErrorMsg(''); }
    else if (file) setErrorMsg('請上傳 PDF 格式文件（.pdf）');
  };


 const runAnalysis = async () => {
    if (!pdfFile) { setErrorMsg('請先上傳搜尋結果 PDF 文件'); return; }
    if (!apiKey.trim()) { setErrorMsg('請輸入 POE API Key'); return; }
    clearAllTimers();
    setIsAnalyzing(true); setAnalysisComplete(false); setResults([]);
    setProgress(0); setErrorMsg(''); setFilterType('ALL'); setExpandedId(null);
    const lang = detectLanguage(searchEntity);
    setDetectedLang(lang);
    try {
      setProgress(20); setStage('正在讀取 PDF 文件...');
      await new Promise((resolve, reject) => {
        if (window.pdfjsLib) return resolve();
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; resolve(); };
        s.onerror = () => reject(new Error('無法載入 PDF.js'));
        document.head.appendChild(s);
      });
      const arrayBuf = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = ev => resolve(ev.target.result);
        reader.onerror = () => reject(new Error('無法讀取 PDF'));
        reader.readAsArrayBuffer(pdfFile);
      });
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuf }).promise;
      let pdfText = '';

     const embeddedUrls = new Set();   // 集中存所有 PDF embedded hyperlinks

// ============================================================
// 📄 INPUT CONTRACT: One upload = ONE logical Google SERP page (10 results).
//    Chrome's "Save as PDF" may auto-split that ONE logical page into
//    multiple PDF physical pages because of A4/Letter print-height limit.
//    We MUST concatenate them ALL into ONE text blob, with NO synthetic
//    "PAGE BREAK" markers — otherwise extractResultAnchors() and the AI
//    prompt would mis-read the marker as a real result boundary.
// ============================================================
console.log(`📄 PDF has ${pdf.numPages} physical page(s) — treating as ONE logical SERP page`);

for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const content = await page.getTextContent();
  let lastY = null;
  let pageText = '';
  for (const item of content.items) {
    if (!item.str || !item.str.trim()) continue;
    const y = item.transform ? item.transform[5] : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) {
      pageText += '\n';
    }
    pageText += item.str + ' ';
    lastY = y;
  }

  // 抽取 PDF 內嵌嘅 hyperlink annotations(真正可按嘅 URL)
 try {
    const annotations = await page.getAnnotations();

    // 🔒 Comprehensive Google infrastructure URL filter
    //    Catches: /search, /webhp, /intl, /maps, /preferences, /policies, /about,
    //             support.google.*, policies.google.*, maps.google.*,
    //             accounts.google.*, translate.google.*, adservice.google.*,
    //             googleusercontent, googleadservices, gstatic, googleapis,
    //             bare google.com / google.co.xx / google.com.xx homepages
    const isGoogleInfra = (raw) => {
      const lc = String(raw).toLowerCase();

      // Hard-coded infra hosts / CDN
      if (lc.includes('googleusercontent')) return true;
      if (lc.includes('googleadservices')) return true;
      if (lc.includes('gstatic.com')) return true;
      if (lc.includes('googleapis.com')) return true;

      // Google subdomains that are NEVER article hosts
      if (/^https?:\/\/(support|policies|accounts|maps|translate|adservice|imghp|ads|tagmanager|analytics)\.google\./.test(lc)) return true;

      // Google search engine pages: /search, /webhp, /imghp, /maps,
      // /intl, /preferences, /advanced_search, /policies, /about,
      // /tools, /imgres, /setprefs, /finance, /url
      if (/\/\/(www\.)?google\.[a-z][a-z.]+\/(search|webhp|preferences|advanced_search|intl|imghp|finance|policies|about|maps|tools|imgres|setprefs|url)\b/.test(lc)) return true;

      // Bare google.com / google.co.xx / google.com.xx (homepage or with query only)
      if (/^https?:\/\/(www\.)?google\.[a-z][a-z.]+\/?(\?|$)/.test(lc)) return true;

      return false;
    };

    for (const ann of annotations) {
      if (ann.subtype === 'Link' && ann.url) {
        const u = ann.url;
        if (u.startsWith('http') && !isGoogleInfra(u)) {
          embeddedUrls.add(u);
        }
      }
    }
  } catch (annErr) {
    console.warn(`Page ${i}: failed to read annotations`, annErr);
  }
  // ⚠️ NO "--- PAGE BREAK ---" marker — Chrome physical pages are NOT
  //    logical boundaries. Just join with a single newline so the text
  //    flows continuously as ONE SERP page.
  pdfText += pageText + '\n';
}

console.log(`📄 Merged PDF text length: ${pdfText.length} chars (single logical SERP page)`);
// 📋 Log only — DO NOT inject embedded URLs into pdfText.
//    Injecting them would cause extractResultAnchors() PASS 2 to re-pick
//    them up alongside the breadcrumb anchors from PASS 1a/1b, producing
//    duplicate entries (one Google result counted as TWO anchors).
if (embeddedUrls.size > 0) {
  console.log(`🔗 Extracted ${embeddedUrls.size} embedded hyperlink(s) from PDF annotations:`);
  [...embeddedUrls].forEach((u, i) => console.log(`  [${String(i+1).padStart(2,'0')}] ${u}`));
} else {
  console.warn('⚠️ No embedded hyperlinks found in PDF annotations. Will fall back to breadcrumb extraction.');
}
      if (!pdfText.trim()) throw new Error('PDF 無法提取文字（可能是掃描圖片格式）');

      /* ★ 修正 2：清理 Google PDF 噪音（AI 概覽、UI 元素、引號搜尋等） */
      /* ★ 修正 2:清理 Google PDF 噪音(AI 概覽、UI 元素、引號搜尋等) */
pdfText = cleanGooglePdfText(pdfText);


const extractResultAnchors = (text) => {
  const skipPatterns = [
    'google.com/search', 'googleapis.com', 'gstatic.com',
    'accounts.google', 'schema.org', 'translate.google',
    'support.google', 'policies.google', 'maps.google',
  ];
  const shouldSkip = (s) => {
    const lower = s.toLowerCase();
    return skipPatterns.some(p => lower.includes(p));
  };

  const stripPublisherPrefix = (line) => {
    if (!line) return '';
    const s = String(line).trim();
    const urlIdx = s.search(/https?:\/\//);
    if (urlIdx > 0) return s.slice(urlIdx).trim();
    if (urlIdx === 0) return s;
    const domMatch = s.match(/\b([a-z0-9][a-z0-9-]*\.[a-z][a-z0-9.-]*[a-z0-9])\b/i);
    if (domMatch) {
      const idx = s.indexOf(domMatch[0]);
      return s.slice(idx).trim();
    }
    return s;
  };

  const sigOf = (line) => {
    const stripped = stripPublisherPrefix(line);
    const lc = stripped.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
    const dm = lc.match(/^([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+)/);
    const domain = dm ? dm[1] : '';

    let articleKey = '';
    if (stripped.includes('›')) {
      const segs = stripped.split(/\s*›\s*/).map(s => s.trim()).filter(Boolean);
      if (segs.length >= 2) articleKey = segs.slice(1).join('/').slice(0, 60);
    } else {
      const urlMatch = stripped.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        try {
          const u = new URL(urlMatch[0]);
          articleKey = u.pathname.replace(/^\/+|\/+$/g, '').slice(0, 60);
        } catch {}
      }
    }

    if (domain && articleKey) return `${domain}|${articleKey}`;
    if (domain) return domain;
    return stripped.slice(0, 50).toLowerCase();
  };

  // ⭐ FIX (NEW): sigMap value 由 string → { text, lineIdx } 用嚟保留 PDF 原始順序
  const sigMap = new Map(); const baseSigsSeen = new Set();   // ⭐ NEW: 跨 PASS dedup,只記 baseSig(冇 titleHint)

  // ═══════════════════════════════════════════════════════
  // 🥇 PASS 1a: Line-based breadcrumb detection
  // ═══════════════════════════════════════════════════════
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length < 8 || trimmed.length > 220) continue;
    if (!trimmed.includes('›')) continue;
    if (shouldSkip(trimmed)) continue;
    if (!/[a-z0-9][a-z0-9-]*\.[a-z]{2,}/i.test(trimmed)) continue;

    let titleHint = '';
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const prev = lines[j].trim();
      if (!prev) continue;
      if (prev.includes('›')) break;
      if (/^https?:\/\//i.test(prev)) continue;
      if (/^\d+\s*[頁页]$/.test(prev)) continue;
      if (/^PDF$/i.test(prev)) continue;
      if (/^\d{4}年\d+月\d+日\s*—/.test(prev)) continue;
      if (prev.length >= 5 && prev.length <= 200) {
        titleHint = prev.slice(0, 80).toLowerCase();
        break;
      }
    }

    const baseSig = sigOf(trimmed);
const candidateSig = titleHint ? `${baseSig}#${titleHint}` : baseSig;

// ⭐ FIX A: 同 PASS 內真重複 → SKIP(取消 occ counter,因為 PDF OCR 同一行偶爾會被 PDF.js split 出 2 次)
if (sigMap.has(candidateSig)) {
  console.log(`⏭️ Skip exact duplicate (PASS 1a): ${trimmed.slice(0, 80)}`);
  continue;
}

sigMap.set(candidateSig, { text: trimmed, lineIdx: i });
baseSigsSeen.add(baseSig); 
 }

  // ═══════════════════════════════════════════════════════
  // 🥇 PASS 1b: Regex-based scan
  // ═══════════════════════════════════════════════════════
  const breadcrumbPatternRegex = /([^·\n]{1,40}?)\s*[·•]\s*((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,3})((?:\s*›\s*[^›\n]{1,60}){1,5})/gi;
  const compactText = text.replace(/[ \t]+/g, ' ');
  let bcMatch;
  while ((bcMatch = breadcrumbPatternRegex.exec(compactText)) !== null) {
    const fullMatch = bcMatch[0].replace(/\s+/g, ' ').trim();
    if (fullMatch.length < 8 || fullMatch.length > 250) continue;
    if (shouldSkip(fullMatch)) continue;
    const sig = sigOf(fullMatch);

// ⭐ FIX C: 用 baseSigsSeen 而唔係 sigMap 嚟 check
//    原因:PASS 1a 嘅 key 係 `baseSig#titleHint`,sigMap.has(baseSig) 永遠係 false,
//          所以舊版 PASS 1b 會將 PASS 1a 已經抽過嘅 entry 再加一次。
if (baseSigsSeen.has(sig)) {
  console.log(`⏭️ Skip — already covered by PASS 1a: ${fullMatch.slice(0, 80)}`);
  continue;
}

const lineIdx = compactText.slice(0, bcMatch.index).split('\n').length - 1;
sigMap.set(sig, { text: fullMatch, lineIdx });
baseSigsSeen.add(sig);
console.log(`🔍 Regex-pass caught (genuinely new): ${fullMatch}`);
  }

  // Track domains 俾 Pass 2 用
  const breadcrumbDomains = new Set();
  [...sigMap.keys()].forEach(sig => {
    const d = sig.split('|')[0];
    if (/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) {
      breadcrumbDomains.add(d);
    }
  });

  // ═══════════════════════════════════════════════════════
  // 🥈 PASS 2: Full URLs
  // ═══════════════════════════════════════════════════════
  // ⭐ FIX: 由 .match() 改為 .exec() loop,先攞到每個 match 嘅 char offset
  const fullUrlPattern = /https?:\/\/[^\s)>\]"'›\n]+/g;
  let urlMatch;
  while ((urlMatch = fullUrlPattern.exec(text)) !== null) {
    const raw = urlMatch[0];
    const cleaned = raw.replace(/[.,;:!?)\]>'"]+$/, '');
    if (cleaned.length <= 15 || shouldSkip(cleaned)) continue;
    const m = cleaned.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .match(/^([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+)/);
    const domain = m ? m[1] : '';
    const hasPath = /https?:\/\/[^\s\/]+\/[^\s]/.test(cleaned);
    if (breadcrumbDomains.has(domain) && !hasPath) continue;
    const sig = sigOf(cleaned);
// ⭐ FIX 改動 4: 跨 PASS dedup,防止 PASS 1a 已抽嘅 entry 喺 PASS 2 再加一次
if (baseSigsSeen.has(sig)) continue;     // ← while loop 用 continue
if (sigMap.has(sig)) continue;
const lineIdx = text.slice(0, urlMatch.index).split('\n').length - 1;
sigMap.set(sig, { text: cleaned, lineIdx });
baseSigsSeen.add(sig);
  }

  // ═══════════════════════════════════════════════════════
  // 🥉 PASS 3: Social platforms
  // ═══════════════════════════════════════════════════════
  const socialPlatforms = [
    'Facebook', 'Twitter', 'YouTube', 'TikTok', 'Instagram',
    'LinkedIn', 'Reddit', 'Threads', 'Quora', 'Medium',
    'Pinterest', 'Weibo', '微博', '小紅書', '抖音', 'Telegram',
  ];
  const socialRegex = new RegExp(
    `\\b(${socialPlatforms.join('|')})\\s*·\\s*([^\\n·]{2,80})`,
    'gi'
  );
  const socialLines = text.split('\n');
  for (let i = 0; i < socialLines.length; i++) {
    const trimmed = socialLines[i].trim();
    if (trimmed.length < 8 || trimmed.length > 250) continue;
    if (/https?:\/\//.test(trimmed) || trimmed.includes('›')) continue;
    if (shouldSkip(trimmed)) continue;
    const matches = trimmed.match(socialRegex);
    if (!matches) continue;

    for (const m of matches) {
      const normalized = m.replace(/\s+/g, ' ').trim();
      const baseSig = 'social:' + normalized.toLowerCase().slice(0, 80);

      let titleHint = '';
      const matchIdx = trimmed.indexOf(m);
      if (matchIdx > 5) {
        titleHint = trimmed.slice(0, matchIdx).trim().toLowerCase().slice(0, 80);
      }

      if (!titleHint) {
        for (let j = i + 1; j < Math.min(socialLines.length, i + 7); j++) {
          const next = socialLines[j].trim();
          if (!next) continue;
          if (next.includes('›') || /https?:\/\//.test(next)) break;
          if (/^\d+\s*[頁页]$/.test(next)) continue;
          if (/^PDF$/i.test(next)) continue;
          if (/超過\s*\d+\s*個?回應/.test(next)) continue;
          if (/^\d+\s*星期前/.test(next) || /^\d+\s*個?月前/.test(next)) continue;
          if (/^\d{4}年\d+月\d+日\s*—/.test(next)) continue;
          if (/^\.{2,}/.test(next)) continue;
          if (next.length >= 5 && next.length <= 200) {
            titleHint = next.slice(0, 80).toLowerCase();
            break;
          }
        }
      }

      const candidateSig = titleHint ? `${baseSig}#${titleHint}` : baseSig;

// ⭐ FIX: 同 PASS 1a 一致
if (sigMap.has(candidateSig)) {
  console.log(`⏭️ Skip duplicate social anchor: ${normalized.slice(0, 80)}`);
  continue;
}

sigMap.set(candidateSig, { text: normalized, lineIdx: i });
      baseSigsSeen.add(baseSig);  
      }
  }

  // ═══════════════════════════════════════════════════════
  // ⭐ FIX (NEW): 最後按 PDF 原始行號 sort,確保順序同 PDF 一致
  // ═══════════════════════════════════════════════════════
  const sorted = [...sigMap.values()].sort((a, b) => a.lineIdx - b.lineIdx);
  return sorted.map(o => o.text);
};

// 🔑 ANCHOR STRATEGY
//   A Google SERP PDF contains, for EACH search result, BOTH:
//     (a) An embedded PDF hyperlink annotation (the real clickable URL)
//     (b) A rendered breadcrumb in the visible text (e.g. "reuters.com › ...")
//
//   If we use the multi-pass extractor on (b) AND also have (a), we get
//   DOUBLE the count, because sigOf() produces different signatures for
//   the two forms of the same result.
//
//   Rule:
//     • If embedded annotations >= 3 → TRUST them as the canonical anchor
//       list. Their order matches the SERP display order. Skip breadcrumb
//       extraction entirely.
//     • Else → fall back to the multi-pass extractor (covers old Chrome /
//       scanned-image PDFs where annotations are absent).
let resultUrls;
if (embeddedUrls.size >= 3) {
  resultUrls = [...embeddedUrls];
  console.log(`🔑 Using ${resultUrls.length} embedded PDF hyperlinks as the canonical anchor list`);
  console.log(`   (breadcrumb / full-URL / social passes SKIPPED to prevent duplicates)`);
} else {
  console.warn(`⚠️ Only ${embeddedUrls.size} embedded hyperlinks — falling back to multi-pass anchor extraction`);
  resultUrls = extractResultAnchors(pdfText);
}

console.log(`🔗 Final anchor list (${resultUrls.length} item(s)):`);
resultUrls.forEach((a, i) => console.log(`  [${String(i+1).padStart(2,'0')}] ${a}`));

// 🆕 FIX B: Pre-slice PDF into per-rank snippet blocks (deterministic,
//          no URL-fuzzy-probe collision across same-domain results)
const pdfBlocks = sliceSerpPdfByResultBlocks(pdfText);
if (pdfBlocks.length !== resultUrls.length) {
  console.warn(`⚠️ FIX B: pdfBlocks=${pdfBlocks.length} ≠ anchors=${resultUrls.length} — will fall back to URL-probe for missing ranks`);
} else {
  console.log(`✅ FIX B: rank↔block alignment is 1:1`);
}

 // ═══════════════════════════════════════════════════════════
// 🔧 F.6+R: Resolve → Scrape pipeline (Option B)
// ═══════════════════════════════════════════════════════════
let enrichedContent = pdfText;
let scrapedCount = 0;
const scrapeStats = {
  // Anchor classification
  anchorTotal: resultUrls.length,
  fullUrlAnchors: 0,
  breadcrumbAnchors: 0,
  socialAnchors: 0,
  // Resolution stats
  resolveAttempted: 0,
  resolveSucceeded: 0,
  resolveFailed: 0,
  // Scrape stats
  attempted: 0,
  succeeded: 0,
  failed: 0,
  tooShort: 0,
};

// Map: resolved URL → original breadcrumb anchor (for prompt clarity)
const urlToAnchor = new Map();

{
  // ────────────────────────────────────────────
  // STEP 1: Classify all anchors
  // ────────────────────────────────────────────
  setProgress(28); setStage('正在分類搜尋結果 URL...');
  const anchors = reconstructUrlsFromAnchors(resultUrls);
  const fullUrlAnchors = anchors.filter(a => a.kind === 'full_url');
  const breadcrumbAnchors = anchors.filter(a => a.kind === 'breadcrumb');
  const socialAnchors = anchors.filter(a => a.kind === 'social');

  scrapeStats.fullUrlAnchors = fullUrlAnchors.length;
  scrapeStats.breadcrumbAnchors = breadcrumbAnchors.length;
  scrapeStats.socialAnchors = socialAnchors.length;

  console.log(`🔧 Anchor classification:`);
  console.log(`   full_url    (direct scrape) : ${fullUrlAnchors.length}`);
  console.log(`   breadcrumb  (need resolve)  : ${breadcrumbAnchors.length}`);
  console.log(`   social      (snippet only)  : ${socialAnchors.length}`);

  // ────────────────────────────────────────────
  // STEP 2: Resolve breadcrumb anchors → real URLs (via /api/resolve)
  // ────────────────────────────────────────────
  const resolvedUrls = [];
  if (breadcrumbAnchors.length > 0) {
    setProgress(33); setStage(`正在解析 ${breadcrumbAnchors.length} 個 breadcrumb URL...`);
    console.log(`🔍 Resolving ${breadcrumbAnchors.length} breadcrumb anchor(s) via /api/resolve:`);
    scrapeStats.resolveAttempted = breadcrumbAnchors.length;

    const resolveResults = await Promise.allSettled(
      breadcrumbAnchors.map(a => resolveBreadcrumb({
        domain: a.domain,
        pathHint: a.pathHint,
        title: '',  // PDF 冇 clean title per anchor
      }))
    );

    resolveResults.forEach((r, i) => {
      const anchor = breadcrumbAnchors[i];
      const data = r.status === 'fulfilled' ? r.value : { url: null, error: r.reason?.message };

      if (data.url) {
        resolvedUrls.push(data.url);
        urlToAnchor.set(data.url, anchor.original);
        scrapeStats.resolveSucceeded++;
        console.log(`   ✅ ${anchor.original}`);
        console.log(`      → ${data.url}`);
      } else {
        scrapeStats.resolveFailed++;
        console.log(`   ❌ ${anchor.original}`);
        console.log(`      (${data.error || 'no candidate found'} | query: ${data.query || 'n/a'})`);
      }
    });
  }

 // ────────────────────────────────────────────
  // STEP 3: Combine ALL scrapable URL sources
  //   (a) Direct URLs found in visible PDF text (rare for Google SERP — usually only breadcrumbs)
  //   (b) Embedded PDF hyperlink annotations (the REAL article URLs — most common case)
  //   (c) URLs resolved from breadcrumbs via /api/resolve (fallback for old Chrome PDFs)
  // ────────────────────────────────────────────
  const directUrls = extractUrlsFromPdf(pdfText);
  const embeddedAnchorUrls = fullUrlAnchors.map(a => a.url);   // ⭐ FIX: include embedded URLs
  const allUrls = [...new Set([...directUrls, ...embeddedAnchorUrls, ...resolvedUrls])];
  scrapeStats.attempted = allUrls.length;

  console.log(`🌐 Scrape sources combined:`);
  console.log(`   • Direct URLs from PDF text     : ${directUrls.length}`);
  console.log(`   • Embedded PDF hyperlinks       : ${embeddedAnchorUrls.length}  ⭐`);
  console.log(`   • Resolved from breadcrumbs     : ${resolvedUrls.length}`);
  console.log(`   → Total unique URLs to scrape   : ${allUrls.length}`);

  // ────────────────────────────────────────────
  // STEP 4: Scrape all URLs
  // ────────────────────────────────────────────
  if (allUrls.length > 0) {
    setProgress(42); setStage(`正在抓取 ${allUrls.length} 個網頁全文...`);
    console.log(`🌐 Scraping ${allUrls.length} URL(s) — ${directUrls.length} direct + ${resolvedUrls.length} resolved`);

    const pageResults = await Promise.allSettled(allUrls.map(u => fetchPageContent(u)));

    const enrichments = allUrls.map((u, i) => {
      const result = pageResults[i];
      const text = result.status === 'fulfilled' ? result.value : null;
      const anchorLabel = urlToAnchor.get(u) ? ` (resolved from "${urlToAnchor.get(u)}")` : '';

      if (!text) {
        scrapeStats.failed++;
        console.log(`   ❌ SCRAPE FAILED: ${u}${anchorLabel}`);
        return '';
      }
      if (text.length < 200) {
        scrapeStats.tooShort++;
        console.log(`   ⚠️ TOO SHORT (${text.length} chars): ${u}${anchorLabel}`);
        return '';
      }
      scrapeStats.succeeded++;
      scrapedCount++;
      console.log(`   ✅ OK (${text.length} chars): ${u}${anchorLabel}`);
      return `\n--- PAGE CONTENT: ${u}${anchorLabel} ---\n${text}\n--- END ---`;
    }).filter(Boolean).join('\n');

    if (enrichments) {
      enrichedContent = pdfText + '\n\n=== FULL PAGE CONTENTS ===\n' + enrichments;
    }
  } else {
    console.log(`⏭️ No URLs to scrape (all anchors are social-only or resolved failed)`);
  }

  // ────────────────────────────────────────────
  // STEP 5: Embed pipeline report into AI prompt
  // ────────────────────────────────────────────
  const scrapeSummary = `
═══════════════════════════════════════════════════════════
📊 URL RESOLUTION & PAGE-CONTENT SCRAPING REPORT
═══════════════════════════════════════════════════════════
ANCHOR CLASSIFICATION (from PDF):
  Total anchors detected               : ${scrapeStats.anchorTotal}
    • Full URLs with article path      : ${scrapeStats.fullUrlAnchors}
    • Breadcrumb anchors (e.g. "x.com › ...")  : ${scrapeStats.breadcrumbAnchors}
    • Social platform markers (FB/YT/etc): ${scrapeStats.socialAnchors}

BREADCRUMB URL RESOLUTION (via DuckDuckGo "site:" search):
  Attempted                            : ${scrapeStats.resolveAttempted}
  Successfully resolved to real URL    : ${scrapeStats.resolveSucceeded}
  Could not be resolved                : ${scrapeStats.resolveFailed}

PAGE-CONTENT SCRAPING:
  URLs attempted (direct + resolved)   : ${scrapeStats.attempted}
  Successfully scraped (≥200 chars)    : ${scrapeStats.succeeded}
  Failed (network/timeout/blocked)     : ${scrapeStats.failed}
  Too short to be useful (<200 chars)  : ${scrapeStats.tooShort}

⚠️ IMPORTANT FOR CLASSIFICATION:
  • For results WITH full page content (marked "--- PAGE CONTENT: <url> ---"
    below), base your classification on the FULL article body, not the snippet.
  • For results WITHOUT full page content (resolve failed / social-only /
    scrape failed / too short), you ONLY have the Google snippet from the PDF.
    Snippets are short and lossy — they often quote one sentence out of context.
    SNIPPET HANDLING (balanced, NOT over-conservative):
  - A snippet that clearly states "X agreed to pay $Y in fines to resolve
    [regulator] investigation into [predicate]" IS strong TRUE_HIT evidence.
    Do NOT downgrade these just because the full body wasn't scraped.
  - Only downgrade when the relationship between target and wrongdoing is
    genuinely ambiguous in the snippet text.
  - Trust your reasoning. If your "reason" field describes a clear TRUE_HIT,
    your "cls" field MUST be TRUE_HIT (consistency check).
═══════════════════════════════════════════════════════════
`;
  enrichedContent = scrapeSummary + '\n' + enrichedContent;
  console.log(`📊 Final pipeline stats:`, scrapeStats);
}

// ═══════════════════════════════════════════════════════════
      // 🆕 TWO-PASS: Pass 1 (per-article fact extraction) + Pass 2 (JS classifier)
      // ═══════════════════════════════════════════════════════════
      setProgress(50);
      setStage('Pass 1: 抽取每篇文章嘅 facts...');

      // Build URL → body map from enrichedContent
      const pageContentMap = new Map();
      const pageRe = /--- PAGE CONTENT: ([^\s)]+)[^-]*---\n([\s\S]*?)\n--- END ---/g;
      let pm;
      while ((pm = pageRe.exec(enrichedContent)) !== null) {
        pageContentMap.set(pm[1], pm[2]);
      }
      console.log(`📚 Two-pass: have ${pageContentMap.size} full-page bodies`);

     // Build per-article input list (1 article per URL/anchor)
      // 🆕 FIX B: body source priority is now:
      //    (1) scraped full page  →  (2) rank-aligned PDF block  →  (3) URL-probed PDF context
      //    Step (2) is the FIX — it guarantees each rank gets a UNIQUE snippet
      //    even when multiple results share the same domain.
      const articles = resultUrls.map((url, i) => {
        const scraped = pageContentMap.get(url) || '';
        const hasFullBody = scraped.length >= 200;

        let snippet = '';
        let bodySource = 'none';

        if (hasFullBody) {
          bodySource = 'scraped';
        } else if (pdfBlocks[i] && pdfBlocks[i].length >= 50) {
          snippet = pdfBlocks[i];
          bodySource = 'pdf-block-rank';                    // 🆕 deterministic per-rank
        } else {
          const probed = findArticleContextInPdf(pdfText, url) || '';
          if (probed) {
            snippet = probed;
            bodySource = 'pdf-probe-fallback';
          }
        }

        return {
          rank: i + 1,
          url,
          title: '',
          source: '',
          body: hasFullBody ? scraped : (snippet || '(No content available for this URL)'),
          hasFullBody,
          bodySource,
        };
      });

// 🆕 Debug log:確認 fallback 有 work
const sources = articles.reduce((a, x) => { a[x.bodySource]++; return a; }, { scraped: 0, 'pdf-snippet': 0, none: 0 });
console.log(`📦 Article body sources:`, sources);

      // If we have ZERO resultUrls (e.g. extraction failed), fallback to one synthetic entry
      if (articles.length === 0) {
        articles.push({
          rank: 1,
          url: '(no URLs extracted)',
          title: '',
          source: '',
          body: pdfText.slice(0, 8000),
          hasBody: false,
        });
      }

      setProgress(55);

      // ═══ Pass 1 — parallel per-article fact extraction ═══
      const factsResults = await Promise.allSettled(
        articles.map(a => extractArticleFacts({
          targetName: searchEntity,
          kycInfo: entityContext,
          article: a,
          apiKey,
        }))
      );

      setProgress(85);
      setStage('Pass 2: 套規則生成分類結果...');

      // ═══ Pass 2 — pure JS classification ═══
      let parsed = factsResults.map((fr, i) => {
        const article = articles[i];

        // Pass 1 failure → mark as NO_HIT
        if (fr.status !== 'fulfilled' || !fr.value) {
          return {
            rank: article.rank,
            url: article.url,
            title: article.title || '',
            source: article.source || '',
            date: '',
            snippet: '',
            matchedKeywords: [],
            cls: 'NO_HIT',
            identityMatch: 'NO_INFO',
            nameInResult: '',
            actualSubjectName: '',
            confidence: 0,
            reason: `No Hit, because fact extraction failed for this URL. Manual review recommended. URL: ${article.url}`,
            riskCat: 'N/A (Extraction Failed)',
          };
        }

              // 🆕 FIX A: name-token override BEFORE classification
        const facts = preCheckTargetMentioned(fr.value, searchEntity, articles[i].body);

        // 🆕 PATCH ⑥: verify AI-extracted subject name actually exists in this block  ⭐ 新加呢一行
        verifyFactsAgainstBlock(facts, articles[i].body, articles[i].rank);          // ⭐

        // 🆕 GATE 3: JS-derive publisher / articleDate / specificEvent from THIS block only
        const blockMeta = extractBlockMetadata(articles[i].body, articles[i].url);
        facts.publisher = blockMeta.publisher;
        facts.articleDate = blockMeta.articleDate || 'unknown';
        facts.specificEvent = buildDeterministicSpecificEvent({
          articleDate: blockMeta.articleDate,
          publisher: blockMeta.publisher,
          targetActionInArticle: facts.targetActionInArticle,
          wrongdoingDescribed: facts.wrongdoingDescribed,
          wrongdoingType: facts.wrongdoingType,
        });
        console.log(`📍 GATE 3 rank ${articles[i].rank}: publisher="${facts.publisher}", date="${facts.articleDate}"`);

        const cls = classifyFromFacts({ facts, targetName: searchEntity, mode });
        return {
          rank: article.rank,
          url: article.url,
          title: article.title || '',
          source: article.source || '',
          date: '',
          snippet: facts.evidenceQuote || '',
          matchedKeywords: [],
          cls: cls.cls,
          identityMatch: cls.identityMatch,
          nameInResult: facts.nameInArticle || '',
          actualSubjectName: cls.actualSubjectName || '',
          confidence: typeof facts.factsConfidence === 'number'
            ? Math.round(facts.factsConfidence * 100) / 100
            : 0.8,
          reason: cls.reason,
          riskCat: cls.riskCat,
          _facts: facts,                // keep raw facts for debugging
        };
      });

      console.log(`✅ Two-pass complete: ${parsed.length} items classified`);
      console.log(`   • TRUE_HIT:        ${parsed.filter(r => r.cls === 'TRUE_HIT').length}`);
      console.log(`   • FALSE_HIT:       ${parsed.filter(r => r.cls === 'FALSE_HIT').length}`);
      console.log(`   • IRRELEVANT_MLTF: ${parsed.filter(r => r.cls === 'IRRELEVANT_MLTF').length}`);
      console.log(`   • NO_HIT:          ${parsed.filter(r => r.cls === 'NO_HIT').length}`);

      // Count validation — guaranteed N→N because we iterate resultUrls
      if (resultUrls.length > 0 && parsed.length !== resultUrls.length) {
        console.warn(`⚠️ Unexpected count: parsed=${parsed.length}, anchors=${resultUrls.length}`);
      } else if (resultUrls.length > 0) {
        console.log(`✅ Count match: ${parsed.length} items = ${resultUrls.length} anchors`);
      }


      // ═══════════════════════════════════════════════════════
      // 🆕 PASS 1B: SIMILARITY GUARD + AUTO RE-PROMPT
      // ═══════════════════════════════════════════════════════
      setProgress(92);
      setStage('檢查 reasons 是否唯一...');

      const dupeGroups = findDuplicateReasonGroups(parsed);

      if (dupeGroups.length > 0) {
        const totalDupeItems = dupeGroups.reduce((s, g) => s + g.items.length, 0);
        console.warn(`⚠️ Found ${dupeGroups.length} duplicate-reason group(s), ${totalDupeItems} item(s) need re-extraction:`);
        dupeGroups.forEach((g, i) => {
          console.warn(`   Group ${i + 1}: ranks [${g.ranks.join(', ')}]`);
          console.warn(`     Signature: ${g.signature.slice(0, 120)}...`);
        });

        setProgress(95);
        setStage(`Pass 1B: 重新分析 ${totalDupeItems} 篇相似文章...`);

        // For each duplicate group, re-extract each member with sibling context
        for (let gi = 0; gi < dupeGroups.length; gi++) {
          const group = dupeGroups[gi];
          console.log(`🔄 Re-extracting group ${gi + 1}/${dupeGroups.length} (ranks: ${group.ranks.join(', ')})...`);

          const reExtractPromises = group.items.map(item => {
            const siblings = group.items.filter(s => s.rank !== item.rank);
            const article = articles.find(a => a.rank === item.rank);
            if (!article) return Promise.resolve(null);
            return reExtractWithDistinguishing({
              targetName: searchEntity,
              kycInfo: entityContext,
              article,
              siblings,
              apiKey,
            });
          });

          const reExtracted = await Promise.allSettled(reExtractPromises);

          reExtracted.forEach((r, i) => {
            const item = group.items[i];
            if (r.status !== 'fulfilled' || !r.value) {
              console.warn(`   ⚠️ Re-extraction failed for rank ${item.rank} — keeping original`);
              return;
            }
          // 🆕 FIX A: name-token override BEFORE re-classification
            const articleForBody = articles.find(a => a.rank === item.rank);
            const newFacts = preCheckTargetMentioned(r.value, searchEntity, articleForBody?.body || '');

            // 🆕 PATCH ⑥: same anti-hallucination guard during re-extraction        ⭐ 新加呢一行
            if (articleForBody) verifyFactsAgainstBlock(newFacts, articleForBody.body, item.rank);  // ⭐

            // 🆕 GATE 3: same JS metadata injection as Pass 2
            if (articleForBody) {
              const blockMeta = extractBlockMetadata(articleForBody.body, articleForBody.url);
              newFacts.publisher = blockMeta.publisher;
              newFacts.articleDate = blockMeta.articleDate || 'unknown';
              newFacts.specificEvent = buildDeterministicSpecificEvent({
                articleDate: blockMeta.articleDate,
                publisher: blockMeta.publisher,
                targetActionInArticle: newFacts.targetActionInArticle,
                wrongdoingDescribed: newFacts.wrongdoingDescribed,
                wrongdoingType: newFacts.wrongdoingType,
              });
            }

            const newCls = classifyFromFacts({ facts: newFacts, targetName: searchEntity, mode });
            
            const idx = parsed.findIndex(p => p.rank === item.rank);
            if (idx !== -1) {
              parsed[idx] = {
                ...parsed[idx],
                cls: newCls.cls,
                identityMatch: newCls.identityMatch,
                nameInResult: newFacts.nameInArticle || parsed[idx].nameInResult,
                actualSubjectName: newCls.actualSubjectName || parsed[idx].actualSubjectName,
                confidence: typeof newFacts.factsConfidence === 'number'
                  ? Math.round(newFacts.factsConfidence * 100) / 100
                  : parsed[idx].confidence,
                snippet: newFacts.evidenceQuote || parsed[idx].snippet,
                reason: newCls.reason,
                riskCat: newCls.riskCat,
                _facts: newFacts,
                _reExtracted: true,
              };
              console.log(`   ✅ Rank ${item.rank} re-extracted:`);
              console.log(`      specificEvent: "${newFacts.specificEvent}"`);
              console.log(`      targetAction:  "${newFacts.targetActionInArticle}"`);
            }
          });
        }

        // Final verification
        const remainingDupes = findDuplicateReasonGroups(parsed);
        if (remainingDupes.length > 0) {
          console.warn(`⚠️ ${remainingDupes.length} group(s) STILL have duplicate reasons after re-extraction:`);
          remainingDupes.forEach((g, i) => {
            console.warn(`   Remaining Group ${i + 1}: ranks [${g.ranks.join(', ')}]`);
          });
        } else {
          console.log(`✅ All reasons now unique after Pass 1B re-extraction.`);
        }
      } else {
        console.log(`✅ All reasons already unique — no Pass 1B needed.`);
      }
      // ═══════════════════════════════════════════════════════
      // END PASS 1B
      // ═══════════════════════════════════════════════════════
      
      setProgress(100);
      timerIdsRef.current.push(setTimeout(() => {
        setIsAnalyzing(false);
        setAnalysisComplete(true);
        setResults(parsed);
      }, 300));
    } catch (err) {
      setIsAnalyzing(false);
      setProgress(0);
      setStage('');
      setErrorMsg(`分析失敗：${err.message}`);
    }
  };
    
 const counts = useMemo(() => {
    const c = { TRUE_HIT: 0, FALSE_HIT: 0, IRRELEVANT_MLTF: 0, NO_HIT: 0 };
    results.forEach(r => { if (c[r.cls] !== undefined) c[r.cls]++; });
    return c;
  }, [results]);

  const filteredResults = useMemo(() => filterType === 'ALL' ? results : results.filter(r => r.cls === filterType), [results, filterType]);

  // CDD-format clean: strip noise but preserve "Label, because" prefix
  const cleanReason = (raw) => {
    if (!raw) return '';
    let r = String(raw);
    // Remove stage markers
    r = r.replace(/🎯\s*\[Stage\s*\d[^\]]*\]\s*/gi, '');
    r = r.replace(/\[Stage\s*\d[^\]]*\]\s*/gi, '');
    r = r.replace(/STAGE\s*\d+\s*:\s*/gi, '');
    // Remove auto/manual markers
    r = r.replace(/\[Auto[^\]]*\]\s*/gi, '');
    r = r.replace(/\[Manual\][^|]*\|\s*Original\([^)]+\):\s*/gi, '');
    // Strip emoji
    r = r.replace(/[🎯✅❌⚠️📉⏳🚨ℹ️🔴🟡🟢📋✏️]/g, '');
    // Drop debug appendices
    r = r.replace(/\n+—\s*ORIGINAL[^]*$/i, '');
    r = r.replace(/\s*Evidence:\s*"[^"]{0,300}"\s*$/i, '');
    // Collapse whitespace
    r = r.replace(/\s+/g, ' ').trim();
    return r;
  };

// Strip leading "<Label>, because" or "<Label>: because" prefix from reason
  const stripLabelPrefix = (reason) => {
  if (!reason) return '';
  let r = String(reason).trim();
  r = r.replace(/^(true hit|false hit|no hit|irrelevant ml\/tf|irrelevant sanction)\s*[,:]\s*/i, '');
  r = r.replace(/^(真實命中|誤報|無命中|無關\s*ml\/tf|無關制裁)\s*[,:,:]\s*/i, '');
  r = r.replace(/^Because\s/, 'because ');
  if (!/^because\s/i.test(r)) {
    r = `because ${r}`;
  }
  return r;
};
  
const summaryText = useMemo(() => {
    if (!results.length) return '';
    return results.map((r, i) => {
      const c = clsConfig[r.cls] || clsConfig['NO_HIT'];
      const labelDisplay = c.label; // English only
      const reasonBody = stripLabelPrefix(cleanReason(r.reason)) || 'because no reason provided';
      return `${i + 1}. ${labelDisplay}: ${reasonBody}`;
    }).join('\n\n');
  }, [results]);

  const updateResultCls = (rank, newCls, note) => {
    const labelMap = {
      TRUE_HIT: 'True Hit',
      FALSE_HIT: 'False Hit',
      IRRELEVANT_MLTF: IRRELEVANT_LABEL,
      NO_HIT: 'No Hit',
    };
    const newLabel = labelMap[newCls] || IRRELEVANT_LABEL;

    setResults(prev => prev.map(r => {
      if (r.rank !== rank) return r;

      let newReason = `${newLabel}, because ${note}. Original AI classification was ${clsConfig[r.cls]?.label || r.cls}.`;

      // 🆕 Mode-aware suffix:sanction → "sanctions violations" / adverse media → "ML/TF negative news"
      if (newCls === 'IRRELEVANT_MLTF' && !IRRELEVANT_SUFFIX_REGEX.test(newReason)) {
        newReason = newReason.replace(/[.!?]?\s*$/, '.') + ' ' + IRRELEVANT_SUFFIX;
      }

      return {
        ...r,
        cls: newCls,
        reason: newReason,
        _manualOverride: true,
        _previousCls: r.cls,
        _previousReason: r.reason,
      };
    }));
  };

  
  const [strFlaggedRanks, setStrFlaggedRanks] = useState(new Set());

 const flagSTR = (rank, resultItem) => {
    setStrFlaggedRanks(prev => {
      const next = new Set(prev);
      const wasFlagged = next.has(rank);
      if (wasFlagged) {
        next.delete(rank);
      } else {
        next.add(rank);
        // 寫回 entity STR 狀態
        if (onFlagSTR) {
          onFlagSTR({
            flagged: true,
            source: mode === 'sanction' ? 'Sanction Screening' : 'Adverse Media Screening',
            title: resultItem?.title || '',
            riskCat: resultItem?.riskCat || '',
            confidence: resultItem?.confidence || 0,
          });
        }
      }
      return next;
    });
  };
  
const ResultCard = ({ r }) => {
    const c = clsConfig[r.cls] || clsConfig['NO_HIT'];
    const isOpen = expandedId === r.rank;
    const labelDisplay = c.label; // English only

    // Display reason starts with "because ..." (label is shown separately, no duplicate)
    const displayReason = stripLabelPrefix(cleanReason(r.reason));

    // Accent colour for left bar + label colour
    const accent = {
      TRUE_HIT:        { leftBar: 'bg-red-500',     labelColor: 'text-red-700' },
      FALSE_HIT:       { leftBar: 'bg-amber-500',   labelColor: 'text-amber-700' },
      IRRELEVANT_MLTF: { leftBar: 'bg-slate-400',   labelColor: 'text-slate-600' },
      NO_HIT:          { leftBar: 'bg-emerald-500', labelColor: 'text-emerald-700' },
    }[r.cls] || { leftBar: 'bg-slate-400', labelColor: 'text-slate-600' };

    return (
      <div className="relative bg-white border border-slate-200 rounded-lg overflow-hidden hover:shadow-sm transition-shadow">
        {/* Left accent bar */}
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${accent.leftBar}`} />

        <div
          className="pl-4 pr-3 py-3 cursor-pointer flex items-start gap-2"
          onClick={() => setExpandedId(isOpen ? null : r.rank)}
        >
          {/* Rank number */}
          <span className="text-sm font-bold text-slate-500 min-w-[24px] tabular-nums">
            {r.rank}.
          </span>

          {/* Point-form main content */}
          <div className="flex-1 min-w-0">
            <div className="text-[13px] leading-relaxed">
              <span className={`font-bold ${accent.labelColor}`}>{labelDisplay}</span>
              <span className="text-slate-400">: </span>
              <span className="text-slate-800">{displayReason}</span>
            </div>

            {/* Meta row */}
            {(r.source || r.date || r._manualOverride || r._reExtracted) && (
              <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[10px] text-slate-400">
                {r.source && <span className="font-semibold">{r.source}</span>}
                {r.source && r.date && <span>·</span>}
                {r.date && <span className="font-mono">{r.date}</span>}
                {r._reExtracted && (
                  <span className="text-blue-600 font-bold">🔄 Re-analyzed (distinguishing)</span>
                )}
                {r._manualOverride && (
                  <span className="text-indigo-600 font-bold">✏️ Manual override</span>
                )}
              </div>
            )}
          </div>

          <ChevronRight
            className={`w-4 h-4 text-slate-300 transition-transform mt-0.5 shrink-0 ${isOpen ? 'rotate-90' : ''}`}
          />
        </div>

        {/* Expanded detail */}
        {isOpen && (
          <div className="pl-4 pr-3 pb-3 border-t border-slate-100 bg-slate-50/30">
            {r.title && (
              <div className="pt-2.5">
                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Title</div>
                <div className="text-xs text-slate-700 font-semibold">{r.title}</div>
              </div>
            )}
            {r.snippet && (
              <div className="pt-2">
                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Snippet</div>
                <div className="text-xs text-slate-600 leading-relaxed">{r.snippet}</div>
              </div>
            )}
            {r.matchedKeywords && r.matchedKeywords.length > 0 && (
              <div className="pt-2">
                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Matched Keywords</div>
                <div className="flex flex-wrap gap-1">
                  {r.matchedKeywords.map((kw, i) => (
                    <span key={i} className="text-[10px] bg-white border border-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-semibold">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {r.actualSubjectName && (
              <div className="pt-2">
                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Actual Subject (≠ target)</div>
                <div className="text-xs text-amber-700 font-semibold">{r.actualSubjectName}</div>
              </div>
            )}

            {/* Manual override actions */}
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {r.cls === 'TRUE_HIT' && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); flagSTR(r.rank, r); }}
                    className={`text-[11px] px-2.5 py-1 rounded font-bold transition ${
                      strFlaggedRanks.has(r.rank)
                        ? 'bg-red-700 text-white'
                        : 'bg-red-500 text-white hover:bg-red-600'
                    }`}
                  >
                    {strFlaggedRanks.has(r.rank) ? '✅ STR flagged' : '🚨 Flag STR'}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'FALSE_HIT', 'manually downgraded to False Hit by analyst'); }}
                    className="text-[11px] px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 font-semibold"
                  >
                    → False Hit
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'IRRELEVANT_MLTF', 'manually re-classified to Irrelevant ML/TF by analyst'); }}
                    className="text-[11px] px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 font-semibold"
                  >
                    → Irrelevant
                  </button>
                </>
              )}
              {r.cls === 'FALSE_HIT' && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'TRUE_HIT', 'manually upgraded to True Hit by analyst'); }}
                    className="text-[11px] px-2.5 py-1 rounded bg-red-500 text-white hover:bg-red-600 font-bold"
                  >
                    ↑ True Hit
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'IRRELEVANT_MLTF', 'manually re-classified to Irrelevant ML/TF by analyst'); }}
                    className="text-[11px] px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 font-semibold"
                  >
                    → Irrelevant
                  </button>
                </>
              )}
              {(r.cls === 'IRRELEVANT_MLTF' || r.cls === 'NO_HIT') && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'TRUE_HIT', 'manually upgraded to True Hit by analyst'); }}
                    className="text-[11px] px-2.5 py-1 rounded bg-red-500 text-white hover:bg-red-600 font-bold"
                  >
                    ↑ True Hit
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'FALSE_HIT', 'manually re-classified to False Hit by analyst'); }}
                    className="text-[11px] px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 font-semibold"
                  >
                    → False Hit
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };


  const riskLabel = isSanction ? 'SANCTIONS RISK' : 'Overall Risk Assessment';
  const riskDescHigh = isSanction
    ? `${counts.TRUE_HIT} confirmed sanctions list hit(s)`
    : `${counts.TRUE_HIT} confirmed hits related to ML/TF/Sanctions`;
  const riskDescLow = isSanction
    ? 'No sanctions list hits found'
    : 'No ML/TF/Sanctions-related hits found';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Modern Header with Gradient */}
      <div className={`relative overflow-hidden ${
        isSanction
          ? 'bg-gradient-to-br from-orange-600 via-orange-700 to-red-700'
          : 'bg-gradient-to-br from-slate-800 via-slate-900 to-indigo-900'
      } text-white px-6 py-5`}>
        {/* Decorative blur */}
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-1.5">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-lg ${
              isSanction ? 'bg-white/15 backdrop-blur shadow-orange-900/40' : 'bg-white/15 backdrop-blur shadow-indigo-900/40'
            }`}>
              <Shield className="w-5 h-5 text-white" strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">{moduleTitle}</h1>
              <p className={`text-[11px] mt-0.5 ${isSanction ? 'text-orange-100/80' : 'text-slate-300/80'}`}>
                {moduleSubtitle}
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto flex overflow-x-auto px-4">
          {[
            { id: 'demo', label: '開始', icon: '🎬' },
            { id: 'arch', label: '架構說明', icon: '🏗️' },
            { id: 'keywords', label: '關鍵字配置', icon: '🔑' },
          ].map(tb => {
            const isActive = activeTab === tb.id;
            return (
              <button
                key={tb.id}
                onClick={() => setActiveTab(tb.id)}
                className={`relative px-4 py-3 text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                  isActive
                    ? isSanction ? 'text-orange-700' : 'text-indigo-700'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span className="text-base">{tb.icon}</span>
                {tb.label}
                {isActive && (
                  <span className={`absolute bottom-0 left-3 right-3 h-[3px] rounded-t-full ${
                    isSanction
                      ? 'bg-gradient-to-r from-orange-400 to-red-500'
                      : 'bg-gradient-to-r from-blue-400 to-indigo-500'
                  }`} />
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="max-w-6xl mx-auto p-4">
        {activeTab === 'demo' && (
          <div className="space-y-4">
{/* Worker Status Card - Modern */}
<div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_8px_rgba(15,23,42,0.04)] p-4">
  <div className="flex items-center justify-between flex-wrap gap-2">
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400 to-cyan-600 flex items-center justify-center shadow-md shadow-teal-500/25">
        <Globe className="w-5 h-5 text-white" strokeWidth={2.2} />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-900">📰 網頁全文抓取</span>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            已內建
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mt-0.5">提升分類準確度 · Cloudflare Worker</p>
      </div>
    </div>
    <button
      onClick={testWorkerConnection}
      className="text-xs bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-800 hover:to-slate-900 text-white px-3.5 py-2 rounded-lg font-bold shadow-md shadow-slate-700/20 transition-all"
    >
      🔌 測試連線
    </button>
  </div>
  {workerStatus && (
    <div className={`mt-3 text-xs rounded-xl p-3 border flex items-start gap-2 ${
      workerStatus.startsWith('✅')
        ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
        : 'text-red-700 bg-red-50 border-red-200'
    }`}>
      <span className="text-sm">{workerStatus.startsWith('✅') ? '✓' : '⚠'}</span>
      <span className="flex-1 font-medium">{workerStatus}</span>
    </div>
  )}
</div>


            <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_8px_rgba(15,23,42,0.04)] p-5 transition-all hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
              {/* Step Header */}
              <div className="flex items-center gap-3 mb-4">
                <div className={`relative w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-lg ${
                  isSanction 
                    ? 'bg-gradient-to-br from-orange-500 to-red-600 shadow-orange-500/30' 
                    : 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-blue-500/30'
                }`}>
                  1
                  <span className="absolute inset-0 rounded-xl ring-2 ring-white" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 tracking-tight">執行 Google 搜尋</h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">輸入實體名稱，系統自動建立查詢字串</p>
                </div>
              </div>

              {/* Inputs */}
              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <div className="flex-1">
                  <label className="text-[11px] font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">實體名稱</label>
                  <input 
                    type="text" 
                    value={searchEntity} 
                    onChange={e => setSearchEntity(e.target.value)} 
                    maxLength={200} 
                    className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2.5 text-sm focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all placeholder:text-slate-400" 
                    placeholder="輸入英文或中文名稱..." 
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">自動檢測語言</label>
                  <div className="h-[42px] px-4 rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 flex items-center gap-2 min-w-[140px]">
                    <Globe className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-bold">
                    {searchEntity ? (() => {
                    const detected = detectLanguageDetail(searchEntity);
                    if (detected === 'zh_cn') return <span className="text-emerald-600">🇨🇳 簡體中文</span>;
                    if (detected === 'zh_tw') return <span className="text-red-600">🇹🇼 繁體中文</span>;
                    return <span className="text-blue-600">🇬🇧 英文</span>;
                   })() : (
                   <span className="text-slate-400 font-medium">請輸入名稱</span>
                   )}
                   </span>
                  </div>
                </div>
              </div>
                            {/* ── 制裁篩查：3 Part 搜尋按鈕 ── */}
              {isSanction && sanctionParts ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-gray-600">選擇 Part：</span>
                    {['part1', 'part2', 'part3'].map((p, idx) => (
                      <button key={p} onClick={() => setSanctionPart(p)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                          sanctionPart === p
                            ? 'bg-orange-600 text-white border-orange-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-orange-400'
                        }`}>
                        Part {idx + 1} ({sanctionParts[p].length})
                      </button>
                    ))}
                    {sanctionLang && (
                      <span className="text-xs text-gray-400 ml-2">
                        {sanctionLang === 'en' ? '🇬🇧 EN' : sanctionLang === 'zh_tw' ? '🇹🇼 繁中' : '🇨🇳 简中'}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {['part1', 'part2', 'part3'].map((p, idx) => (
                      <a key={p} href={sanctionPartUrls[p]} target="_blank" rel="noopener noreferrer"
                        className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition ${
                          searchEntity
                            ? (sanctionPart === p
                              ? 'bg-orange-600 text-white hover:bg-orange-700 ring-2 ring-orange-300'
                              : 'bg-orange-100 text-orange-700 hover:bg-orange-200 border border-orange-300')
                            : 'bg-gray-200 text-gray-400 pointer-events-none'
                        }`}>
                        <ExternalLink className="w-4 h-4" />
                        Part {idx + 1}
                      </a>
                    ))}
                  </div>
                  <button onClick={() => setShowQuery(!showQuery)}
                    className="text-xs text-orange-600 font-bold flex items-center gap-1 hover:underline px-2">
                    {showQuery ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    預覽全部查詢字串
                  </button>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2">
                  <a href={googleSearchUrl} target="_blank" rel="noopener noreferrer"
                    className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition ${
                      searchEntity ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 text-gray-400 pointer-events-none'
                    }`}>
                    <ExternalLink className="w-4 h-4" /> 在 Google 開啟搜尋
                  </a>
                  <button onClick={() => setShowQuery(!showQuery)}
                    className="text-xs text-blue-600 font-bold flex items-center gap-1 hover:underline px-2">
                    {showQuery ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    預覽查詢字串
                  </button>
                </div>
              )}

              {/* ── 查詢字串預覽 ── */}
              {showQuery && searchEntity && (
                <div className="mt-2 bg-gray-900 rounded-lg p-3 overflow-x-auto space-y-2">
                  {isSanction && sanctionParts ? (
                    ['part1', 'part2', 'part3'].map((p, idx) => (
                      <div key={p}>
                        <div className="text-xs text-orange-400 mb-0.5 font-bold">Part {idx + 1} ({sanctionParts[p].length} keywords)</div>
                        <code className="text-xs text-green-400 break-all">
                          {buildSanctionQueryForPart(searchEntity, p).query}
                        </code>
                      </div>
                    ))
                  ) : (
                    <>
                      <div className="text-xs text-gray-400 mb-1">Google Search Query</div>
                      <code className="text-xs text-green-400">{searchQuery}</code>
                    </>
                  )}
                </div>
              )}

             <div className={`mt-4 rounded-xl p-3 border-l-4 ${
                isSanction 
                  ? 'bg-gradient-to-r from-orange-50 to-amber-50 border-l-orange-500 border-y border-r border-orange-200' 
                  : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-l-blue-500 border-y border-r border-blue-200'
              }`}>
                <div className="flex items-start gap-2">
                  <span className="text-base">📋</span>
                  <div className={`text-xs ${isSanction ? 'text-orange-900' : 'text-blue-900'}`}>
                    <b className="font-bold">操作說明：</b> 點擊「在 Google 開啟搜尋」，確認結果後用{' '}
                    <kbd className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-white border border-slate-300 shadow-sm font-mono text-[10px]">Ctrl+P</kbd>
                    或
                    <kbd className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-white border border-slate-300 shadow-sm font-mono text-[10px]">Cmd+P</kbd>
                    {' → '}<b>另存為 PDF</b> 儲存第一頁。
                  </div>
                </div>
              </div>
            </div>
            
           {/* Supplementary Info Card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_8px_rgba(15,23,42,0.04)] p-5 transition-all hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
              <div className="flex items-start gap-3 mb-4 flex-wrap">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/25">
                  <span className="text-white text-base">🪪</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                      {detectedLang === 'zh' ? '補充辨識資料' : 'Supplementary ID Info'}
                    </h2>
                    <span className="inline-flex items-center gap-1 bg-gradient-to-r from-amber-50 to-orange-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full text-[10px] font-bold">
                      <span>⚡</span>
                      {detectedLang === 'zh' ? '強烈建議' : 'Recommended'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {detectedLang === 'zh' ? '提供更多細節可大幅降低同名誤報率' : 'More details = fewer false positives'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* 出生日期 */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1">
                    📅 {detectedLang === 'zh' ? '出生日期' : 'Date of Birth'}
                  </label>
                  <input
                    type="date"
                    value={entityContext.dob}
                    onChange={e => handleExtraChange('dob', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                  />
                </div>

                {/* 國籍 */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1">
                    🏳️ {detectedLang === 'zh' ? '國籍 / 地區' : 'Nationality / Region'}
                  </label>
                  <select
                    value={entityContext.nationality}
                    onChange={e => handleExtraChange('nationality', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all appearance-none"
                  >
                    <option value="">{detectedLang === 'zh' ? '— 請選擇 —' : '— Select —'}</option>
                    {NATIONALITIES.map(n => (                       
                    <option key={n.value} value={n.value}>                         
                      {detectedLang === 'zh' ? `${n.zh} (${n.en})` : `${n.en} (${n.zh})`}                       
                    </option>                     ))}
                  </select>
                </div>

                {/* 性別 */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1">
                    ⚧ {detectedLang === 'zh' ? '性別' : 'Gender'}
                  </label>
                  <div className="flex gap-2">
                    {[
                      { value: 'Male', labelZh: '男', labelEn: 'Male' },
                      { value: 'Female', labelZh: '女', labelEn: 'Female' },
                      { value: 'Other', labelZh: '其他', labelEn: 'Other' }
                    ].map(g => (
                      <button
                        key={g.value}
                        type="button"
                        onClick={() => handleExtraChange('gender', entityContext.gender === g.value ? '' : g.value)}
                        className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all ${
                          entityContext.gender === g.value
                            ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50'
                        }`}
                      >
                        {detectedLang === 'zh' ? g.labelZh : g.labelEn}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 公司/職稱 */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1">
                    🏢 {detectedLang === 'zh' ? '公司 / 職稱' : 'Company / Title'}
                  </label>
                  <input
                    type="text"
                    value={entityContext.company}
                    onChange={e => handleExtraChange('company', e.target.value)}
                    placeholder={detectedLang === 'zh' ? '例：Alpha Holdings Ltd / 董事' : 'e.g. Alpha Holdings Ltd / Director'}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all placeholder:text-slate-400"
                  />
                </div>

                {/* 證件號碼 */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1">
                    🆔 {detectedLang === 'zh' ? '證件號碼' : 'ID Number'}
                  </label>
                  <input
                    type="text"
                    value={entityContext.idNumber}
                    onChange={e => handleExtraChange('idNumber', e.target.value)}
                    placeholder={detectedLang === 'zh' ? '護照 / 身分證 / 統一編號' : 'Passport / ID / Registration No.'}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all placeholder:text-slate-400"
                  />
                </div>

                {/* 地址 */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1">
                    📍 {detectedLang === 'zh' ? '地址' : 'Address'}
                  </label>
                  <input
                    type="text"
                    value={entityContext.address}
                    onChange={e => handleExtraChange('address', e.target.value)}
                    placeholder={detectedLang === 'zh' ? '註冊地址或居住地址' : 'Registered or residential address'}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all placeholder:text-slate-400"
                  />
                </div>

                {/* 其他備註 */}
                <div className="md:col-span-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1">
                    📝 {detectedLang === 'zh' ? '其他備註' : 'Other Notes'}
                  </label>
                  <textarea
                    value={entityContext.notes}
                    onChange={e => handleExtraChange('notes', e.target.value)}
                    placeholder={detectedLang === 'zh' ? '任何其他可辨識資訊（例如：已知不相關身份：非律師、非醫生）' : 'Any other identifying info...'}
                    rows={2}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all resize-none placeholder:text-slate-400"
                  />
                </div>
              </div>

              <p className="text-xs text-amber-600 mt-3 flex items-start gap-1">
                <span>💡</span>
                <span>{detectedLang === 'zh'
                  ? '資料越詳細，AI 越能準確排除同名不同人的誤報。此資料僅用於本次 AI 分析。'
                  : 'The more details provided, the better AI can disambiguate. Data is only used for this analysis.'}
                </span>
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_8px_rgba(15,23,42,0.04)] p-5 transition-all hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
              {/* Step Header */}
              <div className="flex items-center gap-3 mb-4">
                <div className={`relative w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-lg ${
                  isSanction 
                    ? 'bg-gradient-to-br from-orange-500 to-red-600 shadow-orange-500/30' 
                    : 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-blue-500/30'
                }`}>
                  2
                  <span className="absolute inset-0 rounded-xl ring-2 ring-white" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 tracking-tight">上傳搜尋結果 PDF</h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">將 Google 搜尋頁面儲存為 PDF 後上傳</p>
                </div>
              </div>

              {/* Upload Zone */}
              <div className="flex flex-col sm:flex-row gap-3 items-stretch">
                <label className="flex-1 cursor-pointer">
                  <div className={`relative overflow-hidden border-2 border-dashed rounded-2xl p-6 text-center transition-all group ${
                    pdfFile 
                      ? 'border-emerald-400 bg-gradient-to-br from-emerald-50 to-teal-50' 
                      : 'border-slate-300 hover:border-blue-400 bg-gradient-to-br from-slate-50 to-blue-50/30 hover:from-blue-50 hover:to-indigo-50'
                  }`}>
                    {pdfFile ? (
                      <div className="flex items-center justify-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                          <CheckCircle className="w-6 h-6 text-white" strokeWidth={2.2} />
                        </div>
                        <div className="text-left">
                          <div className="text-sm font-bold text-emerald-700">{pdfFile.name}</div>
                          <div className="text-[11px] text-emerald-600 mt-0.5 flex items-center gap-1.5">
                            <span className="inline-block px-1.5 py-0.5 bg-emerald-100 rounded text-[10px] font-bold">PDF</span>
                            {(pdfFile.size / 1024).toFixed(0)} KB
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="w-14 h-14 mx-auto mb-2 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">📄</div>
                        <div className="text-sm font-bold text-slate-700 mb-0.5">點擊上傳 PDF</div>
                        <div className="text-[11px] text-slate-500">支援 Google 搜尋結果頁面 PDF</div>
                      </div>
                    )}
                  </div>
                  <input type="file" accept="application/pdf" onChange={handlePdfUpload} className="hidden" />
                </label>
                {pdfFile && (
                  <button 
                    onClick={() => setPdfFile(null)} 
                    className="self-stretch sm:self-auto text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 flex items-center gap-1.5 px-4 py-2 border border-slate-200 hover:border-red-200 rounded-xl transition-all font-semibold"
                  >
                    <XCircle className="w-4 h-4" /> 移除
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_8px_rgba(15,23,42,0.04)] p-5 transition-all hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
              {/* Step Header */}
              <div className="flex items-start gap-3 mb-4 flex-wrap">
                <div className={`relative w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-lg ${
                  isSanction 
                    ? 'bg-gradient-to-br from-orange-500 to-red-600 shadow-orange-500/30' 
                    : 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-blue-500/30'
                }`}>
                  3
                  <span className="absolute inset-0 rounded-xl ring-2 ring-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                      AI 分析{isSanction ? '（制裁名單命中）' : ''}
                    </h2>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">
                      📰 自動抓取網頁
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">使用 gemini-3.5-flash 進行語義分析與分類</p>
                </div>
              </div>

              {/* API Key Section */}
              <div className="mb-4 bg-gradient-to-br from-slate-50 to-blue-50/30 rounded-xl p-3 border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                    🔑 POE API Key
                  </label>
                  <button 
                    onClick={() => setShowKeyInput(!showKeyInput)} 
                    className="text-[11px] text-blue-600 hover:text-blue-700 font-bold hover:underline transition"
                  >
                    {showKeyInput ? '🙈 隱藏' : '👁️ 顯示/修改'}
                  </button>
                </div>
                {showKeyInput ? (
                  <input 
                    type="text" 
                    value={apiKey} 
                    onChange={e => setApiKey(e.target.value)} 
                    placeholder="sk-or-v1-..." 
                    className="w-full border border-slate-200 bg-white rounded-lg px-3 py-2 text-sm font-mono focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all" 
                  />
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
                        <span>（未設定）</span>
                      </>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1 flex-wrap">
                  <span>使用</span>
                  <span className="inline-block px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-bold text-[9px]">gemini-3.5-flash</span>
                  <span>via Poe API</span>
                  <a href="https://poe.com/api_key" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 hover:underline ml-auto font-semibold">
                    取得 API Key →
                  </a>
                </p>
              </div>

              {/* Error Message */}
              {errorMsg && (
                <div className="mb-3 bg-gradient-to-r from-red-50 to-rose-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 flex items-start gap-2">
                  <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                  </div>
                  <span className="flex-1 font-medium pt-0.5">{errorMsg}</span>
                </div>
              )}

              {/* Submit Button */}
              <button 
                onClick={runAnalysis} 
                disabled={isAnalyzing || !pdfFile || !searchEntity} 
                className={`w-full py-3 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all shadow-lg ${
                  isSanction 
                    ? 'bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white shadow-orange-500/30 hover:shadow-orange-500/50' 
                    : 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-indigo-500/30 hover:shadow-indigo-500/50'
                }`}
              >
                {isAnalyzing 
                  ? <><Loader className="w-4 h-4 animate-spin" />AI 分析中...</> 
                  : <><Brain className="w-4 h-4" />開始 AI {isSanction ? '制裁篩查' : '分析'}</>
                }
              </button>
            </div>

            {isAnalyzing && (
              <div className={`relative overflow-hidden rounded-2xl p-4 border ${
                isSanction 
                  ? 'bg-gradient-to-r from-orange-50 to-red-50 border-orange-200' 
                  : 'bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200'
              }`}>
                <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-30" style={{ background: isSanction ? '#f97316' : '#6366f1' }} />
                <div className="relative">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                      <Loader className={`w-4 h-4 animate-spin ${isSanction ? 'text-orange-600' : 'text-indigo-600'}`} />
                      <span className={`text-xs font-bold ${isSanction ? 'text-orange-700' : 'text-indigo-700'}`}>{stage}</span>
                    </div>
                    <span className={`text-base font-black ${isSanction ? 'text-orange-600' : 'text-indigo-600'}`}>
                      {progress}%
                    </span>
                  </div>
                  <div className="h-2.5 bg-white/70 rounded-full overflow-hidden shadow-inner">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${
                        isSanction 
                          ? 'bg-gradient-to-r from-orange-400 via-orange-500 to-red-500' 
                          : 'bg-gradient-to-r from-indigo-400 via-indigo-500 to-purple-500'
                      }`}
                      style={{ 
                        width: `${progress}%`,
                        boxShadow: `0 0 12px ${isSanction ? 'rgba(249,115,22,0.5)' : 'rgba(99,102,241,0.5)'}`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {analysisComplete && (<>
              {/* Statistics Grid — 5 columns (Total + 4 labels) */}
              <div className="grid grid-cols-5 gap-2.5">
                <div className="bg-white rounded-2xl border border-slate-200 p-3 text-center shadow-[0_2px_8px_rgba(15,23,42,0.04)] hover:shadow-[0_4px_16px_rgba(15,23,42,0.08)] transition-all">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">{results.length}</div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">Total</div>
                </div>
                {Object.entries(clsConfig).map(([key, c]) => {
                  const Icon = c.icon;
                  const colorMap = {
                    TRUE_HIT:        'from-red-50 to-rose-100 border-red-200',
                    FALSE_HIT:       'from-amber-50 to-orange-100 border-amber-200',
                    IRRELEVANT_MLTF: 'from-slate-50 to-slate-100 border-slate-200',
                    NO_HIT:          'from-emerald-50 to-teal-100 border-emerald-200',
                  };
                  return (
                    <div key={key} className={`bg-gradient-to-br ${colorMap[key]} rounded-2xl border p-3 text-center shadow-sm hover:shadow-md transition-all`}>
                      <div className={`text-2xl font-black ${c.text} tracking-tight`}>{counts[key]}</div>
                      <div className={`text-[10px] ${c.text} font-bold uppercase tracking-wider mt-0.5 flex items-center justify-center gap-1`}>
                        <Icon className="w-3 h-3" />
                        <span className="truncate">{c.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Risk Assessment Banner — Simplified */}
              <div className={`relative overflow-hidden rounded-2xl p-4 text-white shadow-lg ${
                counts.TRUE_HIT > 0
                  ? 'bg-gradient-to-r from-red-500 via-red-600 to-rose-700 shadow-red-500/30'
                  : 'bg-gradient-to-r from-emerald-500 via-emerald-600 to-teal-700 shadow-emerald-500/30'
              }`}>
                <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/10 rounded-full blur-3xl" />
                <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-black/10 rounded-full blur-3xl" />
                <div className="relative flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                      <Shield className="w-6 h-6" strokeWidth={2.5} />
                    </div>
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-widest opacity-80">{riskLabel}</div>
                      <div className="text-xl font-black tracking-tight">
                        {counts.TRUE_HIT > 0 ? '🚨 HIGH RISK' : '✅ LOW RISK'}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs opacity-90 max-w-xs text-right">
                    {counts.TRUE_HIT > 0 ? riskDescHigh : riskDescLow}
                  </div>
                </div>
              </div>

              {/* Filter Tabs — 5 tabs (All + 4 labels) */}
              <div className="bg-white rounded-2xl border border-slate-200 p-2 shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
                <div className="flex gap-1 flex-wrap">
                  {[
                    { k: 'ALL', l: 'All', count: results.length, color: 'slate' },
                    ...Object.entries(clsConfig).map(([k, c]) => ({
                      k,
                      l: c.label,
                      count: counts[k],
                      color: k === 'TRUE_HIT' ? 'red' : k === 'FALSE_HIT' ? 'amber' : k === 'IRRELEVANT_MLTF' ? 'slate' : 'emerald'
                    }))
                  ].map(f => {
                    const isActive = filterType === f.k;
                    return (
                      <button
                        key={f.k}
                        onClick={() => setFilterType(f.k)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                          isActive
                            ? f.color === 'red'     ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-md shadow-red-500/30'
                            : f.color === 'amber'   ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/30'
                            : f.color === 'emerald' ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30'
                            : 'bg-gradient-to-r from-slate-700 to-slate-800 text-white shadow-md shadow-slate-700/30'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {f.l}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-black ${
                          isActive ? 'bg-white/25' : 'bg-slate-200 text-slate-700'
                        }`}>
                          {f.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Point-form result list */}
              <div className="space-y-2">
                {filteredResults.length === 0
                  ? <div className="text-center py-8 text-sm text-slate-400">No results</div>
                  : filteredResults.map(r => <ResultCard key={r.rank} r={r} />)
                }
              </div>

              <button
                onClick={() => { setAnalysisComplete(false); setResults([]); setPdfFile(null); setProgress(0); }}
                className="w-full py-2 rounded-lg text-xs text-slate-500 border border-dashed hover:border-slate-400 hover:text-slate-700"
              >
                🔄 Re-analyze (clear results)
              </button>

              {/* Copyable Poe-Chat-format summary */}
              <div className="bg-slate-50 rounded-xl border p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-slate-700">
                    📋 Analysis Summary (Copy & Paste)
                  </h3>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(summaryText).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      });
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      copied ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-white hover:bg-slate-600'
                    }`}
                  >
                    {copied ? '✅ Copied' : '📋 Copy All'}
                  </button>
                </div>
                <pre className="w-full max-h-96 overflow-y-auto text-xs font-mono bg-white border rounded-lg p-3 whitespace-pre-wrap text-slate-700 select-all">
                  {summaryText}
                </pre>
              </div>
            </>)}

            {!analysisComplete && !isAnalyzing && (
              <div className={`${isSanction ? 'bg-orange-50 border-orange-200' : 'bg-amber-50 border-amber-200'} border rounded-xl p-4`}>
                <div className="flex items-center gap-2 mb-3"><span className="text-lg">🎬</span><h3 className={`text-sm font-bold ${isSanction ? 'text-orange-800' : 'text-amber-800'}`}>Demo 預覽</h3><span className={`text-xs ${isSanction ? 'text-orange-600 bg-orange-100 border-orange-200' : 'text-amber-600 bg-amber-100 border-amber-200'} px-2 py-0.5 rounded-full border`}>使用 Mock 數據</span></div>
                <p className={`text-xs ${isSanction ? 'text-orange-700' : 'text-amber-700'} mb-3`}>以下為模擬分析結果。完成步驟 1-3 後可獲取真實分析結果。</p>
                <div className="space-y-2">{(detectLanguage(searchEntity) === 'zh' ? mockZH : mockEN).map(r => <ResultCard key={r.rank} r={r} />)}</div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'arch' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_8px_rgba(15,23,42,0.04)] p-6">
              <div className="mb-5">
                <h2 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  🔄 {isSanction ? '制裁篩查' : '搜尋'}流程
                </h2>
                <p className="text-xs text-slate-500 mt-1">含網頁全文抓取 · 8 步驟完整流程</p>
              </div>
              
              {/* Timeline */}
              <div className="relative">
                {/* Vertical Line */}
                <div className={`absolute left-[19px] top-2 bottom-2 w-0.5 ${
                  isSanction ? 'bg-gradient-to-b from-orange-300 via-red-300 to-rose-200' : 'bg-gradient-to-b from-blue-300 via-indigo-300 to-purple-200'
                }`} />
                
                {[
                  { n: 1, icon: '📝', t: '輸入實體名稱', d: `系統自動生成 ${isSanction ? '制裁篩查' : 'Google'} 搜尋查詢字串` },
                  { n: 2, icon: '🔍', t: '執行 Google 搜尋', d: '點擊連結在 Google 搜尋，確認搜尋結果' },
                  { n: 3, icon: '📄', t: '儲存為 PDF', d: '使用 Ctrl+P → 另存為 PDF' },
                  { n: 4, icon: '⬆️', t: '上傳 PDF', d: '在步驟 2 上傳剛儲存的 PDF 文件' },
                  { n: 5, icon: '📰', t: '網頁全文抓取（自動）', d: '系統自動從 PDF 中提取外部 URL，透過 /api/scrape 抓取每個網頁的實際內容' },
                  { n: 6, icon: '🤖', t: `AI 分析（${isSanction ? '制裁名單命中' : '基於全文'}）`, d: isSanction ? '將 PDF snippet + 網頁全文合併，AI 基於完整內容判斷是否命中制裁名單' : '將 PDF snippet + 網頁全文合併為 enrichedContent，AI 基於完整內容分析分類' },
                  { n: 7, icon: '🛡️', t: '後處理自動降級', d: '信心度 < 75% 或無匹配關鍵字的 TRUE_HIT 自動降為 IRRELEVANT_MLTF' },
                  { n: 8, icon: '📊', t: '顯示分類結果', d: '按 True Hit / False Hit / Irrelevant / No Hit 分類展示' },
                ].map(s => (
                  <div key={s.n} className="relative flex items-start gap-4 pb-5 last:pb-0">
                    <div className={`relative shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-sm shadow-lg z-10 ${
                      isSanction 
                        ? 'bg-gradient-to-br from-orange-500 to-red-600 shadow-orange-500/30' 
                        : 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-indigo-500/30'
                    }`}>
                      {s.n}
                      <span className="absolute inset-0 rounded-xl ring-2 ring-white" />
                    </div>
                    <div className={`flex-1 rounded-xl p-3 border transition-all hover:shadow-md ${
                      isSanction 
                        ? 'bg-gradient-to-br from-orange-50/50 to-red-50/50 border-orange-100 hover:border-orange-200' 
                        : 'bg-gradient-to-br from-blue-50/50 to-indigo-50/50 border-blue-100 hover:border-blue-200'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base">{s.icon}</span>
                        <span className="font-bold text-slate-900 text-sm">{s.t}</span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{s.d}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

          {activeTab === 'keywords' && (
          <div className="space-y-4">
            {isSanction ? (
              <>
                {['part1', 'part2', 'part3'].map((p, idx) => {
                  const en = [SANCTION_EN_PART1, SANCTION_EN_PART2, SANCTION_EN_PART3][idx];
                  const tw = [SANCTION_ZH_TW_PART1, SANCTION_ZH_TW_PART2, SANCTION_ZH_TW_PART3][idx];
                  const cn = [SANCTION_ZH_CN_PART1, SANCTION_ZH_CN_PART2, SANCTION_ZH_CN_PART3][idx];
                  const partColors = [
                    { bg: 'from-red-500 to-rose-600', text: 'text-red-700', cardBg: 'from-red-50/30 to-rose-50/30' },
                    { bg: 'from-orange-500 to-amber-600', text: 'text-orange-700', cardBg: 'from-orange-50/30 to-amber-50/30' },
                    { bg: 'from-yellow-500 to-orange-500', text: 'text-yellow-700', cardBg: 'from-yellow-50/30 to-orange-50/30' },
                  ][idx];
                  return (
                    <div key={p} className={`bg-gradient-to-br ${partColors.cardBg} rounded-2xl border border-slate-200 shadow-[0_2px_8px_rgba(15,23,42,0.04)] p-5`}>
                      <div className="flex items-center gap-3 mb-4">
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${partColors.bg} flex items-center justify-center text-white font-black shadow-lg`}>
                          {idx + 1}
                        </div>
                        <div>
                          <h2 className="text-sm font-bold text-slate-900 tracking-tight">Part {idx + 1}</h2>
                          <p className="text-[11px] text-slate-500">{en.length} countries · 3 languages</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {[
                          { lang: '🇬🇧 English', list: en, color: 'blue', count: en.length },
                          { lang: '🇹🇼 繁體中文', list: tw, color: 'red', count: tw.length },
                          { lang: '🇨🇳 简体中文', list: cn, color: 'emerald', count: cn.length },
                        ].map(group => (
                          <div key={group.lang} className="bg-white rounded-xl border border-slate-200 p-3">
                            <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
                              <h3 className="text-xs font-bold text-slate-700">{group.lang}</h3>
                              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${
                                group.color === 'blue' ? 'bg-blue-100 text-blue-700' :
                                group.color === 'red' ? 'bg-red-100 text-red-700' :
                                'bg-emerald-100 text-emerald-700'
                              }`}>
                                {group.count}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {group.list.map((kw, i) => (
                                <span 
                                  key={i} 
                                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                                    group.color === 'blue' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                    group.color === 'red' ? 'bg-red-50 text-red-700 border-red-200' :
                                    'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  }`}
                                >
                                  {kw}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div className="bg-gradient-to-r from-orange-500 to-red-600 rounded-2xl p-4 text-white shadow-lg shadow-orange-500/30">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">📊</div>
                    <div className="flex-1 flex flex-wrap gap-3 text-xs">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider opacity-75">Part 1</div>
                        <div className="text-base font-black">{SANCTION_EN_PART1.length}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider opacity-75">Part 2</div>
                        <div className="text-base font-black">{SANCTION_EN_PART2.length}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider opacity-75">Part 3</div>
                        <div className="text-base font-black">{SANCTION_EN_PART3.length}</div>
                      </div>
                      <div className="ml-auto pl-3 border-l border-white/30">
                        <div className="text-[10px] uppercase tracking-wider opacity-75">Total</div>
                        <div className="text-xl font-black">
                          {SANCTION_EN_PART1.length + SANCTION_EN_PART2.length + SANCTION_EN_PART3.length}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_8px_rgba(15,23,42,0.04)] p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                <span className="text-white text-base">🔑</span>
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900 tracking-tight">搜尋關鍵字</h2>
                <p className="text-[11px] text-slate-500">
                  EN + 繁中 + 簡中 · 自動偵測 ·
                  {adverseLang === 'zh_cn' && <span className="ml-1 text-emerald-600 font-bold">當前:🇨🇳 簡體</span>}
                  {adverseLang === 'zh_tw' && <span className="ml-1 text-red-600 font-bold">當前:🇹🇼 繁體</span>}
                  {adverseLang === 'en' && <span className="ml-1 text-blue-600 font-bold">當前:🇬🇧 英文</span>}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { lang: '🇬🇧 English', list: EN_KEYWORDS, color: 'blue', active: adverseLang === 'en' },
                { lang: '🇹🇼 繁體中文', list: ZH_KEYWORDS_TW, color: 'red', active: adverseLang === 'zh_tw' },
                { lang: '🇨🇳 簡體中文', list: ZH_KEYWORDS_CN, color: 'emerald', active: adverseLang === 'zh_cn' },
              ].map(group => (
                <div key={group.lang} className={`rounded-xl border-2 p-4 transition-all ${
                  group.active
                    ? group.color === 'blue' ? 'border-blue-400 bg-blue-50 shadow-md shadow-blue-200'
                      : group.color === 'red' ? 'border-red-400 bg-red-50 shadow-md shadow-red-200'
                      : 'border-emerald-400 bg-emerald-50 shadow-md shadow-emerald-200'
                    : group.color === 'blue' ? 'border-blue-100 bg-blue-50/30'
                      : group.color === 'red' ? 'border-red-100 bg-red-50/30'
                      : 'border-emerald-100 bg-emerald-50/30'
                }`}>
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                    <h3 className={`text-sm font-bold ${
                      group.color === 'blue' ? 'text-blue-700'
                        : group.color === 'red' ? 'text-red-700'
                        : 'text-emerald-700'
                    }`}>
                      {group.lang}
                      {group.active && <span className="ml-1 text-[10px] font-black bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded-full">✓ 使用中</span>}
                    </h3>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-md text-white ${
                      group.color === 'blue' ? 'bg-blue-500'
                        : group.color === 'red' ? 'bg-red-500'
                        : 'bg-emerald-500'
                    }`}>{group.list.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.list.map((kw, i) => (
                      <span key={i} className={`bg-white border px-2 py-1 rounded-md text-[11px] font-semibold shadow-sm hover:shadow-md transition-all ${
                        group.color === 'blue' ? 'text-blue-700 border-blue-200'
                          : group.color === 'red' ? 'text-red-700 border-red-200'
                          : 'text-emerald-700 border-emerald-200'
                      }`}>
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
       </div>
      )}
    </div>
  </div>
 );
}
/* ── Wrapper Components（保持 API 不變）── */
function AdverseMediaScreening({ entityName, onFlagSTR }) {
  return <ScreeningModule entityName={entityName} mode="adverseMedia" onFlagSTR={onFlagSTR} />;
}

function SanctionScreening({ entityName, onFlagSTR }) {
  return <ScreeningModule entityName={entityName} mode="sanction" onFlagSTR={onFlagSTR} />;
}


/* =============== MAIN COMPONENT =============== */
export default function KYCSystem() {
  const [lang, setLang] = useState('zh');
  const t = i18n[lang];
  const [entities, setEntities] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [view, setView] = useState('workspace');
  const [selectedId, setSelectedId] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [settings, setSettings] = useState({ weights: { ...DEFAULT_WEIGHTS }, uboThreshold: 25, highRisk: [...DEFAULT_HIGH_RISK], offshore: [...DEFAULT_OFFSHORE], monitored: [...DEFAULT_MONITORED] });
  const [snapshots, setSnapshots] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [batchSelected, setBatchSelected] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [dagSelected, setDagSelected] = useState(null);
  const [workspaceTab, setWorkspaceTab] = useState('list');
  const [mobileSideOpen, setMobileSideOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  React.useEffect(() => {
    const id = 'kyc-dark-style';
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    el.textContent = `
      /* Animation Keyframes */
      @keyframes kycFadeIn { from { opacity: 0 } to { opacity: 1 } }
      @keyframes kycSlideUp { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
      @keyframes kycPulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }
      
      /* Smooth Scrollbar */
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { 
        background: ${darkMode ? '#334155' : '#cbd5e1'}; 
        border-radius: 4px; 
        transition: background 0.2s;
      }
      ::-webkit-scrollbar-thumb:hover { 
        background: ${darkMode ? '#475569' : '#94a3b8'}; 
      }
      
      /* Body Font Smoothing */
      body { 
        -webkit-font-smoothing: antialiased; 
        -moz-osx-font-smoothing: grayscale;
      }
      
      ${darkMode ? `
        /* Dark Mode Backgrounds */
        .dm .bg-white { background-color: #0f172a !important; }
        .dm .bg-slate-50, .dm .bg-gray-50 { background-color: #020617 !important; }
        .dm .bg-slate-100, .dm .bg-gray-100 { background-color: #1e293b !important; }
        .dm .bg-slate-200, .dm .bg-gray-200 { background-color: #334155 !important; }
        
        /* Dark Mode Text */
        .dm .text-slate-900, .dm .text-gray-900, .dm .text-gray-800 { color: #f1f5f9 !important; }
        .dm .text-slate-800, .dm .text-gray-700 { color: #e2e8f0 !important; }
        .dm .text-slate-700, .dm .text-gray-600 { color: #cbd5e1 !important; }
        .dm .text-slate-600 { color: #94a3b8 !important; }
        .dm .text-slate-500, .dm .text-gray-500 { color: #64748b !important; }
        .dm .text-slate-400, .dm .text-gray-400 { color: #475569 !important; }
        
        /* Dark Mode Borders */
        .dm .border, .dm .border-b { border-color: #1e293b !important; }
        .dm .border-slate-100, .dm .border-slate-200, 
        .dm .border-gray-100, .dm .border-gray-200 { border-color: #1e293b !important; }
        .dm .border-slate-300, .dm .border-gray-300 { border-color: #334155 !important; }
        
        /* Dark Mode Form Inputs */
        .dm input, .dm select, .dm textarea { 
          background-color: #1e293b !important; 
          color: #f1f5f9 !important; 
          border-color: #334155 !important; 
        }
        .dm input::placeholder, .dm textarea::placeholder { color: #475569 !important; }
        
        /* Dark Mode Hover States */
        .dm .hover\\:bg-slate-50:hover, .dm .hover\\:bg-slate-100:hover,
        .dm .hover\\:bg-gray-50:hover, .dm .hover\\:bg-gray-100:hover { 
          background-color: #1e293b !important; 
        }
        .dm .hover\\:bg-blue-50:hover { background-color: rgba(59,130,246,0.1) !important; }
        
        /* Dark Mode Tinted Backgrounds */
        .dm .bg-amber-50 { background-color: rgba(245,158,11,0.08) !important; }
        .dm .bg-red-50 { background-color: rgba(239,68,68,0.08) !important; }
        .dm .bg-blue-50 { background-color: rgba(59,130,246,0.08) !important; }
        .dm .bg-emerald-50, .dm .bg-green-50 { background-color: rgba(16,185,129,0.08) !important; }
        .dm .bg-indigo-50 { background-color: rgba(99,102,241,0.08) !important; }
        .dm .bg-purple-50 { background-color: rgba(168,85,247,0.08) !important; }
        .dm .bg-cyan-50 { background-color: rgba(6,182,212,0.08) !important; }
        .dm .bg-orange-50 { background-color: rgba(249,115,22,0.08) !important; }
        .dm .bg-teal-50 { background-color: rgba(20,184,166,0.08) !important; }
        
        /* Dark Mode Shadows */
        .dm .shadow-sm, .dm .shadow, .dm .shadow-md { 
          box-shadow: 0 2px 8px rgba(0,0,0,0.4) !important; 
        }
        .dm .shadow-lg, .dm .shadow-xl, .dm .shadow-2xl { 
          box-shadow: 0 8px 32px rgba(0,0,0,0.6) !important; 
        }
      ` : ''}
    `;
  }, [darkMode]);
   // ★★★ 新增：UBO Hook（一次性建立 graph 索引並提供三個函數）
  const { findUBOs, wouldCreateCycle, getRelPercentage } = useUBO(entities, relationships);
  const [svgTransform, setSvgTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [hoveredNode, setHoveredNode] = useState(null);
  const [entityFilter, setEntityFilter] = useState('');
  const [isPanning, setIsPanning] = useState(false);          // ⬅ NEW
  const panStartRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });   // ⬅ NEW
  const [modalType, setModalType] = useState(null);
  const [modalData, setModalData] = useState({});
  const [settingsTab, setSettingsTab] = useState('weights');
  const [showSnapCompare, setShowSnapCompare] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [snapDescInput, setSnapDescInput] = useState('');
  const [expandedCDD, setExpandedCDD] = useState(null);
  const svgRef = useRef(null);
  const indLabel = (key) => lang === 'zh' && INDUSTRY_LABELS_ZH[key] ? INDUSTRY_LABELS_ZH[key] : key;

  const tR = (r) => t[r] || r;
  const toastTimerRef = useRef(null);
  const showToast = (msg) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2500);
  };
  const openModal = useCallback((type, data = {}) => { setModalType(type); setModalData(data); }, []);
  const closeModal = useCallback(() => { setModalType(null); setModalData({}); }, []);
  const setD = useCallback((k, v) => setModalData(prev => ({ ...prev, [k]: v })), []);

  const loadSampleData = () => { setEntities(JSON.parse(JSON.stringify(SAMPLE_ENTITIES))); setRelationships(JSON.parse(JSON.stringify(SAMPLE_RELS))); setBatchSelected(new Set()); setDagSelected(null); setSelectedId(null); showToast(t.sampleLoaded); };
  const clearAllData = () => { setEntities([]); setRelationships([]); setBatchSelected(new Set()); setDagSelected(null); setSelectedId(null); };

  function getOwnershipDepth(eid, visited = new Set()) {
    if (visited.has(eid)) return 0; visited.add(eid);
    const ch = relationships.filter(r => r.sourceId === eid && (r.type === 'ownership' || r.type === 'control'));
    return ch.length === 0 ? 0 : 1 + Math.max(...ch.map(c => getOwnershipDepth(c.targetId, visited)));
  }

  const isAutoHighRisk = (entity) => AUTO_HIGH_RISK_SUBTYPES.includes(entity.subType);
  const isSddEligible = (entity) => entity.type === 'company' && SDD_ELIGIBLE_CATEGORIES.includes(entity.companyCategory);
  const getCategoryLabel = (cat) => { const map = { private: t.catPrivate, listed: t.catListed, government: t.catGovernment, stateOwned: t.catStateOwned }; return map[cat] || cat || ''; };
  const hasDuplicateRel = useCallback((sourceId, targetId, type, excludeRelId = null) => {
    return relationships.some(r => r.id !== excludeRelId && r.sourceId === sourceId && r.targetId === targetId && r.type === type);
  }, [relationships]);

  const wouldExceedShares = useCallback((targetId, newShares, excludeRelId = null) => {
    const target = entities.find(e => e.id === targetId);
    if (!target?.totalShares || !newShares) return false;
    const existingShares = relationships.filter(r => r.targetId === targetId && r.type === 'ownership' && r.id !== excludeRelId).reduce((s, r) => s + (r.shares || 0), 0);
    return (existingShares + parseInt(newShares)) > target.totalShares;
  }, [entities, relationships]);

  const wouldExceedPercentage = useCallback((targetId, newPct, excludeRelId = null) => {
    if (!newPct) return false;
    const existingPct = relationships.filter(r => r.targetId === targetId && r.type === 'ownership' && r.id !== excludeRelId).reduce((s, r) => s + (getRelPercentage(r) || 0), 0);
    return (existingPct + parseFloat(newPct)) > 100;
  }, [entities, relationships, getRelPercentage]);

    const getDDLevel = (entity) => {
    if (isSddEligible(entity)) return 'sdd';
    const eff = getEffectiveRating(entity);
    if (eff.rating === 'High') return 'edd';
    if (HIGH_RISK_INDUSTRIES.includes(entity.industry)) return 'edd';
    return 'cdd';
  };

  const calcNextReviewDate = (rating, fromDate) => {
    const d = new Date(fromDate || today);
    if (rating === 'High') d.setFullYear(d.getFullYear() + 1);
    else if (rating === 'Medium') d.setFullYear(d.getFullYear() + 2);
    else d.setFullYear(d.getFullYear() + 3);
    return d.toISOString().slice(0, 10);
  };

  const isExpiringIn30 = (expiry) => {
    if (!expiry) return false;
    const diff = (new Date(expiry) - new Date(today)) / (1000 * 60 * 60 * 24);
    return diff > 0 && diff <= 30;
  };

    const calcCRR = useCallback((entity) => {
    if (isAutoHighRisk(entity)) return { score: 100, rating: 'High', breakdown: { jurisdiction: 100, pep: 0, sanctions: 100, negativeNews: 0, entityType: 100, ownership: 100, industry: 100 }, autoHighRisk: true, jurisdictionForced: false, sanctionForced: false, pepForced: false };
    const w = settings.weights;
    let jScore = settings.highRisk.includes(entity.jurisdiction) ? 100 : settings.offshore.includes(entity.jurisdiction) ? 80 : settings.monitored.includes(entity.jurisdiction) ? 50 : 15;
    const pepScore = entity.isPEP ? 100 : 0;
    const sanctScore = entity.isSanctioned ? 100 : 0;
    const newsScore = entity.negativeNews ? 85 : 0;
    let typeScore = ['Trust', 'Foundation', 'SPV'].includes(entity.subType) ? 85 : ['Holding Company', 'Shell Company'].includes(entity.subType) ? 60 : entity.subType === 'Trading Company' ? 35 : 20;
    const depth = getOwnershipDepth(entity.id);
    let ownScore = Math.min(100, depth * 30);
    const industryScore = HIGH_RISK_INDUSTRIES.includes(entity.industry) ? 100 : MEDIUM_RISK_INDUSTRIES.includes(entity.industry) ? 50 : 10;
    const total = w.jurisdiction + w.pep + w.sanctions + w.negativeNews + w.entityType + w.ownership + (w.industry || 0);
    const score = total > 0 ? Math.round((jScore * w.jurisdiction + pepScore * w.pep + sanctScore * w.sanctions + newsScore * w.negativeNews + typeScore * w.entityType + ownScore * w.ownership + industryScore * (w.industry || 0)) / total) : 0;
    const rOrder = { Low: 0, Medium: 1, High: 2 };
    let minRating = 'Low';
    if (settings.highRisk.includes(entity.jurisdiction)) minRating = 'High';
    else if (settings.offshore.includes(entity.jurisdiction)) minRating = 'Medium';
    else if (settings.monitored.includes(entity.jurisdiction)) minRating = 'Medium';
    let rating = score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low';
    const rawRating = rating;
    if (rOrder[minRating] > rOrder[rating]) rating = minRating;
    if (entity.isSanctioned) return { score: 100, rating: 'High', breakdown: { jurisdiction: jScore, pep: pepScore, sanctions: 100, negativeNews: newsScore, entityType: typeScore, ownership: ownScore, industry: industryScore }, autoHighRisk: false, sanctionForced: true, jurisdictionForced: false, pepForced: false };
    let pepForced = false;
    if (entity.isPEP && rating !== 'High') { pepForced = true; rating = 'High'; }
    return { score, rating, breakdown: { jurisdiction: jScore, pep: pepScore, sanctions: sanctScore, negativeNews: newsScore, entityType: typeScore, ownership: ownScore, industry: industryScore }, autoHighRisk: false, jurisdictionForced: rOrder[minRating] > rOrder[rawRating], pepForced };
  }, [entities, relationships, settings]);

  const getEffectiveRating = (entity) => { const crr = calcCRR(entity); if (crr.autoHighRisk) return { ...crr, overridden: false }; if (crr.pepForced) return { ...crr, overridden: false }; return entity.riskOverride ? { ...crr, rating: entity.riskOverride.rating, overridden: true } : { ...crr, overridden: false }; };
  const autoTodos = useMemo(() => {
    const todos = [];
    entities.forEach(ent => {
      if (ent.nextReviewDate && ent.nextReviewDate < today) todos.push({ id: `t-r-${ent.id}`, entityId: ent.id, type: 'overdue', text: lang === 'zh' ? `${ent.name} 審查已逾期（${ent.nextReviewDate}）` : `Review overdue: ${ent.name} (${ent.nextReviewDate})`, priority: 'high' });
      const expD = (ent.documents || []).filter(d => d.status === 'expired' || (d.expiry && d.expiry < today));
      if (expD.length > 0) todos.push({ id: `t-d-${ent.id}`, entityId: ent.id, type: 'exp_doc', text: lang === 'zh' ? `${ent.name} ${expD.length} 份文件過期` : `${expD.length} expired doc(s): ${ent.name}`, priority: 'medium' });
      const soonExpDocs = (ent.documents || []).filter(d => d.status === 'received' && isExpiringIn30(d.expiry));
      if (soonExpDocs.length > 0) todos.push({ id: `t-de-${ent.id}`, entityId: ent.id, type: 'exp_soon', text: lang === 'zh' ? `${ent.name} ${soonExpDocs.length} 份文件即將到期（30天內）` : `${soonExpDocs.length} doc(s) expiring soon: ${ent.name}`, priority: 'medium' });
      if (ent.isSanctioned) todos.push({ id: `t-s-${ent.id}`, entityId: ent.id, type: 'sanction', text: lang === 'zh' ? `緊急：${ent.name} 命中制裁` : `URGENT: Sanctions hit ${ent.name}`, priority: 'critical' });
      if (getEffectiveRating(ent).rating === 'High' && !ent.str?.flagged) todos.push({ id: `t-st-${ent.id}`, entityId: ent.id, type: 'str', text: lang === 'zh' ? `高風險 ${ent.name}：考慮 STR` : `High-risk ${ent.name}: consider STR`, priority: 'high' });
      if ((ent.screeningLogs || []).length === 0) todos.push({ id: `t-sc-${ent.id}`, entityId: ent.id, type: 'no_screen', text: lang === 'zh' ? `${ent.name} 無篩查記錄` : `No screening: ${ent.name}`, priority: 'medium' });
      const rels = relationships.filter(r => r.sourceId === ent.id || r.targetId === ent.id);
      if (rels.length === 0) todos.push({ id: `t-nr-${ent.id}`, entityId: ent.id, type: 'no_rel', text: lang === 'zh' ? `${ent.name} 尚無任何關係` : `No relationships: ${ent.name}`, priority: 'medium' });
    });
    return todos.sort((a, b) => { const o = { critical: 0, high: 1, medium: 2, low: 3 }; return (o[a.priority] ?? 3) - (o[b.priority] ?? 3); });
  }, [entities, relationships, settings, lang]);

  const dagLayout = useMemo(() => {
    if (entities.length === 0) return { positions: {}, W: 700, H: 350 };
    const childMap = {}, parentMap = {};
    entities.forEach(e => { childMap[e.id] = []; parentMap[e.id] = []; });
    relationships.forEach(r => { if (['ownership', 'control'].includes(r.type)) { if (childMap[r.sourceId]) childMap[r.sourceId].push(r.targetId); if (parentMap[r.targetId]) parentMap[r.targetId].push(r.sourceId); } });
    const roots = entities.filter(e => parentMap[e.id]?.length === 0).map(e => e.id);
    const layers = {}, visited = new Set(), queue = roots.map(id => [id, 0]);
    while (queue.length > 0) { const [id, layer] = queue.shift(); if (visited.has(id)) { layers[id] = Math.max(layers[id] || 0, layer); continue; } visited.add(id); layers[id] = layer; (childMap[id] || []).forEach(cid => queue.push([cid, layer + 1])); }
    entities.forEach(e => { if (!(e.id in layers)) layers[e.id] = 0; });
    const groups = {}; Object.entries(layers).forEach(([id, l]) => { if (!groups[l]) groups[l] = []; groups[l].push(id); });
    const maxPerLayer = Math.max(...Object.values(groups).map(g => g.length), 1);
    const W = Math.max(700, maxPerLayer * 170); const positions = {};
    Object.entries(groups).forEach(([l, ids]) => { const y = parseInt(l) * 130 + 50; const gap = W / (ids.length + 1); ids.forEach((id, i) => { positions[id] = { x: gap * (i + 1) - 65, y }; }); });
    const maxLayer = Math.max(...Object.values(layers), 0);
    return { positions, W, H: (maxLayer + 1) * 130 + 80 };
  }, [entities, relationships]);

  const connectedSet = useMemo(() => {
    if (!dagSelected) return null;
    const anc = new Set(), desc = new Set();
    const q1 = [dagSelected]; while (q1.length) { const id = q1.shift(); relationships.forEach(r => { if ((r.type === 'ownership' || r.type === 'control') && r.targetId === id && !anc.has(r.sourceId)) { anc.add(r.sourceId); q1.push(r.sourceId); } }); }
    const q2 = [dagSelected]; while (q2.length) { const id = q2.shift(); relationships.forEach(r => { if ((r.type === 'ownership' || r.type === 'control') && r.sourceId === id && !desc.has(r.targetId)) { desc.add(r.targetId); q2.push(r.targetId); } }); }
    return new Set([dagSelected, ...anc, ...desc]);
  }, [dagSelected, relationships]);

  const updateEntity = useCallback((id, up) => setEntities(prev => prev.map(e => e.id === id ? { ...e, ...up } : e)), []);
  const deleteEntity = (id) => { setEntities(prev => prev.filter(e => e.id !== id)); setRelationships(prev => prev.filter(r => r.sourceId !== id && r.targetId !== id)); if (selectedId === id) setSelectedId(null); setDagSelected(null); };
  const deleteMultipleEntities = (ids) => { const s = new Set(ids); setEntities(prev => prev.filter(e => !s.has(e.id))); setRelationships(prev => prev.filter(r => !s.has(r.sourceId) && !s.has(r.targetId))); if (s.has(selectedId)) setSelectedId(null); setDagSelected(null); setBatchSelected(new Set()); };
  const deleteRel = (id) => setRelationships(prev => prev.filter(r => r.id !== id));
  const updateRel = (id, up) => setRelationships(prev => prev.map(r => r.id === id ? { ...r, ...up } : r));

  const deleteSnapshot = (snapId) => { setSnapshots(prev => prev.filter(s => s.id !== snapId)); showToast(t.snapshotDeleted); };
  const deleteAllSnapshots = () => { setSnapshots([]); showToast(t.snapshotDeleted); };

  const saveCDDRecord = (entId, reviewer, type, status, summary) => {
    const ent = entities.find(e => e.id === entId); if (!ent) return;
    const crr = calcCRR(ent);
    const record = { id: gid(), date: today, reviewer, type, status, summary, snapshot: { isPEP: ent.isPEP, pepCategory: ent.pepCategory || '', isSanctioned: ent.isSanctioned, negativeNews: ent.negativeNews, riskOverride: ent.riskOverride ? JSON.parse(JSON.stringify(ent.riskOverride)) : null, documents: JSON.parse(JSON.stringify(ent.documents)), screeningLogs: JSON.parse(JSON.stringify(ent.screeningLogs)), notes: JSON.parse(JSON.stringify(ent.notes)), str: ent.str ? JSON.parse(JSON.stringify(ent.str)) : null, lastReviewDate: ent.lastReviewDate, nextReviewDate: ent.nextReviewDate, riskScore: crr.score, riskRating: crr.rating } };
    updateEntity(entId, { cddRecords: [...(ent.cddRecords || []), record] });
    showToast(t.cddSaveSuccess);
  };

  const restoreCDDRecord = (entId, recordId) => {
    const ent = entities.find(e => e.id === entId); if (!ent) return;
    const rec = (ent.cddRecords || []).find(r => r.id === recordId); if (!rec) return;
    const s = rec.snapshot;
    updateEntity(entId, { isPEP: s.isPEP, pepCategory: s.pepCategory || '', isSanctioned: s.isSanctioned, negativeNews: s.negativeNews, riskOverride: s.riskOverride ? JSON.parse(JSON.stringify(s.riskOverride)) : null, documents: JSON.parse(JSON.stringify(s.documents)), screeningLogs: JSON.parse(JSON.stringify(s.screeningLogs)), notes: JSON.parse(JSON.stringify(s.notes)), str: s.str ? JSON.parse(JSON.stringify(s.str)) : null, lastReviewDate: s.lastReviewDate, nextReviewDate: s.nextReviewDate });
    showToast(t.cddRestoreSuccess);
    setExpandedCDD(null);
  };

  const getRelValidationErrors = useCallback((sourceId, targetId, type, shares, percentage, inputMode, excludeRelId = null) => {
    const errors = [];
    if (!sourceId || !targetId) return errors;
    if (sourceId === targetId) errors.push(t.selfRelWarning);
    if (type === 'ownership' && entities.find(e => e.id === targetId)?.type === 'person') errors.push(t.personCannotBeOwned);
    if (hasDuplicateRel(sourceId, targetId, type, excludeRelId)) errors.push(t.duplicateRelWarning);
    if ((type === 'ownership' || type === 'control') && wouldCreateCycle(sourceId, targetId, excludeRelId)) errors.push(t.circularRelWarning);
    if (type === 'ownership' && inputMode !== 'percentage' && shares) {
      const target = entities.find(e => e.id === targetId);
      if (target?.totalShares && wouldExceedShares(targetId, shares, excludeRelId)) {
        const existingShares = relationships.filter(r => r.targetId === targetId && r.type === 'ownership' && r.id !== excludeRelId).reduce((s, r) => s + (r.shares || 0), 0);
        errors.push(t.sharesExceedWarning.replace('{allocated}', String(existingShares + parseInt(shares))).replace('{total}', String(target.totalShares)));
      }
    }
    if (type === 'ownership' && inputMode === 'percentage' && percentage) {
      if (wouldExceedPercentage(targetId, percentage, excludeRelId)) errors.push(t.percentageExceeds100);
    }
    return errors;
  }, [entities, relationships, t, hasDuplicateRel, wouldCreateCycle, wouldExceedShares, wouldExceedPercentage]);

    const exportCSV = () => {
    const headers = ['Name','Type','SubType','Category','Jurisdiction','Industry','Risk Rating','CRR Score','PEP','Sanctioned','Last Review','Next Review','DD Level'];
    const rows = entities.map(e => { const r = getEffectiveRating(e); return [e.name, e.type, e.subType, getCategoryLabel(e.companyCategory), e.jurisdiction, e.industry || '', r.rating, r.score, e.isPEP, e.isSanctioned, e.lastReviewDate, e.nextReviewDate, getDDLevel(e).toUpperCase()]; });
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `kyc_entities_${today}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const selectedEntity = entities.find(e => e.id === selectedId);
  const filteredEntities = entities.filter(e => !entityFilter || e.name.toLowerCase().includes(entityFilter.toLowerCase()) || e.jurisdiction.toLowerCase().includes(entityFilter.toLowerCase()) || e.subType.toLowerCase().includes(entityFilter.toLowerCase()));

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null; const q = searchQuery.toLowerCase();
    return { entities: entities.filter(e => e.name.toLowerCase().includes(q) || e.jurisdiction.toLowerCase().includes(q)), notes: entities.flatMap(e => e.notes.filter(n => n.text.toLowerCase().includes(q)).map(n => ({ ...n, entityName: e.name, entityId: e.id }))), todos: autoTodos.filter(td => td.text.toLowerCase().includes(q)) };
  }, [searchQuery, entities, autoTodos]);

  const snapDiff = useMemo(() => {
    if (!showSnapCompare || showSnapCompare.length !== 2) return null;
    const [a, b] = showSnapCompare.map(id => snapshots.find(s => s.id === id)); if (!a || !b) return null;
    const aIds = new Set(a.entities.map(e => e.id)), bIds = new Set(b.entities.map(e => e.id));
    return { a, b, added: b.entities.filter(e => !aIds.has(e.id)), removed: a.entities.filter(e => !bIds.has(e.id)), changed: b.entities.filter(e => { if (!aIds.has(e.id)) return false; const ae = a.entities.find(x => x.id === e.id); return ae && (ae.name !== e.name || ae.jurisdiction !== e.jurisdiction); }) };
  }, [showSnapCompare, snapshots]);

  const fmtShares = (n) => n != null ? n.toLocaleString() : '—';
  const fmtRelLabel = (r) => { const pct = getRelPercentage(r); if (r.shares && pct != null) return `${fmtShares(r.shares)}${t.sharesUnit} (${pct}%)`; if (pct != null) return `${pct}%`; if (r.shares) return `${fmtShares(r.shares)}${t.sharesUnit}`; return ''; };

  const companySubTypes = [{ v: 'Holding Company', l: lang === 'zh' ? '控股公司' : 'Holding Company' }, { v: 'Trading Company', l: lang === 'zh' ? '貿易公司' : 'Trading Company' }, { v: 'Operating Company', l: lang === 'zh' ? '營運公司' : 'Operating Company' }, { v: 'Shell Company', l: lang === 'zh' ? '空殼公司' : 'Shell Company' }, { v: 'SPV', l: 'SPV' }, { v: 'Trust', l: lang === 'zh' ? '信託' : 'Trust' }, { v: 'Foundation', l: lang === 'zh' ? '基金會' : 'Foundation' }, { v: 'Investment Fund', l: lang === 'zh' ? '投資基金' : 'Investment Fund' }, { v: 'Bank/FI', l: lang === 'zh' ? '銀行/金融機構' : 'Bank/FI' }];
  const personSubTypes = [{ v: 'Individual', l: lang === 'zh' ? '個人' : 'Individual' }, { v: 'Director', l: lang === 'zh' ? '董事' : 'Director' }, { v: 'Shareholder', l: lang === 'zh' ? '股東' : 'Shareholder' }, { v: 'Beneficiary', l: lang === 'zh' ? '受益人' : 'Beneficiary' }, { v: 'Nominee', l: lang === 'zh' ? '代名人' : 'Nominee' }, { v: 'Nominee Shareholder', l: lang === 'zh' ? '代名股東' : 'Nominee Shareholder' }, { v: 'Trustee', l: lang === 'zh' ? '受託人' : 'Trustee' }, { v: 'Protector', l: lang === 'zh' ? '保護人' : 'Protector' }, { v: 'Settlor', l: lang === 'zh' ? '委託人' : 'Settlor' }];
  const companyCategoryOptions = [{ v: 'private', l: t.catPrivate }, { v: 'listed', l: t.catListed }, { v: 'government', l: t.catGovernment }, { v: 'stateOwned', l: t.catStateOwned }];
  const relTypes = [{ v: 'ownership', l: t.ownershipType }, { v: 'control', l: t.controlType }, { v: 'rca', l: t.rcaType }, { v: 'association', l: t.associationType }];
  const pepCategories = [{ v: 'foreign', l: t.pepForeign }, { v: 'domestic', l: t.pepDomestic }, { v: 'international', l: t.pepInternational }, { v: 'family', l: t.pepFamilyMember }, { v: 'associate', l: t.pepCloseAssociate }];
  const cddTypes = [{ v: 'initial', l: t.cddInitial }, { v: 'periodic', l: t.cddPeriodic }, { v: 'event', l: t.cddEvent }];
  const cddStatuses = [{ v: 'completed', l: t.cddCompleted }, { v: 'inProgress', l: t.cddInProgress }, { v: 'pendingApproval', l: t.cddPendingApproval }];
  const cddStatusColor = { completed: 'green', inProgress: 'blue', pendingApproval: 'amber' };
  const cddTypeIcon = { initial: '🆕', periodic: '🔄', event: '⚡' };

  const DDLevelBadge = ({ entity }) => {
    const level = getDDLevel(entity);
    const config = { sdd: { color: 'cyan', label: t.sdd }, cdd: { color: 'blue', label: t.cdd }, edd: { color: 'red', label: t.edd } };
    return <BadgeC color={config[level].color}>{config[level].label}</BadgeC>;
  };

  const renderRelForm = (data, setField, isEdit) => {
    const isOwnership = (data.type || 'ownership') === 'ownership';
    const validationErrors = getRelValidationErrors(data.sourceId, data.targetId, data.type || 'ownership', (data.inputMode || 'shares') === 'shares' ? data.shares : null, data.inputMode === 'percentage' ? data.percentage : null, data.inputMode || 'shares', isEdit ? data.id : null);
    return (<div className="space-y-3">
      <FormField label={t.sourceOwner}><select value={data.sourceId || ''} onChange={e => setField('sourceId', e.target.value)} className="w-full border rounded px-3 py-2 text-sm"><option value="">{t.selectType}</option>{entities.map(e => <option key={e.id} value={e.id}>{e.type === 'person' ? '👤' : '🏢'} {e.name}</option>)}</select></FormField>
      <FormField label={t.targetOwned}><select value={data.targetId || ''} onChange={e => setField('targetId', e.target.value)} className="w-full border rounded px-3 py-2 text-sm"><option value="">{t.selectType}</option>{entities.filter(e => { if (isOwnership) return e.type === 'company'; return true; }).map(e => <option key={e.id} value={e.id}>{e.type === 'person' ? '👤' : '🏢'} {e.name}{e.totalShares ? ` (${fmtShares(e.totalShares)} ${t.sharesUnit})` : ''}</option>)}</select></FormField>
      <FormField label={t.type}><select value={data.type || 'ownership'} onChange={e => setField('type', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">{relTypes.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}</select></FormField>
      {isOwnership && !validationErrors.some(e => e.includes(t.personCannotBeOwned)) && (<div className="bg-blue-50 rounded-lg p-3">
        <div className="flex gap-4 mb-3"><label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name={`relMode-${isEdit ? 'edit' : 'add'}`} checked={(data.inputMode || 'shares') === 'shares'} onChange={() => setField('inputMode', 'shares')} /><span className="text-xs font-medium">{t.inputByShares}</span></label><label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name={`relMode-${isEdit ? 'edit' : 'add'}`} checked={data.inputMode === 'percentage'} onChange={() => setField('inputMode', 'percentage')} /><span className="text-xs font-medium">{t.inputByPercentage}</span></label></div>
        {(data.inputMode || 'shares') === 'shares' ? (<div><FormField label={t.sharesLabel}><input type="number" min="0" value={data.shares || ''} onChange={e => setField('shares', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" /></FormField>{(() => { const tgt = entities.find(e => e.id === data.targetId); const autoP = tgt?.totalShares > 0 && data.shares ? Math.round((parseInt(data.shares) / tgt.totalShares) * 10000) / 100 : null; return tgt?.totalShares > 0 ? <div className="mt-2 text-xs"><span className="text-gray-500">{t.totalSharesLabel}: {fmtShares(tgt.totalShares)} → </span>{autoP != null && <span className="font-bold text-green-600">{t.autoCalcPercentage}: {autoP}%</span>}</div> : data.targetId ? <div className="mt-2 text-xs text-amber-600">⚠️ {t.noTotalSharesWarning}</div> : null; })()}</div>) : (<FormField label={t.percentage}><input type="number" min="0" max="100" value={data.percentage || ''} onChange={e => setField('percentage', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" placeholder="%" /></FormField>)}
      </div>)}
      <FormField label={t.description}><input value={data.description || ''} onChange={e => setField('description', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" /></FormField>
      {validationErrors.length > 0 && <div className="space-y-1">{validationErrors.map((err, i) => <div key={i} className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-700">{err}</div>)}</div>}
    </div>);
  };

  const EmptyState = useMemo(() => () => (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        {/* Decorative Icon */}
        <div className="relative w-24 h-24 mx-auto mb-6">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-400 to-indigo-600 rounded-3xl rotate-6 opacity-20 blur-xl" />
          <div className="relative w-24 h-24 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-3xl flex items-center justify-center shadow-xl shadow-indigo-500/30">
            <Shield className="w-12 h-12 text-white" strokeWidth={2} />
          </div>
        </div>
        
        <h3 className="text-2xl font-bold tracking-tight text-slate-900 mb-2">{t.emptyStateTitle}</h3>
        <p className="text-sm text-slate-500 mb-8 leading-relaxed">{t.emptyStateDesc}</p>
        
        <div className="flex flex-col gap-3">
          <button 
            onClick={() => openModal('addEntity', { name: '', type: 'company', subType: '', jurisdiction: 'USA', totalShares: '', companyCategory: 'private', industry: '' })} 
            className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white px-5 py-3 rounded-xl text-sm font-bold shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 transition-all w-full"
          >
            ✨ {t.addEntity}
          </button>
          <button 
            onClick={loadSampleData} 
            className="bg-white border-2 border-dashed border-slate-300 text-slate-600 px-5 py-3 rounded-xl text-sm font-semibold hover:border-blue-400 hover:bg-blue-50/30 hover:text-blue-600 transition-all w-full"
          >
            <div>{t.loadSample}</div>
            <div className="text-[11px] text-slate-400 mt-0.5 font-normal">{t.loadSampleDesc}</div>
          </button>
        </div>
      </div>
    </div>
  ), [t, lang]);

  const SDDBanner = ({ entity }) => { if (!isSddEligible(entity)) return null; return (<div className="bg-cyan-50 border border-cyan-300 rounded-lg p-3 flex items-start gap-2"><span className="text-lg shrink-0">🔵</span><div><div className="text-xs font-bold text-cyan-800">SDD</div><div className="text-xs text-cyan-700 mt-0.5">{t.sddEligible.replace('{type}', getCategoryLabel(entity.companyCategory))}</div></div></div>); };
  const AutoHighRiskBanner = ({ entity }) => { if (!isAutoHighRisk(entity)) return null; return (<div className="bg-red-50 border border-red-300 rounded-lg p-3 flex items-start gap-2"><span className="text-lg shrink-0">🔴</span><div><div className="text-xs font-bold text-red-800">{t.annualReview}</div><div className="text-xs text-red-700 mt-0.5">{t.autoHighRiskNotice.replace('{subType}', entity.subType)}</div></div></div>); };
  const EDDBanner = ({ entity }) => { if (isSddEligible(entity) || isAutoHighRisk(entity)) return null; const eff = getEffectiveRating(entity); if (eff.rating !== 'High') return null; return (<div className="bg-orange-50 border border-orange-300 rounded-lg p-3 flex items-start gap-2"><span className="text-lg shrink-0">🟠</span><div><div className="text-xs font-bold text-orange-800">EDD</div><div className="text-xs text-orange-700 mt-0.5">{t.eddRequired}</div></div></div>); };
  const IndustryEDDBanner = ({ entity }) => {
    if (!HIGH_RISK_INDUSTRIES.includes(entity.industry)) return null;
    if (isSddEligible(entity) || isAutoHighRisk(entity)) return null;
    if (getEffectiveRating(entity).rating === 'High') return null;
    return (<div className="bg-orange-50 border border-orange-300 rounded-lg p-3 flex items-start gap-2"><span className="text-lg shrink-0">🏭</span><div><div className="text-xs font-bold text-orange-800">{t.highRiskIndustry}</div><div className="text-xs text-orange-700 mt-0.5">{t.autoEDDIndustry}</div></div></div>);
  };

  // ====== DASHBOARD ======
  const renderDashboard = () => {
    if (entities.length === 0) return <EmptyState />;
    const riskDist = { High: 0, Medium: 0, Low: 0 }; entities.forEach(e => { riskDist[getEffectiveRating(e).rating]++; });
    const pieData = Object.entries(riskDist).map(([k, v]) => ({ name: tR(k), value: v, key: k }));
    const barData = Object.entries(entities.reduce((a, e) => { a[e.subType || e.type] = (a[e.subType || e.type] || 0) + 1; return a; }, {})).map(([k, v]) => ({ name: k, count: v }));
    const overdue = entities.filter(e => e.nextReviewDate && e.nextReviewDate < today).length;
    const expDocCnt = entities.reduce((s, e) => s + e.documents.filter(d => d.status === 'expired' || (d.expiry && d.expiry < today)).length, 0);
    const trendData = ['2025-01', '2025-03', '2025-06', '2025-09', '2025-12', '2026-03'].map(m => { let avg = 0, cnt = 0; entities.forEach(e => { const h = e.riskHistory.filter(r => r.date <= m + '-31'); if (h.length) { avg += h[h.length - 1].score; cnt++; } }); return { month: m, avgScore: cnt ? Math.round(avg / cnt) : 0 }; });
    const ddDist = { SDD: 0, CDD: 0, EDD: 0 }; entities.forEach(e => { const level = getDDLevel(e).toUpperCase(); ddDist[level]++; });
    const KPI = ({ label, value, color, sub, icon, gradient = 'from-blue-500 to-indigo-600' }) => (
      <div className={`group relative ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} rounded-2xl border p-4 hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)] transition-all duration-300 overflow-hidden`}>
        <div className={`absolute -top-8 -right-8 w-24 h-24 rounded-full bg-gradient-to-br ${gradient} opacity-5 group-hover:opacity-10 transition-opacity blur-2xl`} />
        <div className="relative">
          <div className="flex items-start justify-between mb-3">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md group-hover:scale-110 transition-transform text-lg`}>
              {icon}
            </div>
          </div>
          <div className={`text-2xl font-bold tracking-tight ${color || (darkMode ? 'text-slate-100' : 'text-slate-900')} mb-0.5`}>
            {value}
          </div>
          <div className={`text-[11px] font-semibold ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            {label}
          </div>
          {sub && (
            <div className={`text-[10px] mt-1.5 ${darkMode ? 'text-slate-600' : 'text-slate-400'}`}>
              {sub}
            </div>
          )}
        </div>
      </div>
    );
    return (<div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <div>
          <h2 className={`text-2xl font-bold tracking-tight ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
            {t.dashboard}
          </h2>
          <p className={`text-xs ${darkMode ? 'text-slate-500' : 'text-slate-500'} mt-1`}>
            {lang === 'zh' ? `更新於 ${today} · ${entities.length} 個實體` : `Updated ${today} · ${entities.length} entities`}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className={`${DS.btnSuccess} text-xs px-3.5 py-2 rounded-lg`}>
            {t.exportCSV}
          </button>
          <button onClick={() => openModal('confirmClearAll')} className={`${DS.btnGhost} text-xs px-3 py-2 rounded-lg`}>
            🗑️ {t.clearAll}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <KPI 
          icon="🏢"
          label={t.totalEntities} 
          value={entities.length} 
          sub={`${entities.filter(e => e.type === 'company').length} ${t.companies}, ${entities.filter(e => e.type === 'person').length} ${t.persons}`}
          gradient="from-blue-500 to-indigo-600"
        />
        <KPI 
          icon="⚠️"
          label={t.highRisk} 
          value={riskDist.High} 
          color="text-red-500" 
          sub={t.entitiesRatedHigh}
          gradient="from-red-500 to-rose-600"
        />
        <KPI 
          icon="⏰"
          label={t.overdueReviews} 
          value={overdue} 
          color={overdue > 0 ? 'text-orange-500' : 'text-emerald-500'}
          gradient="from-amber-500 to-orange-600"
        />
        <KPI 
          icon="📄"
          label={t.expiredDocs} 
          value={expDocCnt} 
          color={expDocCnt > 0 ? 'text-amber-500' : 'text-emerald-500'}
          gradient="from-purple-500 to-pink-600"
        />
        <KPI 
          icon="🚩"
          label={t.strFlagged} 
          value={entities.filter(e => e.str?.flagged).length}
          gradient="from-rose-500 to-red-600"
        />
        <KPI 
          icon="🛡️"
          label={t.dueDiligenceLevel} 
          value={`S:${ddDist.SDD} C:${ddDist.CDD} E:${ddDist.EDD}`} 
          sub="SDD / CDD / EDD"
          gradient="from-emerald-500 to-teal-600"
        />
      </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {/* Risk Distribution */}
        <div className={`${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} rounded-2xl border p-4 shadow-[0_2px_8px_rgba(15,23,42,0.04)]`}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className={`text-sm font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                {t.riskDistribution}
              </h3>
              <p className={`text-[11px] ${darkMode ? 'text-slate-500' : 'text-slate-400'} mt-0.5`}>
                {lang === 'zh' ? '所有實體分佈' : 'Across all entities'}
              </p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <defs>
                {pieData.map((entry, i) => (
                  <linearGradient key={i} id={`pieGrad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={RISK_COLORS[entry.key] || PIE_COLORS[i]} stopOpacity={1} />
                    <stop offset="100%" stopColor={RISK_COLORS[entry.key] || PIE_COLORS[i]} stopOpacity={0.7} />
                  </linearGradient>
                ))}
              </defs>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value" stroke="none">
                {pieData.map((e, i) => <Cell key={i} fill={`url(#pieGrad-${i})`} />)}
              </Pie>
              <RTooltip contentStyle={{ background: darkMode ? '#1e293b' : '#fff', border: 'none', borderRadius: 10, boxShadow: '0 8px 24px rgba(15,23,42,0.12)', fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {pieData.map(d => (
              <div key={d.name} className="text-center">
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: RISK_COLORS[d.key] }} />
                  <span className={`text-[10px] ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>{d.name}</span>
                </div>
                <div className={`text-base font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>{d.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Entity Types */}
        <div className={`${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} rounded-2xl border p-4 shadow-[0_2px_8px_rgba(15,23,42,0.04)]`}>
          <div className="mb-3">
            <h3 className={`text-sm font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
              {t.entityTypes}
            </h3>
            <p className={`text-[11px] ${darkMode ? 'text-slate-500' : 'text-slate-400'} mt-0.5`}>
              {lang === 'zh' ? '按子類型分佈' : 'By sub-type'}
            </p>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={barData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <defs>
                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={1} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.4} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#334155' : '#e2e8f0'} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: darkMode ? '#94a3b8' : '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: darkMode ? '#94a3b8' : '#64748b' }} axisLine={false} tickLine={false} />
              <RTooltip contentStyle={{ background: darkMode ? '#1e293b' : '#fff', border: 'none', borderRadius: 10, boxShadow: '0 8px 24px rgba(15,23,42,0.12)', fontSize: 12 }} cursor={{ fill: 'rgba(99,102,241,0.05)' }} />
              <Bar dataKey="count" fill="url(#barGrad)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Trend Chart */}
      <div className={`${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} rounded-2xl border p-4 shadow-[0_2px_8px_rgba(15,23,42,0.04)] mb-4`}>
        <div className="mb-3">
          <h3 className={`text-sm font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
            {t.avgRiskScoreTrend}
          </h3>
          <p className={`text-[11px] ${darkMode ? 'text-slate-500' : 'text-slate-400'} mt-0.5`}>
            {lang === 'zh' ? '過去 12 個月平均 CRR' : 'Past 12 months avg CRR'}
          </p>
        </div>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={trendData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
            <defs>
              <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#334155' : '#e2e8f0'} vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 9, fill: darkMode ? '#94a3b8' : '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: darkMode ? '#94a3b8' : '#64748b' }} axisLine={false} tickLine={false} />
            <RTooltip contentStyle={{ background: darkMode ? '#1e293b' : '#fff', border: 'none', borderRadius: 10, boxShadow: '0 8px 24px rgba(15,23,42,0.12)', fontSize: 12 }} />
            <Line type="monotone" dataKey="avgScore" stroke="#ef4444" strokeWidth={2.5} dot={{ fill: '#ef4444', r: 4, strokeWidth: 2, stroke: darkMode ? '#0f172a' : '#fff' }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <GeoRiskMap entities={entities} getEffectiveRating={getEffectiveRating} t={t} lang={lang} />
      <div className={`${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} rounded-2xl border p-4 shadow-[0_2px_8px_rgba(15,23,42,0.04)]`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className={`text-sm font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
              {t.autoTodos}
            </h3>
            <p className={`text-[11px] ${darkMode ? 'text-slate-500' : 'text-slate-400'} mt-0.5`}>
              {lang === 'zh' ? `${autoTodos.length} 個待處理項目` : `${autoTodos.length} pending items`}
            </p>
          </div>
          {autoTodos.length > 0 && (
            <span className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-md shadow shadow-blue-500/30">
              {autoTodos.length}
            </span>
          )}
        </div>
        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
          {autoTodos.map(td => (
            <div 
              key={td.id} 
              className={`group flex items-center gap-2.5 p-2.5 rounded-lg cursor-pointer transition-all border ${
                darkMode 
                  ? 'bg-slate-800/50 border-slate-800 hover:bg-slate-800 hover:border-slate-700' 
                  : 'bg-slate-50 border-slate-100 hover:bg-white hover:border-slate-200 hover:shadow-sm'
              }`}
              onClick={() => { setSelectedId(td.entityId); setDetailTab('overview'); setView('workspace'); }}
            >
              <PriorityDot p={td.priority} />
              <span className={`flex-1 text-xs ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>{td.text}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${
                darkMode ? 'bg-slate-700 text-slate-400' : 'bg-slate-200 text-slate-600'
              }`}>
                {td.type}
              </span>
              <ChevronRight className={`w-3.5 h-3.5 ${darkMode ? 'text-slate-600' : 'text-slate-300'} group-hover:translate-x-0.5 transition-transform`} />
            </div>
          ))}
          {autoTodos.length === 0 && (
            <div className="text-center py-8">
              <div className="text-3xl mb-2">✅</div>
              <div className={`text-xs ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>{t.noPendingTodos}</div>
            </div>
          )}
        </div>
      </div>
    </div>);
  };

  // ====== WORKSPACE ======
  const renderWorkspace = () => {
    if (entities.length === 0) return <EmptyState />;
    const { positions, W, H } = dagLayout;
    const toggleBatch = (id) => { const s = new Set(batchSelected); s.has(id) ? s.delete(id) : s.add(id); setBatchSelected(s); };
    const allChecked = filteredEntities.length > 0 && filteredEntities.every(e => batchSelected.has(e.id));
    const someChecked = filteredEntities.some(e => batchSelected.has(e.id));
    const toggleAll = () => { if (allChecked) { const s = new Set(batchSelected); filteredEntities.forEach(e => s.delete(e.id)); setBatchSelected(s); } else { const s = new Set(batchSelected); filteredEntities.forEach(e => s.add(e.id)); setBatchSelected(s); } };
    const ctxItems = [
      { label: lang === 'zh' ? '📋 詳情' : '📋 Details', action: (id) => { setSelectedId(id); setDetailTab('overview'); } },
      { label: t.editEntity, action: (id) => { const ent = entities.find(e => e.id === id); if (ent) openModal('editEntity', { ...ent, totalShares: ent.totalShares != null ? String(ent.totalShares) : '', industry: ent.industry || '' }); } },
      { label: lang === 'zh' ? '📋 CDD' : '📋 CDD', action: (id) => { setSelectedId(id); setDetailTab('cdd'); } },
      { label: lang === 'zh' ? '🗑️ 刪除' : '🗑️ Del', action: (id) => openModal('confirmDeleteSingle', { entityId: id }) },
    ];
    return (
      <div className="flex flex-col gap-2 h-full">
        <div className="md:hidden flex rounded-xl overflow-hidden border shrink-0">
          <button onClick={() => setWorkspaceTab('list')} className={`flex-1 py-2 text-xs font-bold transition-colors ${workspaceTab === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500'}`}>📋 {t.entityList}</button>
          <button onClick={() => setWorkspaceTab('diagram')} className={`flex-1 py-2 text-xs font-bold transition-colors ${workspaceTab === 'diagram' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500'}`}>🔗 {t.structureDiagram}</button>
        </div>
        <div className="flex gap-3 flex-1 overflow-hidden">
          <div className={`flex-col bg-white rounded-xl border overflow-hidden ${workspaceTab === 'diagram' ? 'hidden md:flex' : 'flex'}`} style={{ width: '290px', minWidth: '250px' }}>
            <div className="p-3 border-b flex items-center justify-between shrink-0">
              <div>
                <div className="text-sm font-bold text-slate-900">{t.entityList}</div>
                <div className="text-[10px] text-slate-400">{entities.length} {lang === 'zh' ? '個實體' : 'entities'}</div>
              </div>
              <div className="flex gap-1.5">
                <button 
                  onClick={() => openModal('addEntity', { name: '', type: 'company', subType: '', jurisdiction: 'USA', totalShares: '', companyCategory: 'private', industry: '' })} 
                  className={`${DS.btnPrimary} px-2.5 py-1.5 rounded-lg text-[11px]`}
                >
                  {t.addEntity}
                </button>
                <button onClick={exportCSV} className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-emerald-600 flex items-center justify-center transition" title={t.exportCSV}>📥</button>
              </div>
            </div>
            <div className="px-2 py-1.5 border-b shrink-0"><input value={entityFilter} onChange={e => setEntityFilter(e.target.value)} placeholder={t.filterPlaceholder} className="w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-400 focus:outline-none" /></div>
            {batchSelected.size > 0 && (<div className="px-2 py-2 bg-blue-50 border-b shrink-0"><div className="flex items-center justify-between mb-1.5"><span className="text-xs text-blue-700 font-bold">{batchSelected.size} {t.selected}</span><button onClick={() => setBatchSelected(new Set())} className="text-xs text-gray-400 hover:text-gray-600">✕ {t.clear}</button></div><div className="flex gap-1 flex-wrap">{batchSelected.size === 1 && <button onClick={() => { const id = [...batchSelected][0]; const ent = entities.find(e => e.id === id); if (ent) openModal('editEntity', { ...ent, totalShares: ent.totalShares != null ? String(ent.totalShares) : '', industry: ent.industry ||'' }); }} className="text-xs bg-white border border-blue-300 text-blue-700 px-2 py-1 rounded hover:bg-blue-100 font-medium">{t.editEntity}</button>}{batchSelected.size > 1 && <button onClick={() => openModal('batchEdit', { jurisdiction: '', subType: '' })} className="text-xs bg-white border border-blue-300 text-blue-700 px-2 py-1 rounded hover:bg-blue-100 font-medium">{t.batchEdit}</button>}<button onClick={() => openModal('confirmDeleteBatch')} className="text-xs bg-white border border-red-300 text-red-600 px-2 py-1 rounded hover:bg-red-50 font-medium">{t.deleteSelected}</button><button onClick={() => openModal('batchReview', { date: '' })} className="text-xs bg-white border border-gray-300 text-gray-600 px-2 py-1 rounded hover:bg-gray-100">{t.batchReview}</button></div></div>)}
            <div className="px-2 py-1 border-b bg-gray-50 flex items-center gap-2 shrink-0"><input type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }} onChange={toggleAll} className="shrink-0" /><span className="text-xs text-gray-500 font-medium">{t.selectAll}</span></div>
            <div className="flex-1 overflow-y-auto">
              {filteredEntities.map(ent => {
                const r = getEffectiveRating(ent);
                const isActive = dagSelected === ent.id;
                const isChecked = batchSelected.has(ent.id);
                const cddCount = (ent.cddRecords || []).length;
                const autoHR = isAutoHighRisk(ent);
                return (
                  <div 
                    key={ent.id} 
                    className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-all border-l-[3px] ${
                      isActive 
                        ? 'bg-gradient-to-r from-blue-50 to-transparent border-l-blue-500' 
                        : isChecked 
                          ? 'bg-blue-50/40 border-l-transparent'
                          : 'border-l-transparent hover:bg-slate-50'
                    }`}
                    onClick={() => setDagSelected(ent.id === dagSelected ? null : ent.id)}
                    onDoubleClick={() => { setSelectedId(ent.id); setDetailTab('overview'); }}
                  >
                    <input 
                      type="checkbox" 
                      checked={isChecked} 
                      onChange={() => toggleBatch(ent.id)} 
                      onClick={e => e.stopPropagation()} 
                      className="shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500 focus:ring-offset-0" 
                    />
                    
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 shadow-sm ${
                      ent.type === 'person'
                        ? 'bg-gradient-to-br from-violet-100 to-purple-100 text-purple-700'
                        : 'bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-700'
                    }`}>
                      {ent.type === 'person' ? '👤' : '🏢'}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-bold text-slate-800 truncate">{ent.name}</span>
                        {ent.isPEP && <BadgeC color="purple" size="xs">PEP</BadgeC>}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                        {ent.subType}
                        {ent.companyCategory && ent.type === 'company' ? ` · ${getCategoryLabel(ent.companyCategory)}` : ''}
                        {' · '}{ent.jurisdiction}
                        {cddCount > 0 ? ` · ${cddCount}${t.cddRecordCount}` : ''}
                      </div>
                    </div>
                    
                    <div className="shrink-0 flex items-center gap-1.5">
                      {autoHR && <span className="text-xs" title={t.annualReview}>🔒</span>}
                      <DDLevelBadge entity={ent} />
                      {ent.str?.flagged && <span className="w-1.5 h-1.5 rounded-full bg-red-500 ring-2 ring-red-100" title="STR" />}
                      <span 
                        className={`w-2 h-2 rounded-full ring-2 ${
                          r.rating === 'High' 
                            ? 'bg-red-500 ring-red-100' 
                            : r.rating === 'Medium' 
                              ? 'bg-amber-500 ring-amber-100' 
                              : 'bg-emerald-500 ring-emerald-100'
                        }`} 
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className={`flex-1 flex-col bg-white rounded-xl border overflow-hidden ${workspaceTab === 'list' ? 'hidden md:flex' : 'flex'}`}>
            <div className="p-2 border-b flex items-center gap-2 shrink-0 flex-wrap">
              <span className="text-sm font-bold text-gray-700">{t.structureDiagram}</span><div className="flex-1" />
{/* ★ NEW: Zoom controls */}
<button onClick={() => setSvgTransform(p => ({ ...p, scale: Math.min(3, +(p.scale + 0.2).toFixed(1)) }))} className="bg-gray-200 text-gray-600 px-2 py-1 rounded text-xs" title={t.zoomIn}>🔍+</button>
<button onClick={() => setSvgTransform(p => ({ ...p, scale: Math.max(0.3, +(p.scale - 0.2).toFixed(1)) }))} className="bg-gray-200 text-gray-600 px-2 py-1 rounded text-xs" title={t.zoomOut}>🔍−</button>
<button 
  onClick={() => { 
    setSvgTransform({ x: 0, y: 0, scale: 1 }); 
    setIsPanning(false); 
  }} 
  className="bg-gray-200 text-gray-600 px-2 py-1 rounded text-xs" 
  title={t.resetView}
>↺</button>
<span className="text-xs text-gray-400">{Math.round(svgTransform.scale * 100)}%</span>
{/* ★ END NEW */}
              <button onClick={() => openModal('addRel', { sourceId: '', targetId: '', type: 'ownership', percentage: '', shares: '', description: '', inputMode: 'shares' })} className="bg-blue-600 text-white px-2 py-1 rounded text-xs">{t.addRelationship}</button>
              {dagSelected && <button onClick={() => setDagSelected(null)} className="bg-gray-200 text-gray-600 px-2 py-1 rounded text-xs">{t.clearSelection}</button>}
            </div>
           <div className="flex-1 overflow-auto relative" onClick={() => setContextMenu(null)}>
  <svg
    ref={svgRef}
    width={W * svgTransform.scale}                            /* ⬅ 跟 scale 變闊 → overflow-auto 識出 scrollbar */
    height={Math.max(H, 350) * svgTransform.scale}            /* ⬅ 跟 scale 變高 */
    style={{ cursor: isPanning ? 'grabbing' : 'grab', userSelect: 'none' }}
    onWheel={e => {
      e.preventDefault();
      setSvgTransform(p => ({
        ...p,
        scale: Math.max(0.3, Math.min(3, +(p.scale + (e.deltaY > 0 ? -0.1 : 0.1)).toFixed(1)))
      }));
    }}
    onMouseDown={e => {
      // 只喺空白區域(SVG 本身,唔係 node)觸發 pan
      if (e.target === e.currentTarget) {
        setIsPanning(true);
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          tx: svgTransform.x,
          ty: svgTransform.y,
        };
      }
    }}
    onMouseMove={e => {
      if (!isPanning) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setSvgTransform(p => ({
        ...p,
        x: panStartRef.current.tx + dx,
        y: panStartRef.current.ty + dy,
      }));
    }}
    onMouseUp={() => setIsPanning(false)}
    onMouseLeave={() => setIsPanning(false)}
  >
              <defs>
                  <marker id="arr" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto"><path d="M0,0 L10,3 L0,6 Z" fill="#94a3b8" /></marker>
                  <marker id="arrH" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto"><path d="M0,0 L10,3 L0,6 Z" fill="#3b82f6" /></marker>
                  <marker id="arrR" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto"><path d="M0,0 L10,3 L0,6 Z" fill="#a855f7" /></marker>
                </defs>
                <g transform={`translate(${svgTransform.x}, ${svgTransform.y}) scale(${svgTransform.scale})`}>
                {relationships.map(r => {
                  const sp = positions[r.sourceId], tp = positions[r.targetId]; if (!sp || !tp) return null;
                  const isRCA = r.type === 'rca' || r.type === 'association';
                  const hi = connectedSet && connectedSet.has(r.sourceId) && connectedSet.has(r.targetId); const dim = connectedSet && !hi;
                  const sx = sp.x + 65, sy = sp.y + 40, tx = tp.x + 65, ty = tp.y; const lbl = fmtRelLabel(r);
                  return (<g key={r.id} opacity={dim ? 0.15 : 1} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); openModal('editRel', { id: r.id, sourceId: r.sourceId, targetId: r.targetId, type: r.type, shares: r.shares ? String(r.shares) : '', percentage: r.percentage ? String(r.percentage) : '', description: r.description || '', inputMode: r.shares ? 'shares' : 'percentage' }); }}><line x1={sx} y1={sy} x2={tx} y2={ty} stroke={isRCA ? '#a855f7' : hi ? '#3b82f6' : '#94a3b8'} strokeWidth={hi ? 2.5 : 1.5} markerEnd={isRCA ? 'url(#arrR)' : hi ? 'url(#arrH)' : 'url(#arr)'} strokeDasharray={isRCA ? '6 3' : r.type === 'control' ? '4 2' : ''} />{lbl && <text x={(sx + tx) / 2 + 5} y={(sy + ty) / 2 - 5} fontSize="9" fill={hi ? '#3b82f6' : '#64748b'} fontWeight="bold">{lbl}</text>}</g>);
                })}
                {entities.map(ent => {
                  const pos = positions[ent.id]; if (!pos) return null; const r = getEffectiveRating(ent); const sel = dagSelected === ent.id;
                  const hi = connectedSet && connectedSet.has(ent.id); const dim = connectedSet && !hi;
                  const fill = r.rating === 'High' ? '#fef2f2' : r.rating === 'Medium' ? '#fffbeb' : '#f0fdf4';
                  const border = sel ? '#3b82f6' : r.rating === 'High' ? '#fca5a5' : r.rating === 'Medium' ? '#fcd34d' : '#86efac';
                  return (<g key={ent.id} opacity={dim ? 0.15 : 1} style={{ cursor: 'pointer' }}
                    onClick={e => { e.stopPropagation(); setDagSelected(ent.id === dagSelected ? null : ent.id); }}
                    onDoubleClick={() => { setSelectedId(ent.id); setDetailTab('overview'); }}
                    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, entityId: ent.id }); }}>
                    {ent.type === 'person' ? <circle cx={pos.x + 65} cy={pos.y + 20} r={22} fill={fill} stroke={border} strokeWidth={sel ? 3 : 2} /> : <rect x={pos.x} y={pos.y} width={130} height={40} rx={6} fill={fill} stroke={border} strokeWidth={sel ? 3 : 2} />}
                    <text x={pos.x + 65} y={ent.type === 'person' ? pos.y + 24 : pos.y + 17} textAnchor="middle" fontSize="9" fontWeight="600" fill="#1e293b">{ent.name.length > 15 ? ent.name.slice(0, 14) + '…' : ent.name}</text>
                    <text x={pos.x + 65} y={ent.type === 'person' ? pos.y + 36 : pos.y + 30} textAnchor="middle" fontSize="7" fill="#64748b">{ent.jurisdiction}{isSddEligible(ent) ? ' 🔵' : ''}</text>
                    {ent.isPEP && <circle cx={pos.x + (ent.type === 'person' ? 88 : 126)} cy={pos.y + 4} r={5} fill="#a855f7" stroke="white" strokeWidth="1.5" />}
                    {isAutoHighRisk(ent) && <circle cx={pos.x + (ent.type === 'person' ? 42 : 4)} cy={pos.y + 4} r={5} fill="#ef4444" stroke="white" strokeWidth="1.5" />}
                  </g>);
                })}
                </g>
              </svg>
              {contextMenu && (<div className="absolute bg-white rounded-lg shadow-lg border py-1 z-40" style={{ left: contextMenu.x, top: contextMenu.y, minWidth: '140px' }}>{ctxItems.map(item => (<button key={item.label} onClick={() => { item.action(contextMenu.entityId); setContextMenu(null); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100">{item.label}</button>))}</div>)}
            </div>
            <div className="flex gap-3 px-3 py-1.5 border-t text-xs text-gray-400 shrink-0 flex-wrap">
              <span>🟩 {t.lowRisk}</span><span>🟨 {t.mediumRisk}</span><span>🟥 {t.highRisk}</span>
              <span>— {t.ownership}</span><span>╌╌ {t.control}</span><span className="text-purple-500">- - {t.rca}</span>
              <span>🔒 {t.annualReview}</span><span>🔵 SDD</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const CDDCompareTable = ({ ent, snapshot }) => {
    const crr = calcCRR(ent);
    const curDocRec = ent.documents.filter(d => d.status === 'received').length;
    const savedDocRec = snapshot.documents.filter(d => d.status === 'received').length;
    const rows = [
      { label: t.cddRiskScore, cur: crr.score, saved: snapshot.riskScore },
      { label: t.cddRiskRating, cur: tR(crr.rating), saved: tR(snapshot.riskRating) },
      { label: t.cddDocReceived, cur: curDocRec, saved: savedDocRec },
      { label: t.cddDocTotal, cur: ent.documents.length, saved: snapshot.documents.length },
      { label: t.cddScreenings, cur: ent.screeningLogs.length, saved: snapshot.screeningLogs.length },
      { label: t.cddNotes, cur: ent.notes.length, saved: snapshot.notes.length },
      { label: t.cddPEP, cur: ent.isPEP ? t.cddYes : t.cddNo, saved: snapshot.isPEP ? t.cddYes : t.cddNo },
      { label: t.cddSanctioned, cur: ent.isSanctioned ? t.cddYes : t.cddNo, saved: snapshot.isSanctioned ? t.cddYes : t.cddNo },
      { label: t.cddNegNews, cur: ent.negativeNews ? t.cddYes : t.cddNo, saved: snapshot.negativeNews ? t.cddYes : t.cddNo },
      { label: t.cddSTR, cur: ent.str?.flagged ? t.cddYes : t.cddNo, saved: snapshot.str?.flagged ? t.cddYes : t.cddNo },
    ];
    return (<table className="w-full text-xs border-collapse"><thead><tr className="bg-gray-100"><th className="p-1.5 text-left border">{t.cddField}</th><th className="p-1.5 text-center border text-indigo-600">{t.cddSavedState}</th><th className="p-1.5 text-center border text-blue-600">{t.cddCurrentState}</th><th className="p-1.5 text-center border w-10">{t.cddChanged}</th></tr></thead><tbody>{rows.map(r => { const changed = String(r.cur) !== String(r.saved); return (<tr key={r.label} className={changed ? 'bg-amber-50' : ''}><td className="p-1.5 border font-medium">{r.label}</td><td className="p-1.5 border text-center">{String(r.saved)}</td><td className="p-1.5 border text-center">{String(r.cur)}</td><td className="p-1.5 border text-center">{changed ? '⚠️' : '✓'}</td></tr>); })}</tbody></table>);
  };

  // ====== ENTITY DETAIL ======
  const renderEntityDetail = () => {
    if (!selectedEntity) return null;
    const ent = selectedEntity, crr = calcCRR(ent), eff = getEffectiveRating(ent);
    const ubos = findUBOs(ent.id, settings.uboThreshold);
    const rels = relationships.filter(r => r.sourceId === ent.id || r.targetId === ent.id);
    /* ✅ 新增 sanctionScreening tab */
    const tabs = [
      { id: 'overview', label: t.overview },
      { id: 'cdd', label: `📋 ${t.cddTab}` },
      { id: 'ubo', label: t.uboTab },
      { id: 'adverseMedia', label: '🔎 ' + (t.adverseMediaTab || 'Media') },
      { id: 'sanctionScreening', label: '🛡️ ' + (t.sanctionScreeningTab || 'Sanction') },
      { id: 'documents', label: t.documents },
      { id: 'screening', label: t.screening },
      { id: 'str', label: t.str },
      { id: 'notes', label: t.notes },
      { id: 'risk', label: t.riskTab }
    ];
    const docComp = ent.documents.length > 0 ? Math.round(ent.documents.filter(d => d.status === 'received').length / ent.documents.length * 100) : 0;
    const ownerRels = relationships.filter(r => r.targetId === ent.id && r.type === 'ownership');
    const totalAllocShares = ownerRels.reduce((s, r) => s + (r.shares || 0), 0);
    const totalAllocPct = ownerRels.reduce((s, r) => s + (getRelPercentage(r) || 0), 0);
    const cddRecords = ent.cddRecords || [];

    return (
      <ModalShell title={`${ent.type === 'person' ? '👤' : '🏢'} ${ent.name}`} onClose={() => { setSelectedId(null); setExpandedCDD(null); }} wide>
        <div className="flex gap-1 mb-4 border-b pb-2 overflow-x-auto">{tabs.map(tb => <button key={tb.id} onClick={() => { setDetailTab(tb.id); setExpandedCDD(null); }} className={`px-3 py-1 rounded-lg text-sm font-medium whitespace-nowrap ${detailTab === tb.id ? (tb.id === 'cdd' ? 'bg-indigo-600 text-white' : tb.id === 'sanctionScreening' ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white') : (tb.id === 'cdd' ? 'text-indigo-600 hover:bg-indigo-50 border border-indigo-200' : tb.id === 'sanctionScreening' ? 'text-orange-600 hover:bg-orange-50 border border-orange-200' : 'text-gray-500 hover:bg-gray-100')}`}>{tb.label}{tb.id === 'cdd' && cddRecords.length > 0 && detailTab !== 'cdd' && <span className="ml-1 bg-indigo-100 text-indigo-700 px-1 rounded-full text-xs">{cddRecords.length}</span>}</button>)}</div>

        {detailTab === 'overview' && (<div className="space-y-3 mb-2"><SDDBanner entity={ent} /><AutoHighRiskBanner entity={ent} /><EDDBanner entity={ent} /><IndustryEDDBanner entity={ent} /></div>)}

        {detailTab === 'cdd' && (<div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2"><h3 className="text-sm font-bold text-gray-700">📋 {t.cddHistory}</h3><button onClick={() => openModal('saveCDD', { reviewer: '', type: 'periodic', status: 'completed', summary: '' })} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-indigo-700 shadow-sm">{t.saveCDD}</button></div>
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-xs text-indigo-700">{t.cddTip}</div>
          {cddRecords.length > 0 ? (<div className="relative pl-6 border-l-2 border-indigo-200 space-y-4">{[...cddRecords].reverse().map((rec, idx) => { const isExpanded = expandedCDD === rec.id; return (<div key={rec.id} className="relative"><div className="absolute -left-8 top-2 w-4 h-4 rounded-full bg-indigo-500 border-2 border-white shadow flex items-center justify-center text-white" style={{ fontSize: '8px' }}>{cddRecords.length - idx}</div><div className={`rounded-xl border ${isExpanded ? 'border-indigo-300 shadow-md' : 'border-gray-200'} overflow-hidden`}><div className={`p-3 ${isExpanded ? 'bg-indigo-50' : 'bg-white hover:bg-gray-50'}`}><div className="flex items-center gap-2 mb-1.5 flex-wrap"><span className="text-base">{cddTypeIcon[rec.type] || '📋'}</span><span className="font-bold text-sm text-gray-800">{cddTypes.find(c => c.v === rec.type)?.l || rec.type}</span><BadgeC color={cddStatusColor[rec.status] || 'gray'}>{cddStatuses.find(c => c.v === rec.status)?.l || rec.status}</BadgeC><span className="text-xs text-gray-400 ml-auto">{rec.date}</span></div><div className="flex items-center gap-2 text-xs text-gray-500 mb-1.5"><span>👤 {rec.reviewer}</span><span>·</span><span>{t.cddRiskScore}: <span className="font-bold" style={{ color: RISK_COLORS[rec.snapshot.riskRating] }}>{rec.snapshot.riskScore}</span></span><span>·</span><RiskBadge rating={rec.snapshot.riskRating} label={tR(rec.snapshot.riskRating)} /></div>{rec.summary && <div className="text-xs text-gray-600 bg-white rounded p-2 border border-gray-100">{rec.summary}</div>}<div className="flex gap-2 mt-2"><button onClick={() => setExpandedCDD(isExpanded ? null : rec.id)} className={`text-xs px-2.5 py-1 rounded font-medium ${isExpanded ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600 hover:bg-indigo-100'}`}>{isExpanded ? t.cddHideDetails : t.cddViewDetails}</button><button onClick={() => openModal('confirmRestoreCDD', { recordId: rec.id })} className="text-xs px-2.5 py-1 rounded font-medium bg-amber-100 text-amber-700 hover:bg-amber-200">{t.cddRestore}</button></div></div>{isExpanded && (<div className="border-t border-indigo-200 p-3 bg-white space-y-3"><div className="text-xs font-semibold text-indigo-700 mb-1">{t.cddCompareTitle}</div><CDDCompareTable ent={ent} snapshot={rec.snapshot} /><button onClick={() => openModal('confirmRestoreCDD', { recordId: rec.id })} className="w-full bg-amber-500 text-white py-2 rounded-lg text-xs font-bold hover:bg-amber-600 mt-2">{t.cddRestore}</button></div>)}</div></div>); })}</div>) : (<div className="text-center py-10"><div className="text-5xl mb-3">📋</div><div className="text-sm text-gray-500 mb-4">{t.noCDDRecords}</div><button onClick={() => openModal('saveCDD', { reviewer: '', type: 'initial', status: 'completed', summary: '' })} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium">{t.saveCDD}</button></div>)}
        </div>)}

        {detailTab === 'overview' && (<div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-xs text-gray-400">{t.type}</span><div className="font-medium text-sm">{ent.subType || ent.type}{ent.type === 'company' && ent.companyCategory ? ` · ${getCategoryLabel(ent.companyCategory)}` : ''}</div></div>
            <div><span className="text-xs text-gray-400">{t.jurisdiction}</span><div className="font-medium text-sm">{ent.jurisdiction}</div></div>
            <div><span className="text-xs text-gray-400">{t.industryLabel}</span><div className="font-medium text-sm">{ent.industry || '—'}{HIGH_RISK_INDUSTRIES.includes(ent.industry) && <span className="ml-1 text-red-500 text-xs">🔴</span>}</div></div>
            <div><span className="text-xs text-gray-400">{t.lastReview}</span><div className="font-medium text-sm">{ent.lastReviewDate}</div></div>
            <div><span className="text-xs text-gray-400">{t.nextReview}</span><div className={`font-medium text-sm ${ent.nextReviewDate && ent.nextReviewDate < today ? 'text-red-600' : ''}`}>{ent.nextReviewDate || '—'}{isAutoHighRisk(ent) && <span className="ml-1 text-red-500 text-xs">🔒 {t.annualReview}</span>}</div></div>
            <div><span className="text-xs text-gray-400">{t.dueDiligenceLevel}</span><div className="mt-0.5"><DDLevelBadge entity={ent} /></div></div>
            <div><span className="text-xs text-gray-400">{t.autoReviewReminder}</span><div className="text-xs text-gray-500 mt-0.5">{eff.rating === 'High' ? t.reviewCycleHigh : eff.rating === 'Medium' ? t.reviewCycleMedium : t.reviewCycleLow}</div></div>
          </div>
          {ent.type === 'company' && (<div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-lg p-3"><FormField label={t.companyCategory}><select value={ent.companyCategory || 'private'} onChange={e => updateEntity(ent.id, { companyCategory: e.target.value })} className="w-full border rounded px-2 py-1 text-sm">{companyCategoryOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select></FormField></div>
            <div className="bg-gray-50 rounded-lg p-3"><FormField label={t.totalSharesLabel}><input type="number" min="0" key={`ts-${ent.id}`} defaultValue={ent.totalShares || ''} onBlur={e => updateEntity(ent.id, { totalShares: e.target.value ? Math.max(0, parseInt(e.target.value)) : null })} className="w-full border rounded px-2 py-1 text-sm" /></FormField></div>
          </div>)}
          <div className="flex gap-3">
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={ent.isPEP} onChange={e => { const checked = e.target.checked; updateEntity(ent.id, { isPEP: checked, ...(!checked ? { pepCategory: '' } : {}) }); }} />{t.pep}</label>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={ent.isSanctioned} onChange={e => updateEntity(ent.id, { isSanctioned: e.target.checked })} />{t.sanctioned}</label>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={ent.negativeNews} onChange={e => updateEntity(ent.id, { negativeNews: e.target.checked })} />{t.negativeNews}</label>
          </div>
          {ent.isPEP && (<div className="bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2"><div className="flex items-center gap-2"><span className="text-xs font-bold text-purple-700">🔒 {t.pepAutoHighRisk}</span></div><FormField label={t.pepCategory}><select value={ent.pepCategory || ''} onChange={e => updateEntity(ent.id, { pepCategory: e.target.value })} className="w-full border rounded px-3 py-2 text-sm border-purple-200 bg-white"><option value="">{t.selectPepCategory}</option>{pepCategories.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}</select></FormField></div>)}
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2"><span className="text-sm font-semibold text-gray-700">{t.crrScore}: {crr.score}/100</span><div className="flex items-center gap-2"><RiskBadge rating={eff.rating} label={tR(eff.rating)} />{eff.overridden && <BadgeC color="purple">{t.overridden}</BadgeC>}{crr.autoHighRisk && <BadgeC color="red">🔒 AUTO</BadgeC>}{crr.pepForced && <BadgeC color="purple">🔒 PEP</BadgeC>}</div></div>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2"><div className="h-2 rounded-full" style={{ width: `${crr.score}%`, backgroundColor: RISK_COLORS[crr.rating] }} /></div>
            {!crr.autoHighRisk && <div className="grid grid-cols-3 gap-2 text-xs">{Object.entries(crr.breakdown).map(([k, v]) => (<div key={k} className="flex justify-between"><span className="text-gray-500">{t[WK[k]] || k}</span><span className="font-medium">{v}</span></div>))}</div>}
          </div>
          {ent.type === 'company' && totalAllocPct > 100 && (<div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-700">🚨 {t.percentageExceeds100} ({Math.round(totalAllocPct * 100) / 100}%)</div>)}
          {ent.type === 'company' && ent.totalShares > 0 && ownerRels.length > 0 && (<div className="bg-blue-50 rounded-lg p-3"><div className="text-sm font-semibold text-blue-700 mb-2">📊 {t.shareholdingSummary}</div><table className="w-full text-xs"><thead><tr className="border-b border-blue-200"><th className="text-left py-1 text-gray-600">{t.shareholder}</th><th className="text-right py-1 text-gray-600">{t.sharesLabel}</th><th className="text-right py-1 text-gray-600">%</th></tr></thead><tbody>{ownerRels.map(r => { const owner = entities.find(e => e.id === r.sourceId); const pct = getRelPercentage(r); return (<tr key={r.id} className="border-b border-blue-100"><td className="py-1 font-medium">{owner?.name || '?'}</td><td className="py-1 text-right">{r.shares ? fmtShares(r.shares) : '—'}</td><td className="py-1 text-right">{pct != null ? `${pct}%` : '—'}</td></tr>); })}<tr className="font-bold border-t border-blue-300"><td className="py-1">{t.totalLabel}</td><td className="py-1 text-right">{fmtShares(totalAllocShares)} / {fmtShares(ent.totalShares)}</td><td className={`py-1 text-right ${totalAllocPct > 100 ? 'text-red-600' : ''}`}>{Math.round(totalAllocPct * 100) / 100}%</td></tr></tbody></table></div>)}
          {rels.length === 0 && <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-700">{t.noRelWarning}</div>}
          <div><div className="text-sm font-semibold text-gray-700 mb-2">{t.relationships} ({rels.length})</div>{rels.map(r => { const other = entities.find(e => e.id === (r.sourceId === ent.id ? r.targetId : r.sourceId)); return (<div key={r.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-gray-100 hover:bg-gray-50 rounded px-1"><span>{r.sourceId === ent.id ? '→' : '←'}</span><span className="font-medium">{other?.name}</span><BadgeC color="blue">{r.type}</BadgeC><span className="text-gray-500">{fmtRelLabel(r)}</span><div className="ml-auto flex gap-1"><button onClick={() => openModal('editRel', { id: r.id, sourceId: r.sourceId, targetId: r.targetId, type: r.type, shares: r.shares ? String(r.shares) : '', percentage: r.percentage ? String(r.percentage) : '', description: r.description || '', inputMode: r.shares ? 'shares' : 'percentage' })} className="text-blue-400 hover:text-blue-600" title={t.editRel}>✏️</button><button onClick={() => deleteRel(r.id)} className="text-red-400 hover:text-red-600">✕</button></div></div>); })}</div>
        </div>)}

        {detailTab === 'ubo' && (<div className="space-y-4">
          <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-gray-700">🔍 {t.uboAnalysis}</h3><div className="flex items-center gap-2"><span className="text-xs text-gray-500">{t.threshold}:</span><span className="text-sm font-bold text-blue-600">{settings.uboThreshold}%</span></div></div>
          {ent.type === 'company' ? (<>{ubos.length > 0 ? (<div className="bg-amber-50 rounded-lg p-3 border border-amber-200"><div className="text-xs font-semibold text-amber-700 mb-2">{t.detectedUBOs}: {ubos.length}</div>{ubos.map((u, i) => (<div key={i} className="bg-white rounded-lg p-3 border mb-2 last:mb-0"><div className="flex items-center gap-2 mb-1.5 flex-wrap"><span className="text-sm">👤</span><span className="font-bold text-sm">{u.entity.name}</span><BadgeC color="blue">{u.percentage}%</BadgeC>{u.entity.isPEP && <BadgeC color="purple">PEP</BadgeC>}<BadgeC color={u.direct ? 'green' : u.mixed ? 'indigo' : 'amber'}>{u.direct ? t.directOwnership : u.mixed ? t.mixedOwnership : t.indirectOwnership}</BadgeC></div>{u.paths.map((p, j) => (<div key={j} className="text-xs text-gray-500 ml-5">{p.direct ? '📍' : '🔗'} {p.chain.join(' → ')} → {ent.name} <span className="text-gray-400">({p.percentage}%)</span></div>))}</div>))}</div>) : (<div className="text-center py-10 text-gray-400"><div className="text-4xl mb-2">✅</div><div className="text-sm">{t.noUBOs}</div></div>)}</>) : (<div className="text-center py-8 text-gray-400 text-sm">{lang === 'zh' ? 'UBO 偵測僅適用於公司實體。' : 'UBO detection only for company entities.'}</div>)}
        </div>)}

        {/* ✅ Adverse Media Tab */}
          <div className={detailTab === 'adverseMedia' ? 'pb-2' : 'hidden'}>
         <AdverseMediaScreening key={`ams-${ent.id}`} entityName={ent.name} onFlagSTR={(info) => {
  updateEntity(ent.id, {
    str: {
      flagged: true,
      submittedDate: null,
      mlroApproved: false,
      mlroDate: null,
      _source: info.source,
      _detail: `${info.title} | Risk: ${info.riskCat} | Confidence: ${Math.round(info.confidence * 100)}%`,
    },
    notes: [...ent.notes, {
      id: gid(),
      text: `🚨 STR flagged via ${info.source}: "${info.title}" (${info.riskCat}, ${Math.round(info.confidence * 100)}% confidence)`,
      date: today,
      author: 'System',
    }],
  });
  showToast(lang === 'zh' ? '🚨 已標記 STR 並新增備註' : '🚨 STR flagged & note added');
}} />
        </div>

        <div className={detailTab === 'sanctionScreening' ? 'pb-2' : 'hidden'}>
          <SanctionScreening key={`ss-${ent.id}`} entityName={ent.name} onFlagSTR={(info) => {
            updateEntity(ent.id, {
              str: {
                flagged: true,
                submittedDate: null,
                mlroApproved: false,
                mlroDate: null,
              },
              notes: [...ent.notes, {
                id: gid(),
                text: `🚨 STR flagged via ${info.source}: "${info.title}" (${info.riskCat}, ${Math.round(info.confidence * 100)}% confidence)`,
                date: today,
                author: 'System',
              }],
            });
            showToast(lang === 'zh' ? '🚨 已標記 STR 並新增備註' : '🚨 STR flagged & note added');
          }} />
        </div>

        {detailTab === 'documents' && (<div>
          <div className="flex items-center justify-between mb-2"><div className="text-xs text-gray-500">{t.completion}: <span className={`font-bold ${docComp === 100 ? 'text-green-600' : 'text-amber-600'}`}>{docComp}%</span></div><button onClick={() => openModal('addDoc', { name: '', expiry: '' })} className="bg-blue-600 text-white px-2 py-1 rounded text-xs">{t.addDocument}</button></div>
          <div className="w-full bg-gray-200 rounded-full h-1.5 mb-3"><div className="h-1.5 rounded-full bg-green-500" style={{ width: `${docComp}%` }} /></div>
          {isSddEligible(ent) && <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-2 mb-3 text-xs text-cyan-700">🔵 SDD</div>}
          <div className="space-y-1.5">{ent.documents.map(d => (<div key={d.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg"><span>{d.status === 'received' ? '✅' : d.status === 'expired' ? '❌' : '⏳'}</span><div className="flex-1"><div className="text-xs font-medium text-gray-700">{d.name}</div>{d.expiry && <div className={`text-xs ${d.expiry < today ? 'text-red-500' : isExpiringIn30(d.expiry) ? 'text-amber-500 font-medium' : 'text-gray-400'}`}>{t.expiry}: {d.expiry} {isExpiringIn30(d.expiry) ? ` ⚠️` : ''}</div>}</div><select value={d.status} onChange={e => { updateEntity(ent.id, { documents: ent.documents.map(dd => dd.id === d.id ? { ...dd, status: e.target.value } : dd) }); }} className="text-xs border rounded px-1.5 py-0.5"><option value="pending">{t.pending}</option><option value="received">{t.received}</option><option value="expired">{t.expired}</option><option value="not_applicable">{t.notApplicable}</option></select><button onClick={() => updateEntity(ent.id, { documents: ent.documents.filter(dd => dd.id !== d.id) })} className="text-red-400 hover:text-red-600 text-xs">✕</button></div>))}{ent.documents.length === 0 && <div className="text-xs text-gray-400 text-center py-4">{t.noDocsYet}</div>}</div>
        </div>)}

        {detailTab === 'screening' && (<div>
          <div className="flex justify-between items-center mb-2"><span className="text-xs font-semibold text-gray-700">{t.screeningHistory}</span><button onClick={() => openModal('addScreen', { system: 'Internal Screening', type: 'Sanctions', result: 'Clear' })} className="bg-blue-600 text-white px-2 py-1 rounded text-xs">{t.addRecord}</button></div>
          <div className="space-y-1.5">{[...ent.screeningLogs].reverse().map(s => (<div key={s.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg"><span>{s.result.startsWith('Clear') ? '✅' : '🚨'}</span><div className="flex-1"><div className="text-xs font-medium">{s.type} — {s.system}</div><div className="text-xs text-gray-400">{s.date}</div></div><BadgeC color={s.result.startsWith('Clear') ? 'green' : 'red'}>{s.result.length > 20 ? s.result.slice(0, 20) + '…' : s.result}</BadgeC></div>))}{ent.screeningLogs.length === 0 && <div className="text-xs text-gray-400 text-center py-4">{t.noScreeningRecords}</div>}</div>
        </div>)}

        {detailTab === 'str' && (<div className="space-y-3">
          <div className="text-xs font-semibold text-gray-700">{t.suspiciousTransactionReport}</div>
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={ent.str?.flagged || false} onChange={e => updateEntity(ent.id, { str: e.target.checked ? { flagged: true, submittedDate: null, mlroApproved: false, mlroDate: null } : null })} /><span className="text-xs font-medium">{t.flagForSTR}</span></label>
            {ent.str?.flagged && (<><div><label className="text-xs text-gray-500">{t.submissionDate}</label><input type="date" value={ent.str.submittedDate || ''} onChange={e => updateEntity(ent.id, { str: { ...ent.str, submittedDate: e.target.value } })} className="block w-full border rounded px-2 py-1 text-xs mt-1" /></div><label className="flex items-center gap-2"><input type="checkbox" checked={ent.str.mlroApproved || false} onChange={e => updateEntity(ent.id, { str: { ...ent.str, mlroApproved: e.target.checked, mlroDate: e.target.checked ? today : null } })} /><span className="text-xs">{t.mlroApproved}</span></label>{ent.str.mlroApproved && <div className="text-xs text-green-600">✅ {t.approvedOn} {ent.str.mlroDate}</div>}{ent.str.submittedDate && !ent.str.mlroApproved && <div className="text-xs text-amber-600">{t.awaitingMLRO}</div>}{!ent.str.submittedDate && <div className="text-xs text-red-600">{t.strNotSubmitted}</div>}</>)}
          </div>
        </div>)}

        {detailTab === 'notes' && (<div>
          <div className="flex justify-between items-center mb-2"><span className="text-xs font-semibold text-gray-700">{t.notesTimeline}</span><button onClick={() => openModal('addNote', { text: '', author: '' })} className="bg-blue-600 text-white px-2 py-1 rounded text-xs">{t.addNote}</button></div>
          <div className="relative pl-5 border-l-2 border-blue-200 space-y-3">{[...ent.notes].reverse().map(n => (<div key={n.id} className="relative"><div className="absolute -left-7 top-1 w-3 h-3 rounded-full bg-blue-500 border-2 border-white" /><div className="bg-gray-50 rounded-lg p-2"><div className="flex gap-2 mb-0.5"><span className="text-xs font-semibold text-blue-600">{n.author}</span><span className="text-xs text-gray-400">{n.date}</span></div><div className="text-xs text-gray-700">{n.text}</div></div></div>))}{ent.notes.length === 0 && <div className="text-xs text-gray-400 py-3">{t.noNotesYet}</div>}</div>
        </div>)}

        {detailTab === 'risk' && (<div className="space-y-4">
          <AutoHighRiskBanner entity={ent} /><EDDBanner entity={ent} />
          <div className="flex items-center justify-between"><span className="text-xs font-semibold text-gray-700">{t.riskManagement}</span><div className="flex gap-2">{!crr.autoHighRisk && <button onClick={() => openModal('override', { rating: 'High', reason: '' })} className="bg-amber-500 text-white px-2 py-1 rounded text-xs">{t.overrideRating}</button>}{ent.riskOverride && !crr.autoHighRisk && <button onClick={() => { const c = calcCRR(ent); updateEntity(ent.id, { riskOverride: null, riskHistory: [...ent.riskHistory, { date: today, score: c.score, rating: c.rating, override: false, reason: 'Override cleared' }] }); }} className="bg-gray-500 text-white px-2 py-1 rounded text-xs">{t.clearOverride}</button>}</div></div>
          {crr.autoHighRisk && <div className="text-xs text-red-600 bg-red-50 rounded-lg p-2 border border-red-200">{lang === 'zh' ? '此實體為自動高風險類型，無法覆寫風險評級。' : 'Auto High Risk — override not available.'}</div>}
          {ent.riskOverride && !crr.autoHighRisk && (<div className="bg-purple-50 border border-purple-200 rounded-lg p-2"><div className="flex items-center gap-2 mb-1"><BadgeC color="purple">{t.overrideActive}</BadgeC><RiskBadge rating={ent.riskOverride.rating} label={tR(ent.riskOverride.rating)} /></div><div className="text-xs text-gray-700">{t.reason}: {ent.riskOverride.reason}</div><div className="text-xs text-gray-400">{t.by} {ent.riskOverride.by} {t.on} {ent.riskOverride.date}</div></div>)}
          <div><div className="text-xs font-semibold text-gray-600 mb-1">{t.riskScoreTrend}</div>{ent.riskHistory.length > 1 ? (<ResponsiveContainer width="100%" height={150}><LineChart data={ent.riskHistory}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 9 }} /><YAxis domain={[0, 100]} /><RTooltip /><Line type="monotone" dataKey="score" stroke="#ef4444" strokeWidth={2} /></LineChart></ResponsiveContainer>) : <div className="text-xs text-gray-400 text-center py-3">{t.insufficientHistory}</div>}</div>
          <div><div className="text-xs font-semibold text-gray-600 mb-1">{t.auditTrail}</div><div className="space-y-1 max-h-40 overflow-y-auto">{[...ent.riskHistory].reverse().map((h, i) => (<div key={i} className="flex items-center gap-2 text-xs p-1.5 bg-gray-50 rounded"><span className="text-gray-400">{h.date}</span><span className="font-medium">{t.score}: {h.score}</span><RiskBadge rating={h.rating} label={tR(h.rating)} />{h.override && <BadgeC color="purple">{t.override}</BadgeC>}{h.reason && <span className="text-gray-500 truncate">— {h.reason}</span>}</div>))}</div></div>
        </div>)}
      </ModalShell>
    );
  };

  const renderSearch = () => (<div><h2 className="text-lg font-bold text-gray-800 mb-3">{t.globalSearch}</h2><input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={t.searchPlaceholder} className="w-full border rounded-xl px-4 py-2.5 text-sm mb-3" autoFocus />{searchResults && (<div className="space-y-3">{searchResults.entities.length > 0 && <div><h3 className="text-xs font-semibold text-gray-600 mb-1">{t.entity} ({searchResults.entities.length})</h3>{searchResults.entities.map(e => (<div key={e.id} className="flex items-center gap-2 p-2 bg-white rounded-lg border mb-1 cursor-pointer hover:bg-blue-50" onClick={() => { setSelectedId(e.id); setDetailTab('overview'); setView('workspace'); }}><span>{e.type === 'person' ? '👤' : '🏢'}</span><span className="font-medium text-sm">{e.name}</span><span className="text-xs text-gray-400">{e.jurisdiction}</span><RiskBadge rating={getEffectiveRating(e).rating} label={tR(getEffectiveRating(e).rating)} /><DDLevelBadge entity={e} /></div>))}</div>}{searchResults.notes.length > 0 && <div><h3 className="text-xs font-semibold text-gray-600 mb-1">{t.notes} ({searchResults.notes.length})</h3>{searchResults.notes.map(n => (<div key={n.id} className="p-2 bg-white rounded-lg border mb-1 cursor-pointer hover:bg-blue-50" onClick={() => { setSelectedId(n.entityId); setDetailTab('notes'); setView('workspace'); }}><div className="text-xs text-blue-600">{n.entityName} — {n.date}</div><div className="text-xs text-gray-700">{n.text}</div></div>))}</div>}{searchResults.todos.length > 0 && <div><h3 className="text-xs font-semibold text-gray-600 mb-1">{t.todos} ({searchResults.todos.length})</h3>{searchResults.todos.map(td => (<div key={td.id} className="flex items-center gap-2 p-2 bg-white rounded-lg border mb-1"><PriorityDot p={td.priority} /><span className="text-xs text-gray-700">{td.text}</span></div>))}</div>}{searchResults.entities.length === 0 && searchResults.notes.length === 0 && searchResults.todos.length === 0 && <div className="text-center text-gray-400 py-6">{t.noResults}</div>}</div>)}</div>);

  const renderSnapshots = () => (<div>
    <h2 className="text-lg font-bold text-gray-800 mb-3">{t.snapshots}</h2>
    <div className="bg-white rounded-xl border p-3 mb-3"><div className="flex gap-2"><input value={snapDescInput} onChange={e => setSnapDescInput(e.target.value)} placeholder={t.snapshotDesc} className="flex-1 border rounded px-3 py-1.5 text-sm" /><button onClick={() => { setSnapshots(prev => [...prev, { id: gid(), date: today, description: snapDescInput || `Snap ${prev.length + 1}`, entities: JSON.parse(JSON.stringify(entities)), relationships: JSON.parse(JSON.stringify(relationships)) }]); setSnapDescInput(''); }} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm">{t.saveSnapshot}</button></div><div className="text-xs text-gray-400 mt-1">{t.savesCurrentState}: {entities.length} {t.entitiesLabel}, {relationships.length} {t.relationshipsLabel}</div></div>
    {snapshots.length > 1 && <div className="flex justify-end mb-2"><button onClick={() => openModal('confirmDeleteAllSnapshots')} className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50">🗑️ {t.deleteAllSnapshots} ({snapshots.length})</button></div>}
    <div className="space-y-2">{snapshots.map(s => (<div key={s.id} className="bg-white rounded-xl border p-3 flex items-center gap-3"><div className="flex-1"><div className="font-medium text-sm">{s.description}</div><div className="text-xs text-gray-400">{s.date} — {s.entities.length} {t.entitiesLabel}, {s.relationships.length} {t.relationshipsLabel}</div></div><div className="flex gap-1.5 items-center"><button onClick={() => { setEntities(JSON.parse(JSON.stringify(s.entities))); setRelationships(JSON.parse(JSON.stringify(s.relationships))); setBatchSelected(new Set()); setDagSelected(null); }} className="text-xs bg-green-600 text-white px-2.5 py-1 rounded font-medium hover:bg-green-700">{t.restore}</button><button onClick={() => openModal('confirmDeleteSnapshot', { snapshotId: s.id, snapshotDesc: s.description })} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">🗑️</button></div></div>))}{snapshots.length >= 2 && (<div className="bg-gray-50 rounded-xl border p-3 mt-3"><div className="text-sm font-semibold text-gray-700 mb-2">{t.compareSnapshots}</div><div className="flex gap-2 items-center"><select onChange={e => setShowSnapCompare(prev => [e.target.value, prev?.[1] || ''])} className="border rounded px-2 py-1 text-xs flex-1"><option value="">{t.selectA}</option>{snapshots.map(s => <option key={s.id} value={s.id}>{s.description}</option>)}</select><span className="text-gray-400">vs</span><select onChange={e => setShowSnapCompare(prev => [prev?.[0] || '', e.target.value])} className="border rounded px-2 py-1 text-xs flex-1"><option value="">{t.selectB}</option>{snapshots.map(s => <option key={s.id} value={s.id}>{s.description}</option>)}</select></div>{snapDiff && (<div className="mt-2 space-y-1">{snapDiff.added.length > 0 && <div className="text-xs"><span className="text-green-600 font-medium">{t.added}:</span> {snapDiff.added.map(e => e.name).join(', ')}</div>}{snapDiff.removed.length > 0 && <div className="text-xs"><span className="text-red-600 font-medium">{t.removed}:</span> {snapDiff.removed.map(e => e.name).join(', ')}</div>}{snapDiff.changed.length > 0 && <div className="text-xs"><span className="text-amber-600 font-medium">{t.changed}:</span> {snapDiff.changed.map(e => e.name).join(', ')}</div>}{snapDiff.added.length === 0 && snapDiff.removed.length === 0 && snapDiff.changed.length === 0 && <div className="text-xs text-gray-400">{t.noDifferences}</div>}</div>)}</div>)}{snapshots.length === 0 && <div className="text-center text-gray-400 py-6">{t.noSnapshotsYet}</div>}</div>
  </div>);

  const renderSettings = () => (<div><h2 className="text-lg font-bold text-gray-800 mb-3">{t.settings}</h2><div className="flex gap-2 mb-3">{[{ id: 'weights', l: t.riskWeights }, { id: 'countries', l: t.countryLists }, { id: 'threshold', l: t.uboThreshold }].map(tb => <button key={tb.id} onClick={() => setSettingsTab(tb.id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${settingsTab === tb.id ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>{tb.l}</button>)}</div>
    {settingsTab === 'weights' && <div className="bg-white rounded-xl border p-5 space-y-3"><div className="text-xs text-gray-500 mb-2">{t.adjustWeights}</div>{Object.entries(settings.weights).map(([k, v]) => (<div key={k} className="flex items-center gap-3"><span className="text-xs font-medium text-gray-700 w-24">{t[WK[k]] || k}</span><input type="range" min="0" max="50" value={v} onChange={e => setSettings(prev => ({ ...prev, weights: { ...prev.weights, [k]: parseInt(e.target.value) } }))} className="flex-1" /><span className="text-sm font-bold text-blue-600 w-8 text-right">{v}</span></div>))}<button onClick={() => setSettings(prev => ({ ...prev, weights: { ...DEFAULT_WEIGHTS } }))} className="text-xs text-gray-400">{t.resetDefaults}</button></div>}
    {settingsTab === 'countries' && <div className="bg-white rounded-xl border p-5 space-y-4">{[{ key: 'highRisk', label: t.highRiskCountries }, { key: 'offshore', label: t.offshoreJurisdictions }, { key: 'monitored', label: t.monitoredCountries }].map(({ key, label }) => (<div key={key}><div className="text-xs font-semibold text-gray-700 mb-1">{label}</div><div className="flex flex-wrap gap-1 mb-1">{settings[key].map(c => (<span key={c} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs bg-gray-100 border">{c}<button onClick={() => setSettings(prev => ({ ...prev, [key]: prev[key].filter(x => x !== c) }))} className="text-gray-400 hover:text-red-500">×</button></span>))}</div><select onChange={e => { if (e.target.value && !settings[key].includes(e.target.value)) setSettings(prev => ({ ...prev, [key]: [...prev[key], e.target.value].sort() })); e.target.value = ''; }} className="border rounded px-2 py-1 text-xs w-full"><option value="">{t.addCountry}</option>{ALL_COUNTRIES.filter(c => !settings[key].includes(c)).map(c => <option key={c}>{c}</option>)}</select></div>))}</div>}
    {settingsTab === 'threshold' && <div className="bg-white rounded-xl border p-5 space-y-3"><div className="text-xs text-gray-500">{t.configureUBO}</div><div className="flex items-center gap-3"><span className="text-xs font-medium text-gray-700">{t.uboThreshold}</span><input type="range" min="5" max="50" step="5" value={settings.uboThreshold} onChange={e => setSettings(prev => ({ ...prev, uboThreshold: parseInt(e.target.value) }))} className="flex-1" /><span className="text-xl font-bold text-blue-600">{settings.uboThreshold}%</span></div><div className="text-xs text-gray-400">{t.commonValues}</div></div>}
  </div>);

  const renderReport = () => {
    if (entities.length === 0) return <EmptyState />;
    const riskDist = { High: 0, Medium: 0, Low: 0 }; entities.forEach(e => riskDist[getEffectiveRating(e).rating]++);
    return (<div><div className="flex items-center justify-between mb-3"><h2 className="text-lg font-bold text-gray-800">{t.complianceReport}</h2><button onClick={exportCSV} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-green-700">{t.exportCSV}</button></div><div className="bg-white rounded-xl border p-5 space-y-5 text-sm">
      <div className="text-center border-b pb-3"><h1 className="text-lg font-bold">{t.reportTitle}</h1><div className="text-gray-500 text-xs">{t.generated}: {today}</div></div>
      <div><h3 className="font-bold text-gray-700 mb-2">{t.executiveSummary}</h3><div className="grid grid-cols-3 gap-2"><div className="bg-gray-50 rounded p-2 text-center"><div className="text-lg font-bold">{entities.length}</div><div className="text-xs text-gray-500">{t.totalEntities}</div></div><div className="bg-red-50 rounded p-2 text-center"><div className="text-lg font-bold text-red-600">{riskDist.High}</div><div className="text-xs text-gray-500">{t.highRisk}</div></div><div className="bg-amber-50 rounded p-2 text-center"><div className="text-lg font-bold text-amber-600">{autoTodos.length}</div><div className="text-xs text-gray-500">{t.activeTodos}</div></div></div></div>
      <div><h3 className="font-bold text-gray-700 mb-2">{t.entityRiskAssessment}</h3><table className="w-full text-xs border-collapse"><thead><tr className="bg-gray-100"><th className="p-1.5 text-left border">{t.entity}</th><th className="p-1.5 text-left border">{t.type}</th><th className="p-1.5 text-left border">{t.companyCategory}</th><th className="p-1.5 text-left border">{t.jurisdiction}</th><th className="p-1.5 text-left border">{t.crr}</th><th className="p-1.5 text-left border">{t.rating}</th><th className="p-1.5 text-left border">{t.dueDiligenceLevel}</th></tr></thead><tbody>{entities.map(e => { const r = getEffectiveRating(e); const dd = getDDLevel(e).toUpperCase(); return (<tr key={e.id} className="border-t"><td className="p-1.5 border">{e.name}</td><td className="p-1.5 border">{e.subType}</td><td className="p-1.5 border">{e.type === 'company' ? getCategoryLabel(e.companyCategory) : '—'}</td><td className="p-1.5 border">{e.jurisdiction}</td><td className="p-1.5 border">{r.score}</td><td className="p-1.5 border" style={{ color: RISK_COLORS[r.rating] }}>{tR(r.rating)}{r.overridden ? ' ⚡' : ''}{r.autoHighRisk ? ' 🔒' : ''}</td><td className="p-1.5 border font-medium">{dd}</td></tr>); })}</tbody></table></div>
      <div><h3 className="font-bold text-gray-700 mb-2">{t.uboSummary}</h3>{entities.filter(e => e.type === 'company').map(ent => { const ubos = findUBOs(ent.id, settings.uboThreshold); if (!ubos.length) return null; return <div key={ent.id} className="mb-2"><div className="font-medium">{ent.name}</div>{ubos.map((u, i) => <div key={i} className="text-xs text-gray-600 ml-3">→ {u.entity.name}: {u.percentage}%{u.entity.isPEP ? ' (PEP)' : ''}</div>)}</div>; })}</div>
    </div></div>);
  };

  const d = modalData;
  const renderModals = () => (<>
    {selectedEntity && renderEntityDetail()}

    {modalType === 'addEntity' && (<ModalShell title={t.addEntityTitle} onClose={closeModal}><div className="space-y-3">
      <FormField label={`${t.name} *`}><input value={d.name || ''} onChange={e => setD('name', e.target.value)} className={`w-full border rounded px-3 py-2 text-sm ${!d.name ? 'border-red-300' : ''}`} placeholder={t.entityName} /></FormField>
      {!d.name && d._touched && <div className="text-xs text-red-500">{t.requiredField}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t.type}><select value={d.type || 'company'} onChange={e => { setD('type', e.target.value); setD('subType', ''); if (e.target.value === 'person') setD('companyCategory', null); }} className="w-full border rounded px-3 py-2 text-sm"><option value="company">{t.company}</option><option value="person">{t.person}</option></select></FormField>
        <FormField label={t.subType}><select value={d.subType || ''} onChange={e => setD('subType', e.target.value)} className="w-full border rounded px-3 py-2 text-sm"><option value="">{t.selectType}</option>{((d.type || 'company') === 'company' ? companySubTypes : personSubTypes).map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select></FormField>
      </div>
      {(d.type || 'company') === 'company' && (<FormField label={t.companyCategory}><select value={d.companyCategory || 'private'} onChange={e => setD('companyCategory', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">{companyCategoryOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select></FormField>)}
      {(d.type || 'company') === 'company' && SDD_ELIGIBLE_CATEGORIES.includes(d.companyCategory) && (<div className="bg-cyan-50 border border-cyan-300 rounded-lg p-2.5 text-xs text-cyan-700">🔵 {t.sddEligible.replace('{type}', getCategoryLabel(d.companyCategory))}</div>)}
      {AUTO_HIGH_RISK_SUBTYPES.includes(d.subType) && (<div className="bg-red-50 border border-red-300 rounded-lg p-2.5 text-xs text-red-700">🔴 {t.autoHighRiskNotice.replace('{subType}', d.subType)}</div>)}
      <FormField label={t.jurisdiction}><select value={d.jurisdiction || 'USA'} onChange={e => setD('jurisdiction', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">{ALL_COUNTRIES.map(c => <option key={c}>{c}</option>)}</select></FormField>
      <FormField label={t.industryLabel}><select value={d.industry || ''} onChange={e => setD('industry', e.target.value)} className="w-full border rounded px-3 py-2 text-sm"><option value="">{t.selectIndustry}</option>{ALL_INDUSTRIES.map(ind => <option key={ind} value={ind}>{indLabel(ind)}{HIGH_RISK_INDUSTRIES.includes(ind) ? ' 🔴' : MEDIUM_RISK_INDUSTRIES.includes(ind) ? ' 🟡' : ''}</option>)}</select></FormField>
      {HIGH_RISK_INDUSTRIES.includes(d.industry) && (<div className="bg-orange-50 border border-orange-300 rounded-lg p-2.5 text-xs text-orange-700">🏭 {t.autoEDDIndustry}</div>)}
      {(d.type || 'company') === 'company' && (<div className="bg-blue-50 rounded-lg p-3"><FormField label={t.totalSharesLabel}><input type="number" value={d.totalShares || ''} onChange={e => setD('totalShares', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" /></FormField></div>)}
      <button onClick={() => { if (!d.name) { setD('_touched', true); return; } const isAHR = AUTO_HIGH_RISK_SUBTYPES.includes(d.subType); const nextReview = isAHR ? new Date(new Date().getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : ''; setEntities(prev => [...prev, { id: gid(), name: d.name, type: d.type || 'company', subType: d.subType || '', companyCategory: (d.type || 'company') === 'company' ? (d.companyCategory || 'private') : null, jurisdiction: d.jurisdiction || 'USA', totalShares: d.totalShares ? parseInt(d.totalShares) : null, industry: d.industry || '', isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: today, score: 0, rating: 'Low' }], lastReviewDate: today, nextReviewDate: nextReview, documents: [], screeningLogs: [], str: null, notes: [], cddRecords: [] }]); closeModal(); }} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium mt-2">{t.addEntity}</button>
      </div></ModalShell>)}

    {modalType === 'editEntity' && (<ModalShell title={t.editEntityTitle} onClose={closeModal}><div className="space-y-3">
      <FormField label={`${t.name} *`}><input value={d.name || ''} onChange={e => setD('name', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" /></FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t.type}><select value={d.type || 'company'} onChange={e => { setD('type', e.target.value); setD('subType', ''); if (e.target.value === 'person') setD('companyCategory', null); }} className="w-full border rounded px-3 py-2 text-sm"><option value="company">{t.company}</option><option value="person">{t.person}</option></select></FormField>
        <FormField label={t.subType}><select value={d.subType || ''} onChange={e => setD('subType', e.target.value)} className="w-full border rounded px-3 py-2 text-sm"><option value="">{t.selectType}</option>{((d.type || 'company') === 'company' ? companySubTypes : personSubTypes).map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select></FormField>
      </div>
      {(d.type || 'company') === 'company' && (<FormField label={t.companyCategory}><select value={d.companyCategory || 'private'} onChange={e => setD('companyCategory', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">{companyCategoryOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select></FormField>)}
      {(d.type || 'company') === 'company' && SDD_ELIGIBLE_CATEGORIES.includes(d.companyCategory) && (<div className="bg-cyan-50 border border-cyan-300 rounded-lg p-2.5 text-xs text-cyan-700">🔵 {t.sddEligible.replace('{type}', getCategoryLabel(d.companyCategory))}</div>)}
      {AUTO_HIGH_RISK_SUBTYPES.includes(d.subType) && (<div className="bg-red-50 border border-red-300 rounded-lg p-2.5 text-xs text-red-700">🔴 {t.autoHighRiskNotice.replace('{subType}', d.subType)}</div>)}
      <FormField label={t.jurisdiction}><select value={d.jurisdiction || 'USA'} onChange={e => setD('jurisdiction', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">{ALL_COUNTRIES.map(c => <option key={c}>{c}</option>)}</select></FormField>
      <FormField label={t.industryLabel}><select value={d.industry || ''} onChange={e => setD('industry', e.target.value)} className="w-full border rounded px-3 py-2 text-sm"><option value="">{t.selectIndustry}</option>{ALL_INDUSTRIES.map(ind => <option key={ind} value={ind}>{indLabel(ind)}{HIGH_RISK_INDUSTRIES.includes(ind) ? ' 🔴' : MEDIUM_RISK_INDUSTRIES.includes(ind) ? ' 🟡' : ''}</option>)}</select></FormField>
      {HIGH_RISK_INDUSTRIES.includes(d.industry) && (<div className="bg-orange-50 border border-orange-300 rounded-lg p-2.5 text-xs text-orange-700">🏭 {t.autoEDDIndustry}</div>)}
      {(d.type || 'company') === 'company' && (<div className="bg-blue-50 rounded-lg p-3"><FormField label={t.totalSharesLabel}><input type="number" value={d.totalShares != null ? d.totalShares : ''} onChange={e => setD('totalShares', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" /></FormField></div>)}
      <button onClick={() => { if (!d.name || !d.id) return; const isAHR = AUTO_HIGH_RISK_SUBTYPES.includes(d.subType); const up = { name: d.name, type: d.type, subType: d.subType || '', companyCategory: (d.type || 'company') === 'company' ? (d.companyCategory || 'private') : null, jurisdiction: d.jurisdiction, totalShares: d.totalShares ? parseInt(d.totalShares) : null, industry: d.industry || '' }; if (isAHR) { const ent = entities.find(e => e.id === d.id); if (ent && !ent.nextReviewDate) up.nextReviewDate = new Date(new Date().getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); } updateEntity(d.id, up); closeModal(); }} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium mt-2">{t.saveChanges}</button>
      </div></ModalShell>)}
    
      {modalType === 'batchEdit' && (<ModalShell title={`${t.batchEdit} (${batchSelected.size} ${t.selected})`} onClose={closeModal}><div className="space-y-3">
      <FormField label={t.jurisdiction}><select value={d.jurisdiction || ''} onChange={e => setD('jurisdiction', e.target.value)} className="w-full border rounded px-3 py-2 text-sm"><option value="">{lang === 'zh' ? '— 不變更 —' : '— No change —'}</option>{ALL_COUNTRIES.map(c => <option key={c}>{c}</option>)}</select></FormField>
      <FormField label={t.subType}><select value={d.subType || ''} onChange={e => setD('subType', e.target.value)} className="w-full border rounded px-3 py-2 text-sm"><option value="">{lang === 'zh' ? '— 不變更 —' : '— No change —'}</option>{[...companySubTypes, ...personSubTypes].map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select></FormField>
    </div><button onClick={() => { [...batchSelected].forEach(id => { const up = {}; if (d.jurisdiction) up.jurisdiction = d.jurisdiction; if (d.subType) up.subType = d.subType; if (Object.keys(up).length > 0) updateEntity(id, up); }); setBatchSelected(new Set()); closeModal(); }} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium mt-4">{t.apply}</button></ModalShell>)}

    {modalType === 'confirmDeleteSingle' && (() => { const ent = entities.find(e => e.id === d.entityId); return ent ? <ModalShell title={t.confirmDeleteTitle} onClose={closeModal}><div className="space-y-3"><div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{t.confirmDeleteMsg}</div><div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg"><span>{ent.type === 'person' ? '👤' : '🏢'}</span><span className="text-sm font-medium">{ent.name}</span></div><div className="flex gap-2 justify-end"><button onClick={closeModal} className="px-4 py-2 border rounded-lg text-sm text-gray-600">{t.cancel}</button><button onClick={() => { deleteEntity(d.entityId); closeModal(); }} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium">{t.confirmDelete}</button></div></div></ModalShell> : null; })()}

    {modalType === 'confirmDeleteBatch' && (<ModalShell title={t.confirmDeleteTitle} onClose={closeModal}><div className="space-y-3"><div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{t.confirmDeleteMsg}</div><div className="space-y-1 max-h-48 overflow-y-auto">{[...batchSelected].map(id => { const ent = entities.find(e => e.id === id); return ent ? <div key={id} className="flex items-center gap-2 p-1.5 bg-gray-50 rounded"><span>{ent.type === 'person' ? '👤' : '🏢'}</span><span className="text-xs font-medium">{ent.name}</span></div> : null; })}</div><div className="flex gap-2 justify-end"><button onClick={closeModal} className="px-4 py-2 border rounded-lg text-sm text-gray-600">{t.cancel}</button><button onClick={() => { deleteMultipleEntities([...batchSelected]); closeModal(); }} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium">{t.confirmDelete}</button></div></div></ModalShell>)}

    {modalType === 'confirmClearAll' && (<ModalShell title={t.clearAll} onClose={closeModal}><div className="space-y-3"><div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{t.clearAllConfirm}</div><div className="flex gap-2 justify-end"><button onClick={closeModal} className="px-4 py-2 border rounded-lg text-sm text-gray-600">{t.cancel}</button><button onClick={() => { clearAllData(); closeModal(); }} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium">{t.confirmDelete}</button></div></div></ModalShell>)}

    {modalType === 'confirmDeleteSnapshot' && (<ModalShell title={t.confirmDeleteSnapshotTitle} onClose={closeModal}><div className="space-y-3"><div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{t.confirmDeleteSnapshotMsg}</div><div className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg border"><span className="text-lg">📸</span><div className="text-sm font-medium text-gray-800">{d.snapshotDesc}</div></div><div className="flex gap-2 justify-end"><button onClick={closeModal} className="px-4 py-2 border rounded-lg text-sm text-gray-600">{t.cancel}</button><button onClick={() => { deleteSnapshot(d.snapshotId); closeModal(); }} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium">{t.confirmDelete}</button></div></div></ModalShell>)}

    {modalType === 'confirmDeleteAllSnapshots' && (<ModalShell title={t.confirmDeleteSnapshotTitle} onClose={closeModal}><div className="space-y-3"><div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{t.confirmDeleteAllSnapshotsMsg}</div><div className="flex gap-2 justify-end"><button onClick={closeModal} className="px-4 py-2 border rounded-lg text-sm text-gray-600">{t.cancel}</button><button onClick={() => { deleteAllSnapshots(); closeModal(); }} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium">{t.confirmDelete}</button></div></div></ModalShell>)}

    {modalType === 'addRel' && (
      <ModalShell title={t.addRelTitle} onClose={closeModal}>
        {renderRelForm(d, setD, false)}
        {d.type === 'control' && (<div className="mt-3 space-y-1"><FormField label={lang === 'zh' ? '控制權比例 (%)' : 'Control Percentage (%)'}><input type="number" min="0" max="100" value={d.controlPct ?? ''} onChange={e => setD('controlPct', e.target.value)} placeholder={lang === 'zh' ? '留空 = 100% 完全控制' : 'Leave blank = 100% full control'} className="w-full border rounded px-3 py-2 text-sm" /></FormField><p className="text-xs text-gray-400">{lang === 'zh' ? '💡 未填寫視為完全控制（100%）。' : '💡 Blank = full control (100%).'}</p></div>)}
        <button onClick={() => { const errors = getRelValidationErrors(d.sourceId, d.targetId, d.type || 'ownership', (d.inputMode || 'shares') === 'shares' ? d.shares : null, d.inputMode === 'percentage' ? d.percentage : null, d.inputMode || 'shares'); if (!d.sourceId || !d.targetId || errors.length > 0) return; setRelationships(prev => [...prev, { id: gid(), sourceId: d.sourceId, targetId: d.targetId, type: d.type || 'ownership', shares: (d.type !== 'control' && (d.inputMode || 'shares') === 'shares' && d.shares) ? parseInt(d.shares) : null, percentage: d.type === 'control' ? (d.controlPct != null && d.controlPct !== '' ? parseFloat(d.controlPct) : null) : (d.inputMode === 'percentage' && d.percentage ? parseFloat(d.percentage) : null), description: d.description || '' }]); closeModal(); }} disabled={!d.sourceId || !d.targetId || getRelValidationErrors(d.sourceId, d.targetId, d.type || 'ownership', (d.inputMode || 'shares') === 'shares' ? d.shares : null, d.inputMode === 'percentage' ? d.percentage : null, d.inputMode || 'shares').length > 0} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium mt-4 disabled:opacity-50">{t.addRelationship}</button>
      </ModalShell>
    )}

    {modalType === 'editRel' && (
      <ModalShell title={t.editRelTitle} onClose={closeModal}>
        {renderRelForm(d, setD, true)}
        {d.type === 'control' && (<div className="mt-3 space-y-1"><FormField label={lang === 'zh' ? '控制權比例 (%)' : 'Control Percentage (%)'}><input type="number" min="0" max="100" value={d.controlPct ?? (d.percentage != null ? d.percentage : '')} onChange={e => setD('controlPct', e.target.value)} placeholder={lang === 'zh' ? '留空 = 100% 完全控制' : 'Leave blank = 100% full control'} className="w-full border rounded px-3 py-2 text-sm" /></FormField></div>)}
        <div className="flex gap-2 mt-4">
          <button onClick={() => { const errors = getRelValidationErrors(d.sourceId, d.targetId, d.type || 'ownership', (d.inputMode || 'shares') === 'shares' ? d.shares : null, d.inputMode === 'percentage' ? d.percentage : null, d.inputMode || 'shares', d.id); if (!d.id || !d.sourceId || !d.targetId || errors.length > 0) return; updateRel(d.id, { sourceId: d.sourceId, targetId: d.targetId, type: d.type || 'ownership', shares: (d.type !== 'control' && (d.inputMode || 'shares') === 'shares' && d.shares) ? parseInt(d.shares) : null, percentage: d.type === 'control' ? (d.controlPct != null && d.controlPct !== '' ? parseFloat(d.controlPct) : (d.percentage != null ? d.percentage : null)) : (d.inputMode === 'percentage' && d.percentage ? parseFloat(d.percentage) : null), description: d.description || '' }); closeModal(); }} disabled={!d.sourceId || !d.targetId || getRelValidationErrors(d.sourceId, d.targetId, d.type || 'ownership', (d.inputMode || 'shares') === 'shares' ? d.shares : null, d.inputMode === 'percentage' ? d.percentage : null, d.inputMode || 'shares', d.id).length > 0} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">{t.saveRel}</button>
          <button onClick={() => { if (d.id) deleteRel(d.id); closeModal(); }} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium">{t.delete}</button>
        </div>
      </ModalShell>
    )}

    {modalType === 'override' && (<ModalShell title={t.overrideTitle} onClose={closeModal}><div className="space-y-3">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-700">{t.overrideWarning}</div>
      <FormField label={t.newRating}><select value={d.rating || 'High'} onChange={e => setD('rating', e.target.value)} className="w-full border rounded px-3 py-2 text-sm"><option value="High">{tR('High')}</option><option value="Medium">{tR('Medium')}</option><option value="Low">{tR('Low')}</option></select></FormField>
      <FormField label={t.reasonRequired}><textarea value={d.reason || ''} onChange={e => setD('reason', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" rows={3} placeholder={t.overrideJustification} /></FormField>
      <button onClick={() => { if (!d.reason || !selectedId) return; const ent = entities.find(e => e.id === selectedId); const crr = calcCRR(ent); updateEntity(selectedId, { riskOverride: { rating: d.rating, reason: d.reason, date: today, by: 'User' }, riskHistory: [...ent.riskHistory, { date: today, score: crr.score, rating: d.rating, override: true, reason: d.reason }] }); closeModal(); }} disabled={!d.reason} className="w-full bg-amber-500 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">{t.applyOverride}</button>
    </div></ModalShell>)}

    {modalType === 'addDoc' && (<ModalShell title={t.addDocTitle} onClose={closeModal}><div className="space-y-3">
      <FormField label={t.docName}><select value={d.name || ''} onChange={e => setD('name', e.target.value)} className="w-full border rounded px-3 py-2 text-sm"><option value="">{t.selectOrType}</option>{(selectedEntity?.type === 'person' ? DOC_PERSON : DOC_COMPANY).map(dc => <option key={dc}>{dc}</option>)}</select></FormField>
      <FormField label={t.expiryDate}><input type="date" value={d.expiry || ''} onChange={e => setD('expiry', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" /></FormField>
      <button onClick={() => { if (!d.name || !selectedId) return; const ent = entities.find(e => e.id === selectedId); updateEntity(selectedId, { documents: [...ent.documents, { id: gid(), name: d.name, status: 'pending', expiry: d.expiry || null }] }); closeModal(); }} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium">{t.addDocument}</button>
    </div></ModalShell>)}

    {modalType === 'addScreen' && (<ModalShell title={t.addScreenTitle} onClose={closeModal}><div className="space-y-3">
      <div className="grid grid-cols-2 gap-3"><FormField label={t.system}><select value={d.system || 'External Database'} onChange={e => setD('system', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">{['Internal Screening', 'External Database', 'Manual Check', 'Other'].map(s => <option key={s}>{s}</option>)}</select></FormField><FormField label={t.screenType}><select value={d.type || 'Sanctions'} onChange={e => setD('type', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">{['Sanctions', 'PEP', 'Negative News', 'Adverse Media'].map(tp => <option key={tp}>{tp}</option>)}</select></FormField></div>
      <FormField label={t.result}><input value={d.result || ''} onChange={e => setD('result', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" placeholder={t.resultPlaceholder} /></FormField>
      <button onClick={() => { if (!selectedId) return; const ent = entities.find(e => e.id === selectedId); updateEntity(selectedId, { screeningLogs: [...ent.screeningLogs, { id: gid(), date: today, system: d.system || 'External Database', type: d.type || 'Sanctions', result: d.result || 'Clear' }] }); closeModal(); }} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium">{t.addRecord}</button>
    </div></ModalShell>)}

    {modalType === 'addNote' && (<ModalShell title={t.addNoteTitle} onClose={closeModal}><div className="space-y-3">
      <FormField label={t.author}><input value={d.author || ''} onChange={e => setD('author', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" placeholder={t.yourName} /></FormField>
      <FormField label={t.note}><textarea value={d.text || ''} onChange={e => setD('text', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" rows={4} placeholder={t.enterNote} /></FormField>
      <button onClick={() => { if (!d.text || !selectedId) return; const ent = entities.find(e => e.id === selectedId); updateEntity(selectedId, { notes: [...ent.notes, { id: gid(), text: d.text, date: today, author: d.author || 'User' }] }); closeModal(); }} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium">{t.addNote}</button>
    </div></ModalShell>)}

    {modalType === 'batchReview' && (<ModalShell title={`${t.batchActionTitle}: ${t.updateReviewDate}`} onClose={closeModal}><div className="space-y-3"><div className="text-xs text-gray-600">{t.applyTo} {batchSelected.size} {t.selectedEntities}</div><FormField label={t.newReviewDate}><input type="date" value={d.date || ''} onChange={e => setD('date', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" /></FormField><button onClick={() => { [...batchSelected].forEach(id => { const ent = entities.find(e => e.id === id); if (!ent) return; const crr = calcCRR(ent); updateEntity(id, { lastReviewDate: d.date || today, riskHistory: [...ent.riskHistory, { date: today, score: crr.score, rating: crr.rating }] }); }); setBatchSelected(new Set()); closeModal(); }} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium">{t.apply}</button></div></ModalShell>)}

    {modalType === 'saveCDD' && (<ModalShell title={t.cddSaveTitle} onClose={closeModal}><div className="space-y-3">
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-xs text-indigo-700">{t.cddSaveDesc}</div>
      <div className="grid grid-cols-2 gap-3"><FormField label={t.cddType}><select value={d.type || 'periodic'} onChange={e => setD('type', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">{cddTypes.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}</select></FormField><FormField label={t.cddStatus}><select value={d.status || 'completed'} onChange={e => setD('status', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">{cddStatuses.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}</select></FormField></div>
      <FormField label={`${t.cddReviewer} *`}><input value={d.reviewer || ''} onChange={e => setD('reviewer', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" placeholder={t.yourName} /></FormField>
      <FormField label={t.cddSummary}><textarea value={d.summary || ''} onChange={e => setD('summary', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" rows={4} /></FormField>
      <button onClick={() => { if (!selectedId || !d.reviewer) return; saveCDDRecord(selectedId, d.reviewer, d.type || 'periodic', d.status || 'completed', d.summary || ''); closeModal(); }} disabled={!d.reviewer} className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-bold disabled:opacity-50">{t.saveCDD}</button>
    </div></ModalShell>)}

    {modalType === 'confirmRestoreCDD' && (<ModalShell title={t.cddRestore} onClose={closeModal}><div className="space-y-3"><div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">{t.cddRestoreConfirm}</div><div className="flex gap-2 justify-end"><button onClick={closeModal} className="px-4 py-2 border rounded-lg text-sm text-gray-600">{t.cancel}</button><button onClick={() => { if (selectedId && d.recordId) restoreCDDRecord(selectedId, d.recordId); closeModal(); }} className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium">{t.cddRestore}</button></div></div></ModalShell>)}
  </>);

  const navItems = [
    { id: 'dashboard', icon: '📊', label: t.dashboard },
    { id: 'workspace', icon: '🏢', label: t.workspace },
    { id: 'search', icon: '🔍', label: t.search },
    { id: 'snapshots', icon: '📸', label: t.snapshots },
    { id: 'settings', icon: '⚙️', label: t.settings },
    { id: 'report', icon: '📄', label: t.report },
  ];

    return (
    <div className={`flex h-screen ${darkMode ? 'bg-slate-950 text-slate-100 dm' : 'bg-slate-50 text-slate-800'} overflow-hidden`} style={{ fontSize: '13px' }}>
      
      {/* ===== Mobile Top Bar ===== */}
      <div className={`md:hidden fixed top-0 left-0 right-0 h-12 ${
        darkMode ? 'bg-slate-950/90 border-slate-800' : 'bg-white/90 border-slate-200'
      } backdrop-blur-md border-b flex items-center px-3 z-30 shrink-0`}>
        <button 
          onClick={() => setMobileSideOpen(!mobileSideOpen)} 
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            darkMode ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          ☰
        </button>
        <div className="flex items-center gap-2 ml-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow shadow-indigo-500/30">
            <Shield className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className={`text-sm font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
            {t.appTitle}
          </span>
        </div>
      </div>

      {/* ===== Toast ===== */}
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-5 py-2.5 rounded-xl shadow-lg shadow-emerald-500/30 text-sm font-semibold flex items-center gap-2"
          style={{ animation: 'kycSlideUp 0.25s ease-out' }}>
          <CheckCircle className="w-4 h-4" />
          {toastMsg}
        </div>
      )}

      {/* ===== Mobile Sidebar Overlay ===== */}
      {mobileSideOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden" onClick={() => setMobileSideOpen(false)} />
      )}

      {/* ===== Sidebar ===== */}
      <aside className={`fixed md:relative left-0 top-0 bottom-0 z-50 w-56 ${
        darkMode ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-200'
      } border-r flex flex-col shrink-0 transition-transform duration-200 ${
        mobileSideOpen ? 'translate-x-0' : '-translate-x-full'
      } md:translate-x-0`}>

        {/* Logo Header */}
        <div className={`px-4 py-4 border-b ${darkMode ? 'border-slate-800' : 'border-slate-100'}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Shield className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-bold leading-tight ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                {t.appTitle}
              </div>
              <div className={`text-[10px] leading-tight ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                {t.appSub}
              </div>
            </div>
          </div>
          <div className="mt-3 flex gap-1.5">
            <button 
              onClick={() => setLang(l => l === 'zh' ? 'en' : 'zh')} 
              className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold transition ${
                darkMode 
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' 
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              🌐 {lang === 'zh' ? 'EN' : '中文'}
            </button>
            <button 
              onClick={() => setDarkMode(dm => !dm)} 
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition ${
                darkMode 
                  ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-400' 
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
              title={darkMode ? t.lightMode : t.darkMode}
            >
              {darkMode ? '☀️' : '🌙'}
            </button>
          </div>
        </div>

        {/* Section Title */}
        <div className={`px-4 mt-4 mb-2 text-[10px] font-bold uppercase tracking-widest ${darkMode ? 'text-slate-600' : 'text-slate-400'}`}>
          {lang === 'zh' ? '工作區' : 'Workspace'}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
          {navItems.map(item => {
            const isActive = view === item.id;
            const count = item.id === 'snapshots' ? snapshots.length : 
                          item.id === 'workspace' ? entities.length : null;
            return (
              <button 
                key={item.id} 
                onClick={() => { setView(item.id); setMobileSideOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-semibold transition-all ${
                  isActive 
                    ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/25' 
                    : darkMode
                      ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                <span className="flex-1 text-left">{item.label}</span>
                {count != null && count > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${
                    isActive 
                      ? 'bg-white/25 text-white' 
                      : darkMode ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Urgent Alerts */}
        {autoTodos.filter(td => td.priority === 'critical' || td.priority === 'high').length > 0 && (
          <div className="p-2.5">
            <button
              onClick={() => setView('dashboard')}
              className={`w-full text-left rounded-xl p-3 transition ${
                darkMode 
                  ? 'bg-gradient-to-br from-red-500/10 to-orange-500/10 border border-red-500/20 hover:from-red-500/15 hover:to-orange-500/15' 
                  : 'bg-gradient-to-br from-red-50 to-orange-50 border border-red-200 hover:from-red-100 hover:to-orange-100'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow shadow-red-500/30">
                  <AlertTriangle className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                </div>
                <span className={`text-xs font-bold ${darkMode ? 'text-red-300' : 'text-red-900'}`}>
                  {autoTodos.filter(td => td.priority === 'critical' || td.priority === 'high').length} {t.urgentItems}
                </span>
              </div>
              <p className={`text-[11px] leading-relaxed ${darkMode ? 'text-red-300/80' : 'text-red-700'}`}>
                {lang === 'zh' ? '需立即處理的高優先級項目' : 'High priority items'}
              </p>
            </button>
          </div>
        )}

        {/* User */}
        <div className={`px-3 py-3 border-t ${darkMode ? 'border-slate-800' : 'border-slate-100'} flex items-center gap-2.5`}>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center text-white text-[11px] font-bold shadow shadow-purple-500/20">
            KT
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-bold truncate ${darkMode ? 'text-slate-200' : 'text-slate-800'}`}>
              Kazaf Tsui
            </div>
            <div className={`text-[10px] truncate ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              {lang === 'zh' ? '合規分析師' : 'Compliance Officer'}
            </div>
          </div>
        </div>
      </aside>

      {/* ===== Main Content ===== */}
      {view === 'workspace' ? (
        <div className="flex-1 flex flex-col overflow-hidden p-4 pb-10 pt-14 md:pt-4">
          {renderWorkspace()}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6 pb-10 pt-14 md:pt-6">
          {view === 'dashboard' && renderDashboard()}
          {view === 'search' && renderSearch()}
          {view === 'snapshots' && renderSnapshots()}
          {view === 'settings' && renderSettings()}
          {view === 'report' && renderReport()}
        </div>
      )}
      
      {renderModals()}
      
      {/* Footer Portal */}
      {createPortal(
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999, background: darkMode ? 'rgba(2,6,23,0.95)' : 'rgba(15,23,42,0.95)', borderTop: '1px solid #334155', textAlign: 'center', padding: '6px 0', backdropFilter: 'blur(8px)' }}>
          <p style={{ margin: 0, fontSize: 11, color: '#94a3b8' }}>
            © 2026 Designed &amp; Developed by{' '}
            <span style={{ color: '#60a5fa', fontWeight: 700 }}>Kazaf Tsui</span>
            {' '}· KYC/AML Compliance Management System · All Rights Reserved
          </p>
        </div>,
        document.body
      )}
    </div>
  );
}

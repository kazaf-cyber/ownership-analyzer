import ScreeningModuleV2 from './ScreeningModuleV2';
import BatchScanApp from './BatchScanApp';
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
import { AlertTriangle, CheckCircle, Shield, ChevronRight } from 'lucide-react';

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
    demandListTab: 'Demand List',                   
    demandListTitle: 'KYC Demand-List Compliance Card', 
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
    demandListTab: '需求清單',                   
    demandListTitle: 'KYC 需求清單合規卡', 
  }
};


/* ========== DEMAND-LIST KYC MODULE (Phase 1: Aggregator) ========== */

const DEMAND_LIST_FIELDS = [
  {
    id: 'legal_identity',
    icon: '🏛️',
    titleEn: 'Legal Identity',
    titleZh: '法律身分',
    descEn: 'Legal name, jurisdiction, registration number, incorporation date',
    descZh: '法律名稱、註冊地、登記號碼、註冊日期',
    priority: 'critical',
    fields: ['legal_name', 'jurisdiction', 'registration_number', 'incorporation_date'],
    autoSourceRef: 'entity_record',
  },
  {
    id: 'listed_status',
    icon: '📈',
    titleEn: 'Listed Status & Ticker',
    titleZh: '上市狀態與股票代號',
    descEn: 'Stock exchange listing, ticker, ISIN',
    descZh: '上市交易所、股票代號、ISIN',
    priority: 'high',
    fields: ['is_listed', 'exchange', 'ticker'],
    autoSourceRef: 'entity_record',
  },
  {
    id: 'ubo',
    icon: '👑',
    titleEn: 'Ultimate Beneficial Owners (≥25%)',
    titleZh: '最終受益人 (≥25%)',
    descEn: 'Natural persons owning/controlling ≥25%',
    descZh: '直接或間接持有 ≥25% 嘅自然人',
    priority: 'critical',
    fields: ['ubos'],
    autoSourceRef: 'graph_traversal',
  },
  {
    id: 'directors',
    icon: '👔',
    titleEn: 'Board of Directors',
    titleZh: '董事會',
    descEn: 'Current directors and executive officers',
    descZh: '現任董事與行政人員',
    priority: 'critical',
    fields: ['directors'],
    autoSourceRef: 'relationship_graph',
  },
  {
    id: 'sanctions',
    icon: '🚫',
    titleEn: 'Sanctions Screening',
    titleZh: '制裁篩查',
    descEn: 'OFAC / UN / EU / HK sanctions lists',
    descZh: 'OFAC / 聯合國 / 歐盟 / 香港制裁名單',
    priority: 'critical',
    fields: ['hit', 'lists_checked', 'hit_details'],
    autoSourceRef: 'screening_logs',
  },
  {
    id: 'pep',
    icon: '🏛️',
    titleEn: 'PEP Exposure',
    titleZh: 'PEP 暴露',
    descEn: 'Politically Exposed Persons among UBOs / directors',
    descZh: 'UBO 或董事中嘅政治敏感人物',
    priority: 'high',
    fields: ['has_pep', 'pep_persons'],
    autoSourceRef: 'pep_flag',
  },
  {
    id: 'adverse_media',
    icon: '📰',
    titleEn: 'Adverse Media (last 24 months)',
    titleZh: '不良媒體 (近 24 個月)',
    descEn: 'ML/TF, fraud, corruption-related news',
    descZh: '洗錢/恐融、欺詐、貪腐相關新聞',
    priority: 'high',
    fields: ['has_adverse', 'categories', 'summary'],
    autoSourceRef: 'screening_logs',
  },
  {
    id: 'industry',
    icon: '🏭',
    titleEn: 'Industry & Operations',
    titleZh: '行業與營運',
    descEn: 'Primary business, industry classification',
    descZh: '主營業務、行業分類',
    priority: 'medium',
    fields: ['primary_industry', 'operating_jurisdictions'],
    autoSourceRef: 'entity_record',
  },
  {
    id: 'documents',
    icon: '📄',
    titleEn: 'Required KYC Documents',
    titleZh: '所需 KYC 文件',
    descEn: 'Document checklist completion',
    descZh: '文件清單完成度',
    priority: 'high',
    fields: ['received', 'pending', 'expired'],
    autoSourceRef: 'documents',
  },
  {
    id: 'risk_rating',
    icon: '⚠️',
    titleEn: 'CRR Risk Rating',
    titleZh: 'CRR 風險評級',
    descEn: 'Effective risk rating with breakdown',
    descZh: '有效風險評級與分解',
    priority: 'critical',
    fields: ['rating', 'score', 'override'],
    autoSourceRef: 'risk_engine',
  },
];

const STATUS_CONFIG = {
  verified:  { color: 'green',  icon: '✅', labelEn: 'Verified',     labelZh: '已驗證' },
  partial:   { color: 'amber',  icon: '⚠️', labelEn: 'Partial',      labelZh: '部分' },
  pending:   { color: 'gray',   icon: '⏳', labelEn: 'Pending',      labelZh: '待處理' },
  hit:       { color: 'red',    icon: '🚨', labelEn: 'Hit / Flagged', labelZh: '命中 / 標記' },
  clean:     { color: 'green',  icon: '✓',  labelEn: 'Clean',        labelZh: '清白' },
  exposed:   { color: 'amber',  icon: '⚡', labelEn: 'Exposed',      labelZh: '已暴露' },
  conflict:  { color: 'red',    icon: '⚔️', labelEn: 'Conflict',     labelZh: '衝突' },
};

function DemandListKYC({ entity, entities, relationships, findUBOs, threshold, calcCRR, getEffectiveRating, lang, t, today }) {
  const STORAGE_KEY = `demand_list_${entity.id}`;

  const [fieldResults, setFieldResults] = useState(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  const [editingField, setEditingField] = useState(null);
  const [editDraft, setEditDraft] = useState({});

  /* ── Auto-populate from internal entity data ── */
  const autoData = useMemo(() => {
    const data = {};

    // 1. Legal Identity
    data.legal_identity = {
      value: {
        legal_name: entity.name,
        jurisdiction: entity.jurisdiction,
        registration_number: '',
        incorporation_date: '',
      },
      confidence: 0.6,
      sources: ['Internal KYC record'],
      asOf: entity.lastReviewDate || today,
      status: (entity.name && entity.jurisdiction) ? 'partial' : 'pending',
    };

    // 2. Listed Status
    const listed = entity.companyCategory === 'listed';
    data.listed_status = {
      value: {
        is_listed: listed,
        exchange: listed ? '(unknown — please add)' : 'N/A',
        ticker: '',
      },
      confidence: listed ? 0.5 : 0.9,
      sources: ['Internal KYC record'],
      asOf: today,
      status: listed ? 'partial' : 'verified',
    };

    // 3. UBOs (graph traversal)
    if (entity.type === 'company') {
      const ubos = findUBOs(entity.id, threshold);
      data.ubo = {
        value: {
          ubos: ubos.map(u => ({
            name: u.entity.name,
            ownership_pct: u.percentage,
            control_basis: u.direct ? 'direct' : u.viaControl ? 'control' : 'indirect',
            jurisdiction: u.entity.jurisdiction,
            is_pep: u.entity.isPEP,
          })),
        },
        confidence: ubos.length > 0 ? 0.85 : 0.4,
        sources: ['Internal ownership graph'],
        asOf: entity.lastReviewDate || today,
        status: ubos.length > 0 ? 'verified' : 'pending',
      };
    } else {
      data.ubo = { value: { ubos: [] }, confidence: 1, sources: ['N/A'], asOf: today, status: 'verified' };
    }

    // 4. Directors (rels with subType=Director or rel.type=control person)
    const directorRels = relationships.filter(r =>
      (r.targetId === entity.id || r.sourceId === entity.id) &&
      (r.type === 'control' || r.type === 'rca')
    );
    const directors = directorRels.map(r => {
      const person = entities.find(e => e.id === (r.sourceId === entity.id ? r.targetId : r.sourceId));
      return person && person.type === 'person' ? {
        name: person.name,
        role: person.subType || 'Director',
        nationality: person.jurisdiction,
        is_pep: person.isPEP,
      } : null;
    }).filter(Boolean);
    data.directors = {
      value: { directors },
      confidence: directors.length > 0 ? 0.7 : 0.3,
      sources: ['Internal relationship graph'],
      asOf: entity.lastReviewDate || today,
      status: directors.length > 0 ? 'partial' : 'pending',
    };

    // 5. Sanctions
    const sanctionLogs = (entity.screeningLogs || []).filter(l => l.type === 'Sanctions');
    const lastSanction = sanctionLogs[sanctionLogs.length - 1];
    data.sanctions = {
      value: {
        hit: entity.isSanctioned || (lastSanction && !lastSanction.result.startsWith('Clear')),
        lists_checked: lastSanction ? [lastSanction.system] : [],
        hit_details: entity.isSanctioned ? '(flagged in entity record)' : (lastSanction && !lastSanction.result.startsWith('Clear') ? lastSanction.result : ''),
      },
      confidence: lastSanction ? 0.9 : 0.4,
      sources: lastSanction ? [`Screening log ${lastSanction.id} (${lastSanction.date})`] : ['No screening on file'],
      asOf: lastSanction ? lastSanction.date : 'N/A',
      status: entity.isSanctioned ? 'hit' : (lastSanction ? 'clean' : 'pending'),
    };

    // 6. PEP
    const pepUbos = (data.ubo.value.ubos || []).filter(u => u.is_pep);
    const pepDirs = directors.filter(d => d.is_pep);
    const allPep = [
      ...(entity.isPEP ? [{ name: entity.name, role: entity.subType, pep_category: entity.pepCategory || 'unknown' }] : []),
      ...pepUbos.map(u => ({ name: u.name, role: 'UBO', pep_category: 'unknown' })),
      ...pepDirs.map(d => ({ name: d.name, role: d.role, pep_category: 'unknown' })),
    ];
    data.pep = {
      value: { has_pep: allPep.length > 0, pep_persons: allPep },
      confidence: 0.75,
      sources: ['Internal PEP flags'],
      asOf: entity.lastReviewDate || today,
      status: allPep.length > 0 ? 'exposed' : 'clean',
    };

    // 7. Adverse Media
    const adverseLogs = (entity.screeningLogs || []).filter(l =>
      l.type === 'Negative News' || l.type === 'Adverse Media'
    );
    const lastAdv = adverseLogs[adverseLogs.length - 1];
    data.adverse_media = {
      value: {
        has_adverse: entity.negativeNews || (lastAdv && !lastAdv.result.startsWith('Clear')),
        categories: [],
        summary: lastAdv ? lastAdv.result : '',
      },
      confidence: lastAdv ? 0.85 : 0.4,
      sources: lastAdv ? [`Screening log ${lastAdv.id} (${lastAdv.date})`] : ['No screening on file'],
      asOf: lastAdv ? lastAdv.date : 'N/A',
      status: entity.negativeNews ? 'hit' : (lastAdv ? 'clean' : 'pending'),
    };

    // 8. Industry
    data.industry = {
      value: {
        primary_industry: entity.industry || '(not set)',
        operating_jurisdictions: [entity.jurisdiction].filter(Boolean),
      },
      confidence: entity.industry ? 0.7 : 0.2,
      sources: ['Internal KYC record'],
      asOf: today,
      status: entity.industry ? 'verified' : 'pending',
    };

    // 9. Documents
    const docs = entity.documents || [];
    data.documents = {
      value: {
        received: docs.filter(d => d.status === 'received').length,
        pending: docs.filter(d => d.status === 'pending').length,
        expired: docs.filter(d => d.status === 'expired' || (d.expiry && d.expiry < today)).length,
        total: docs.length,
      },
      confidence: 1,
      sources: ['Internal document register'],
      asOf: today,
      status: docs.length === 0 ? 'pending'
        : docs.filter(d => d.status === 'expired').length > 0 ? 'partial'
        : docs.every(d => d.status === 'received') ? 'verified' : 'partial',
    };

    // 10. Risk Rating (CRR)
    const eff = getEffectiveRating(entity);
    data.risk_rating = {
      value: {
        rating: eff.rating,
        score: eff.score,
        override: eff.overridden,
        auto_high_risk: eff.autoHighRisk || false,
      },
      confidence: 1,
      sources: ['CRR engine'],
      asOf: today,
      status: eff.rating === 'High' ? 'hit' : eff.rating === 'Medium' ? 'partial' : 'verified',
    };

    return data;
  }, [entity, entities, relationships, findUBOs, threshold, today, getEffectiveRating]);

  // Merge auto + user overrides
  const mergedResults = useMemo(() => {
    const merged = {};
    DEMAND_LIST_FIELDS.forEach(f => {
      const auto = autoData[f.id];
      const userOverride = fieldResults[f.id];
      merged[f.id] = userOverride && userOverride._userEdited ? userOverride : auto;
    });
    return merged;
  }, [autoData, fieldResults]);

  // Persist user edits
  React.useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fieldResults)); } catch {}
  }, [fieldResults, STORAGE_KEY]);

  // Completion %
  const completion = useMemo(() => {
    const total = DEMAND_LIST_FIELDS.length;
    const done = DEMAND_LIST_FIELDS.filter(f => {
      const r = mergedResults[f.id];
      return r && (r.status === 'verified' || r.status === 'clean' || r.status === 'hit');
    }).length;
    return Math.round(done / total * 100);
  }, [mergedResults]);

  const startEdit = (fieldId) => {
    setEditingField(fieldId);
    setEditDraft({ ...mergedResults[fieldId] });
  };

  const saveEdit = () => {
    if (!editingField) return;
    setFieldResults(prev => ({
      ...prev,
      [editingField]: { ...editDraft, _userEdited: true, asOf: today },
    }));
    setEditingField(null);
    setEditDraft({});
  };

  const resetField = (fieldId) => {
    setFieldResults(prev => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  const exportMarkdown = () => {
    const lines = [
      `# KYC Compliance Report — ${entity.name}`,
      `Generated: ${today} | Completion: ${completion}%`,
      ``,
    ];
    DEMAND_LIST_FIELDS.forEach((f, i) => {
      const r = mergedResults[f.id];
      const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.pending;
      lines.push(`## ${i + 1}. ${f.icon} ${lang === 'zh' ? f.titleZh : f.titleEn}`);
      lines.push(`**Status:** ${sc.icon} ${lang === 'zh' ? sc.labelZh : sc.labelEn} | **Confidence:** ${Math.round(r.confidence * 100)}%`);
      lines.push(`**As of:** ${r.asOf}`);
      lines.push(``);
      lines.push('```json');
      lines.push(JSON.stringify(r.value, null, 2));
      lines.push('```');
      lines.push(`**Sources:** ${r.sources.join(', ')}`);
      lines.push(``);
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KYC_Report_${entity.name.replace(/[^a-z0-9]/gi, '_')}_${today}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      {/* Header with progress */}
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-500/30">
              <span className="text-white text-base">📋</span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {lang === 'zh' ? 'KYC 需求清單' : 'KYC Demand-List'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {lang === 'zh' ? '結構化合規清單 · 10 個關鍵欄位' : 'Structured compliance checklist · 10 key fields'}
              </p>
            </div>
          </div>
          <button
            onClick={exportMarkdown}
            className="text-xs bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-3 py-1.5 rounded-lg font-bold shadow-md shadow-indigo-500/20"
          >
            📥 {lang === 'zh' ? '匯出 MD' : 'Export MD'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-white/70 rounded-full overflow-hidden shadow-inner">
            <div
              className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-indigo-400 to-purple-500"
              style={{ width: `${completion}%` }}
            />
          </div>
          <span className="text-sm font-black text-indigo-700">{completion}%</span>
        </div>
      </div>

      {/* Demand fields */}
      <div className="space-y-2">
        {DEMAND_LIST_FIELDS.map((f, idx) => {
          const r = mergedResults[f.id];
          const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.pending;
          const isEditing = editingField === f.id;
          const isUserEdited = fieldResults[f.id]?._userEdited;

          return (
            <div key={f.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-sm transition-shadow">
              <div className="p-3">
                <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <span className="text-slate-400 font-mono text-xs mt-0.5">{String(idx + 1).padStart(2, '0')}</span>
                    <span className="text-base">{f.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-slate-900">
                        {lang === 'zh' ? f.titleZh : f.titleEn}
                        {f.priority === 'critical' && <span className="ml-1.5 text-[9px] font-black text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">CRITICAL</span>}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{lang === 'zh' ? f.descZh : f.descEn}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <BadgeC color={sc.color} dot>{sc.icon} {lang === 'zh' ? sc.labelZh : sc.labelEn}</BadgeC>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {Math.round(r.confidence * 100)}%
                    </span>
                  </div>
                </div>

                {/* Value display */}
                <div className="bg-slate-50 rounded-lg p-2.5 text-xs mb-2 border border-slate-100">
                  <pre className="whitespace-pre-wrap font-mono text-slate-700 text-[11px] leading-relaxed">
                    {JSON.stringify(r.value, null, 2)}
                  </pre>
                </div>

                {/* Sources + As of */}
                <div className="flex items-center gap-3 text-[10px] text-slate-500 flex-wrap">
                  <span><b>Sources:</b> {r.sources.join(', ') || 'None'}</span>
                  <span>•</span>
                  <span><b>As of:</b> {r.asOf}</span>
                  {isUserEdited && (
                    <>
                      <span>•</span>
                      <span className="text-indigo-600 font-bold">✏️ User-edited</span>
                    </>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex gap-1.5 mt-2">
                  <button
                    onClick={() => startEdit(f.id)}
                    className="text-[11px] px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                  >
                    ✏️ {lang === 'zh' ? '修改' : 'Edit'}
                  </button>
                  {isUserEdited && (
                    <button
                      onClick={() => resetField(f.id)}
                      className="text-[11px] px-2.5 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-700 font-semibold"
                    >
                      ↺ {lang === 'zh' ? '還原自動值' : 'Reset to auto'}
                    </button>
                  )}
                </div>
              </div>

              {/* Edit panel */}
              {isEditing && (
                <div className="border-t border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase">Value (JSON)</label>
                    <textarea
                      value={JSON.stringify(editDraft.value, null, 2)}
                      onChange={e => {
                        try { setEditDraft({ ...editDraft, value: JSON.parse(e.target.value) }); }
                        catch { /* invalid JSON — keep raw */ }
                      }}
                      rows={6}
                      className="w-full text-[11px] font-mono border border-slate-200 rounded p-2 bg-white"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 uppercase">Status</label>
                      <select
                        value={editDraft.status || 'pending'}
                        onChange={e => setEditDraft({ ...editDraft, status: e.target.value })}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white"
                      >
                        {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                          <option key={k} value={k}>{v.icon} {lang === 'zh' ? v.labelZh : v.labelEn}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 uppercase">Confidence</label>
                      <input
                        type="number" min={0} max={1} step={0.05}
                        value={editDraft.confidence ?? 0.7}
                        onChange={e => setEditDraft({ ...editDraft, confidence: parseFloat(e.target.value) })}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 uppercase">As of</label>
                      <input
                        type="date"
                        value={editDraft.asOf || today}
                        onChange={e => setEditDraft({ ...editDraft, asOf: e.target.value })}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase">Sources (comma-separated)</label>
                    <input
                      type="text"
                      value={(editDraft.sources || []).join(', ')}
                      onChange={e => setEditDraft({ ...editDraft, sources: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                      className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white"
                      placeholder="e.g., HKEXnews 2024 annual report, OFAC SDN list"
                    />
                  </div>
                  <div className="flex gap-2 justify-end pt-1">
                    <button
                      onClick={() => { setEditingField(null); setEditDraft({}); }}
                      className="text-[11px] px-3 py-1 rounded border border-slate-300 text-slate-600"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      className="text-[11px] px-3 py-1 rounded bg-indigo-600 text-white font-bold"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
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
      { id: 'demandList', label: `🎯 ${t.demandListTab}` },
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

       {/* ✅ Adverse Media Tab — v2 only */}
        <div className={detailTab === 'adverseMedia' ? 'pb-2' : 'hidden'}>
          <ScreeningModuleV2
            key={`v2-am-${ent.id}`}
            entityName={ent.name}
            mode="adverseMedia"
            onFlagSTR={(info) => {
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
            }}
          />
        </div>

       <div className={detailTab === 'sanctionScreening' ? 'pb-2' : 'hidden'}>
          <ScreeningModuleV2
            key={`v2-ss-${ent.id}`}
            entityName={ent.name}
            mode="sanction"
            onFlagSTR={(info) => {
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
            }}
          />
        </div>
        
    
        <div className={detailTab === 'demandList' ? 'pb-2' : 'hidden'}>
          <DemandListKYC
            entity={ent}
            entities={entities}
            relationships={relationships}
            findUBOs={findUBOs}
            threshold={settings.uboThreshold}
            calcCRR={calcCRR}
            getEffectiveRating={getEffectiveRating}
            lang={lang}
            t={t}
            today={today}
          />
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
          {view === 'scan' && <BatchScanApp lang={lang} darkMode={darkMode} />}
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

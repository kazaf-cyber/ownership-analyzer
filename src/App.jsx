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
    addEntity: '+ Add Entity', selected: 'selected', clear: 'Clear',
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
    entityName: 'Entity Name',
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
    usingGemini: 'Using GPT 5.5 (via Poe API)',
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
    addEntity: '+ 新增實體', selected: '已選', clear: '清除',
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
    entityName: '實體名稱',
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
    usingGemini: '使用 GPT 5.5（via Poe API）',
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
  'TRUE_HIT': { label: 'True Hit', labelZh: '真實命中', desc: 'The hit is confirmed to be the subject and is associated with negative news related to ML/TF or sanctions', icon: AlertTriangle, bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', badge: 'bg-red-100 text-red-800 border-red-200' },
  'POSSIBLE_HIT': { label: 'Possible Hit', labelZh: '存疑待核實', desc: 'Name matches and content is ML/TF related, with 1-2 partial identifiers corroborating but not fully confirmed', icon: Search, bg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-800 border-purple-200' },
  'PENDING_INFO': { label: 'Pending Info', labelZh: '待補資料', desc: 'Name matches with ML/TF content, but ZERO identifying info provided — CDD must supply identifiers before this can be classified as TRUE/FALSE/POSSIBLE', icon: Loader, bg: 'bg-indigo-50', border: 'border-indigo-300', text: 'text-indigo-700', badge: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  'FALSE_HIT': { label: 'False Hit', labelZh: '誤報', desc: 'Identifiers (DOB / nationality / role / company) clearly contradict the customer — different person/entity', icon: XCircle, bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  'IRRELEVANT_MLTF': { label: 'Irrelevant to ML/TF', labelZh: '無關 ML/TF', desc: 'Identity matches or plausibly matches, but content is NOT within ML/TF scope — reviewed and documented', icon: Info, bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-600', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
  'NO_HIT': { label: 'No Hit', labelZh: '無命中', desc: 'No search keywords found, or the search returned no result, or entity is clearly different', icon: CheckCircle, bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700', badge: 'bg-green-100 text-green-800 border-green-200' }
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

function buildQueryAuto(entityName) {
  const detectedLang = detectLanguage(entityName);
  const keywords = detectedLang === 'zh' ? ZH_KEYWORDS : EN_KEYWORDS;
  const keywordString = keywords.map(k => `"${k}"`).join(' OR ');
  // ★ 新格式：實體名稱在前 + 關鍵字在後（OR 連接，無外層括號）
  const query = `"${entityName}" ${keywordString}`;
  return { query, detectedLang, keywords };
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
/* ========== SANCTION SCREENING MODULE ========== */

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


/* ========== GENERIC SCREENING COMPONENT (shared by Adverse Media & Sanction) ========== */

function ScreeningModule({ entityName: initialEntityName, mode, onFlagSTR }) {
  const isAdverseMedia = mode === 'adverseMedia';
  const isSanction = mode === 'sanction';
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
  const [entityContext, setEntityContext] = useState({   dob: '', nationality: '', gender: '', company: '', idNumber: '', address: '', notes: '' });  const handleExtraChange = (field, value) => {   setEntityContext(prev => ({ ...prev, [field]: value })); };  
  const formatEntityContext = (info) => {
  const parts = [];
  if (info.dob) parts.push(`出生日期 / DOB: ${info.dob}`);
  if (info.nationality) {
    const nat = NATIONALITIES.find(n => n.value === info.nationality);
    parts.push(`國籍 / Nationality: ${nat ? `${nat.en} / ${nat.zh}` : info.nationality}`);
  }
  if (info.gender) {
    const genderMap = { Male: '男 / Male', Female: '女 / Female', Other: '其他 / Other' };
    parts.push(`性別 / Gender: ${genderMap[info.gender] || info.gender}`);
  }
  if (info.company) parts.push(`公司/職稱 / Company/Title: ${info.company}`);
  if (info.idNumber) parts.push(`證件號碼 / ID Number: ${info.idNumber}`);
  if (info.address) parts.push(`地址 / Address: ${info.address}`);
  if (info.notes) parts.push(`其他 / Other: ${info.notes}`);
  return parts.join('\n');
}; 
  const NATIONALITIES = [   { value: 'CN', zh: '中國大陸', en: 'China (Mainland)' },   { value: 'HK', zh: '中國香港', en: 'Hong Kong' },   { value: 'MO', zh: '中國澳門', en: 'Macau' },   { value: 'TW', zh: '中國台灣', en: 'Taiwan' },   { value: 'US', zh: '美國', en: 'United States' },   { value: 'GB', zh: '英國', en: 'United Kingdom' },   { value: 'CA', zh: '加拿大', en: 'Canada' },   { value: 'AU', zh: '澳洲', en: 'Australia' },   { value: 'SG', zh: '新加坡', en: 'Singapore' },   { value: 'MY', zh: '馬來西亞', en: 'Malaysia' },   { value: 'JP', zh: '日本', en: 'Japan' },   { value: 'KR', zh: '韓國', en: 'South Korea' },   { value: 'IN', zh: '印度', en: 'India' },   { value: 'ID', zh: '印尼', en: 'Indonesia' },   { value: 'PH', zh: '菲律賓', en: 'Philippines' },   { value: 'TH', zh: '泰國', en: 'Thailand' },   { value: 'VN', zh: '越南', en: 'Vietnam' },   { value: 'DE', zh: '德國', en: 'Germany' },   { value: 'FR', zh: '法國', en: 'France' },   { value: 'CH', zh: '瑞士', en: 'Switzerland' },   { value: 'NL', zh: '荷蘭', en: 'Netherlands' },   { value: 'RU', zh: '俄羅斯', en: 'Russia' },   { value: 'BR', zh: '巴西', en: 'Brazil' },   { value: 'AE', zh: '阿聯酋', en: 'UAE' },   { value: 'SA', zh: '沙特阿拉伯', en: 'Saudi Arabia' },   { value: 'ZA', zh: '南非', en: 'South Africa' },   { value: 'OTHER', zh: '其他', en: 'Other' }, ];

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
    const data = await callWorker('/api/scrape', { url, maxLength: 3000 });
    return data.text || null;
  } catch { return null; }
};

  const extractUrlsFromPdf = (pdfText) => {
    const urlRegex = /https?:\/\/[^\s)>\]"']+/g;
    const urls = pdfText.match(urlRegex) || [];
    return urls.filter(u =>
      !u.includes('google.com') &&
      !u.includes('googleapis.com') &&
      !u.includes('gstatic.com')
    ).slice(0, 10);
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

  /* ── 生成 AI Prompt（制裁篩查 vs 不良媒體各自不同）── */
    const buildAIPrompt = (searchEntityName, enrichedContent, resultCount, hasPageContent, lang, entityContext, resultUrls = []) => {

   const pdfCleaningNote = `
═══════════════════════════════════════════════════════════
⚠️  PDF CONTENT PARSING RULES — READ CAREFULLY BEFORE PARSING
═══════════════════════════════════════════════════════════

【RULE 1】IGNORE NON-RESULT CONTENT
- Skip "AI Overview" / "AI 概覽" / "AI 模式" sections entirely.
- Skip Google UI: navigation tabs (全部/新聞/圖片/影片/網頁/工具), 
  pagination ("1 2 3 4 5 ... 下一頁", "Goooooogle"), 
  footers ("說明", "私隱權政策", "條款", "正在顯示個人化結果"),
  location info ("香港", "馬鞍山", "根據你的活動記錄"),
  page markers ("第1/2頁", "第2/2頁"),
  URLs at the very bottom (the google.com/search?... URL).

【RULE 2】RECOGNIZE A SEARCH RESULT
Every Google search result has this structure:
  ┌─────────────────────────────────────┐
  │ [Source Name]                       │  ← e.g. "China Daily"
  │ [URL fragment] (e.g. site.com › ...)│  ← short breadcrumb URL
  │ [Title — usually a blue hyperlink]  │  ← e.g. "Sanctions are coming"
  │ [Snippet — 1-3 lines of text]       │  ← description with date/author
  └─────────────────────────────────────┘
Each such block = ONE result. Count them ALL.

【RULE 3】 🚨🚨🚨 SPLIT RESULTS ACROSS PAGE BREAKS 🚨🚨🚨
This is the #1 cause of missed results. READ THIS TWICE.

When a result is split by "--- PAGE BREAK ---", you MUST merge it.

⚠️ DETECTION PATTERN:
  If the LAST item before "--- PAGE BREAK ---" looks like a [Title] 
  (often ending with "...") and has NO snippet after it,
  AND the FIRST line after "--- PAGE BREAK ---" looks like a snippet
  (starts with: "由 X 著作", "AU - ", "by X", "YYYY年M月D日 —", 
   "Updated:", a date pattern, or descriptive prose),
  → They belong to the SAME result. Merge them.

⚠️ CONCRETE EXAMPLE FROM REAL PDF:
  ┌─ Page 1 (ending) ──────────────────────────────────┐
  │ CityUHK Scholars                                    │
  │ https://scholars.cityu.edu.hk › investig...         │
  │ Investigating pedestrian-level greenery in urban... │
  │                                                      │
  │ --- PAGE BREAK ---                                  │
  ├─ Page 2 (starting) ────────────────────────────────┤
  │ 由 J Hua 著作 · 2022 · 被引用 64 次 — We conducted  │
  │ a citywide investigation of urban greenery...       │
  │ AU - Cai, Meng. AU - Shi, Yuan...                  │
  │                                                      │
  │ 中华护理杂志                                          │  ← NEXT result starts here
  │ https://zh.zhhlzzs.com › lexeme › show...           │
  │ 179所三级医院ICU导尿管...                              │
  └─────────────────────────────────────────────────────┘
  
  ✅ CORRECT parsing: 2 results
     #N   = CityUHK Scholars (title + snippet merged across page break)
     #N+1 = 中华护理杂志
  
  ❌ WRONG parsing: 1 result (skipping CityUHK because it "had no snippet")
  ❌ WRONG parsing: merging "由 J Hua..." into 中华护理杂志's snippet

【RULE 4】 🔢 MANDATORY COUNT VERIFICATION
Before producing JSON output, perform this check:
  STEP A: Scan the entire PDF and count distinct result-URL fragments
          (lines matching pattern: "domain.com › path" or "https://...").
          EXCLUDE the google.com/search URL at the bottom.
  STEP B: Your JSON array MUST have the same number of items as STEP A.
  STEP C: If counts differ, RE-SCAN — you missed a split result or 
          mis-grouped two results into one.

【RULE 5】RESULTS WITHOUT VISIBLE SNIPPETS STILL COUNT
Some results may appear with only [Source + URL + Title] and no snippet
(common for the last result on a page, or thin results).
→ Still include them. Set the snippet field to the title or empty string.

【RULE 6】DO NOT FABRICATE
- Never invent results not in the PDF.
- Never duplicate a result to reach a target count.
- If you're unsure whether two blocks are one-or-two results, 
  prefer treating them as TWO (false-positive results are safer 
  than missed results, since classification will filter them).
═══════════════════════════════════════════════════════════
`;


const urlAnchorBlock = resultUrls.length > 0 ? `
═══════════════════════════════════════════════════════════
🎯 PRE-EXTRACTED URL ANCHORS — AUTHORITATIVE GROUND TRUTH
═══════════════════════════════════════════════════════════

The system has automatically scanned the PDF and detected EXACTLY 
${resultUrls.length} unique search result URLs:

${resultUrls.map((u, i) => `  [${String(i+1).padStart(2, '0')}] ${u}`).join('\n')}

🚨🚨🚨 MANDATORY OUTPUT CONTRACT 🚨🚨🚨

  Your JSON array MUST contain EXACTLY ${resultUrls.length} items.
  Each item corresponds to ONE URL above. No more. No less.

  If your output has fewer than ${resultUrls.length} items → WRONG.
  If your output has more  than ${resultUrls.length} items → WRONG.

📖 HOW TO USE THESE ANCHORS

For each URL, locate it in the PDF text, then gather its content:
  • SOURCE NAME → typically 1-2 lines IMMEDIATELY ABOVE the URL
  • TITLE       → typically the line(s) IMMEDIATELY BELOW the URL
                  (often blue, often ends with "...")
  • SNIPPET     → typically the descriptive prose further below the title
                  (may contain dates, authors, "由 X 著作", etc.)

⚠️ TEXT ORDER ANOMALIES (CRITICAL)

PDF text extraction sometimes places content OUT OF VISUAL ORDER:
  • A snippet may appear BEFORE its corresponding title
  • A snippet may appear BEFORE the URL anchor itself
  • Two consecutive snippets may belong to two DIFFERENT results

Strategy: Always trust the URL anchor list above as your skeleton.
Walk OUT from each URL (both up and down) to find its content.

⚠️ SPLIT RESULTS ACROSS PAGE BREAKS

If a URL appears on page 1 but its snippet appears on page 2 
(after "--- PAGE BREAK ---"), they still belong to the SAME result.
Merge them into one JSON item.

⚠️ IF YOU CAN'T FIND CONTENT FOR A URL

Still output the result. Use the URL itself or domain as the source,
and put "(Content not clearly extractable)" in the snippet.
NEVER skip a URL just because its content is hard to parse.

═══════════════════════════════════════════════════════════
` : '';

    const reminderText = `REMINDER: Identify and output ALL distinct search results from the PDF content.

⚠️ EXPECTED COUNT: Approximately ${resultCount} items in TOTAL across ALL PDF pages.
⚠️ A single Google search of 10 results is COMMONLY split across 2 PDF pages — count ALL of them.

CHECKLIST BEFORE OUTPUTTING:
□ Did I count results from page 1 AND page 2 (and beyond if present)?
□ Is my JSON array length close to ${resultCount}?
□ Did I merge any result that was split across "--- PAGE BREAK ---"?

Do NOT skip or merge any result. Each search result = one JSON item.
Start with [ end with ]. Nothing else.`;

    /* ═══════════════════════════════════════════════════════
       ⭐ 共用:3 步驟決策樹 + 5 類分類定義
       ═══════════════════════════════════════════════════════ */
       const decisionTree = `
═══════════════════════════════════════════════════════════
🧭 3-STEP DECISION TREE — APPLY TO EVERY RESULT
═══════════════════════════════════════════════════════════

──────────────────────────────────────────────
STEP 1 — IDENTITY (Is this the TARGET subject?)
──────────────────────────────────────────────

STEP 1A — NAME MATCH (compare names CHARACTER-BY-CHARACTER first)

  🟢 NAME_EXACT     = name matches exactly (or recognised full-vs-abbreviation
                      variant of the SAME person, e.g. "John A. Smith" vs
                      "John Smith"; "陳大文" vs "陳大文 Chan Tai Man")
                      → go to STEP 1B
  🟠 NAME_SIMILAR   = name is SIMILAR but NOT the same person:
                      • shared family name + different given name
                          e.g. "陳大文" vs "陳文"      (missing character)
                          e.g. "陳大文" vs "陳大明"    (different character)
                          e.g. "陳大文" vs "陳大文輝"  (extra character)
                      • different romanisation of likely-different name
                          e.g. "Mary Wong" vs "Mary Wang"
                          e.g. "Li Wei"    vs "Lee Wei"   (only if doc clearly
                                                            refers to different
                                                            individual)
                      • English name partial-match without strong context
                          e.g. "John Smith" search → "Johnny Smithson" result
                      → FALSE_HIT (stop here, do NOT proceed to STEP 2)
  ⚫ DIFFERENT_NAME = completely unrelated name (no shared characters / words)
                      → NO_HIT (stop)

STEP 1B — IDENTITY (only if NAME_EXACT)

  Compare result against KNOWN IDENTIFYING INFORMATION provided.

  🟢 FULL_MATCH     = name + ≥ 2 identifiers match                → go to STEP 2
  🟡 PARTIAL_MATCH  = name + 1 identifier matches, others unknown → go to STEP 2
  🔵 NO_INFO        = name matches, but ZERO identifying info     → go to STEP 2
                       was provided by compliance officer
  🔴 CONTRADICTED   = name matches + identifiers clearly differ   → FALSE_HIT (stop)

──────────────────────────────────────────────
STEP 2 — ADVERSE CONTENT (Any negative information?)
──────────────────────────────────────────────
Adverse signals:
  • Criminal charges / convictions / investigations
  • Regulatory enforcement actions
  • Lawsuits / litigation
  • Media reports of misconduct
  • Sanctions / watchlist mentions
  • Bankruptcy / insolvency
  • PEP exposure with risk indicators

If NO adverse content → STEP 3 = FAIL (move to final mapping)
If YES → go to STEP 3

──────────────────────────────────────────────
STEP 3 — ML/TF SCOPE (Is the adverse content within ML/TF predicate offenses?)
──────────────────────────────────────────────

✅ IN-SCOPE:
  1.  Money Laundering / proceeds of crime
  2.  Terrorist Financing / CFT
  3.  Sanctions violations (OFAC, UN, EU, HKMA, UK OFSI, MAS)
  4.  Sanctions evasion / circumvention / front companies
  5.  Bribery / corruption (FCPA, UKBA, ICAC)
  6.  Tax evasion / tax fraud (CRIMINAL level only)
  7.  Drug trafficking / human trafficking / arms trafficking
  8.  Fraud with criminal prosecution (Ponzi, securities, investment)
  9.  Insider trading / market manipulation
  10. Proliferation financing (WMD-related)
  11. Organized crime (triads, mafia, syndicates)
  12. Cybercrime with financial motive (ransomware, BEC)
  13. Regulatory enforcement by AML authorities (HKMA, MAS, SFC, SEC, FCA, FinCEN)

❌ OUT-OF-SCOPE:
  1.  Civil disputes WITHOUT fraud (contract, IP, defamation)
  2.  Labor / employment disputes (unless forced labor)
  3.  Traffic violations
  4.  Environmental violations (unless deliberate / large-scale)
  5.  Family / personal matters
  6.  Health / accident events
  7.  Trademark / patent / commercial litigation (no fraud)
  8.  Routine consumer complaints / product liability
  9.  Administrative (non-criminal) tax disputes
  10. Entity IMPLEMENTING compliance programmes (positive news)
  11. General regulatory news where entity is NOT a target
  12. Personal lifestyle controversies without legal consequence

═══════════════════════════════════════════════════════════
📋 FINAL CLASSIFICATION MATRIX (6 categories)
═══════════════════════════════════════════════════════════

┌──────────────────────┬─────────────────────────┬─────────────────────────┐
│  STEP 1 Identity     │  STEP 2/3 = ML/TF FOUND │  STEP 2/3 = NO ML/TF    │
├──────────────────────┼─────────────────────────┼─────────────────────────┤
│ DIFFERENT_NAME       │  NO_HIT                 │  NO_HIT                 │
│ NAME_SIMILAR 🆕      │  FALSE_HIT              │  FALSE_HIT              │
│ CONTRADICTED         │  FALSE_HIT              │  FALSE_HIT              │
│ NO_INFO              │  🆕 PENDING_INFO        │  IRRELEVANT_MLTF        │
│ PARTIAL_MATCH        │  POSSIBLE_HIT           │  IRRELEVANT_MLTF        │
│ FULL_MATCH           │  TRUE_HIT               │  IRRELEVANT_MLTF        │
└──────────────────────┴─────────────────────────┴─────────────────────────┘

🚨 CRITICAL — DO NOT CONFUSE THESE STATES:
  • NAME_SIMILAR  = name is CLOSE BUT NOT THE SAME PERSON
                    → Always FALSE_HIT (regardless of content).
                      Examples:
                        "陳大文" (search) vs "陳文" (result)    → FALSE_HIT
                        "陳大文" (search) vs "陳大明" (result)  → FALSE_HIT
                        "Mary Wong"       vs "Mary Wang"        → FALSE_HIT
                        "Li Wei"          vs "Lee Wei"          → FALSE_HIT
                                                                  (unless clearly
                                                                   same person)
  • PENDING_INFO  = name match (NAME_EXACT) + ML/TF content + ZERO identifiers
                    → "Cannot determine yet, CDD must supply identifiers"
  • POSSIBLE_HIT  = name match (NAME_EXACT) + ML/TF content + 1-2 identifiers partial
                    → "Probable hit, needs minor corroboration"
  • TRUE_HIT      = name match (NAME_EXACT) + ML/TF content + ≥ 2 identifiers full
                    → "Confirmed hit"

⚠️ ANTI-FALSE-POSITIVE RULES:
  1. A keyword match alone is NEVER sufficient for TRUE_HIT.
  2. Name must match EXACTLY (character-by-character for Chinese, word-by-word
     for English). Any character / word difference that suggests a different
     person → NAME_SIMILAR → FALSE_HIT.
  3. "sued for breach of contract" = IRRELEVANT_MLTF, even if "fraud" appears nearby.
  4. "under investigation" = TRUE_HIT only if by law enforcement/regulators for ML/TF.
  5. Entity IMPLEMENTING sanctions/AML compliance ≠ TRUE_HIT.
  6. Chinese names have extremely high duplication — name-only match is NEVER enough
     for TRUE_HIT. Always require corroborating identifiers.
  7. When NO KNOWN INFO is provided and ML/TF content exists (with NAME_EXACT) →
     MUST be PENDING_INFO (not TRUE_HIT).
  8. When in doubt between TRUE_HIT and IRRELEVANT_MLTF → IRRELEVANT_MLTF.
  9. When in doubt between POSSIBLE_HIT and FALSE_HIT → POSSIBLE_HIT.
 10. When in doubt between NAME_EXACT and NAME_SIMILAR → NAME_SIMILAR (safer).
`;

    /* ═══════════════════════════════════════════════════════
       ⭐ JSON 輸出格式(統一,修正逗號 bug)
       ═══════════════════════════════════════════════════════ */
        const outputFormat = `
═══════════════════════════════════════════════════════════
📤 RESPONSE FORMAT — JSON ARRAY ONLY, NO OTHER TEXT
═══════════════════════════════════════════════════════════
[
  {
    "rank": 1,
    "title": "Exact article title",
    "source": "publication name",
    "date": "YYYY-MM-DD",
    "snippet": "Verbatim 2-3 sentence excerpt",
    "matchedKeywords": ["only keywords used in ML/TF context"],
    "cls": "TRUE_HIT",
    "identityMatch": "FULL_MATCH",
    "nameInResult": "exact name string as it appears in the result",
    "confidence": 0.92,
    "reason": "Fluent natural paragraph (2-4 sentences) explaining: (a) name comparison, (b) identity assessment, (c) adverse content assessment, (d) ML/TF scope assessment. Do NOT use 'STEP 1/2/3' labels.",
    "riskCat": "${isSanction ? 'OFAC SDN / EU Sanctions / UN Sanctions / Sanctions Evasion / Asset Freeze / Proliferation / N/A' : 'Money Laundering / Sanctions Evasion / Bribery / Tax Evasion (Criminal) / Terrorist Financing / Fraud (Criminal) / Regulatory Action / N/A'}",
    "missingInfo": ["DOB", "nationality", "role / position", "company"]
  }
]

FIELD GUIDELINES:
  • cls: one of "TRUE_HIT" | "POSSIBLE_HIT" | "PENDING_INFO" | "FALSE_HIT" | "IRRELEVANT_MLTF" | "NO_HIT"

  • identityMatch: REQUIRED. One of:
      - "FULL_MATCH"     = NAME_EXACT + ≥ 2 KNOWN INFO identifiers independently match
      - "PARTIAL_MATCH"  = NAME_EXACT + 1 identifier matches, others unknown
      - "NO_INFO"        = NAME_EXACT + NO KNOWN INFO was provided
      - "CONTRADICTED"   = NAME_EXACT + KNOWN INFO clearly differs
      - "NAME_SIMILAR"   = 🆕 name is similar but NOT exact (likely different person)
      - "DIFFERENT_NAME" = name does not match at all

  • nameInResult: REQUIRED. The exact name string as it appears in the search result
                  (snippet/title). This proves you compared character-by-character.
                  Example: search="陳大文", nameInResult="陳文" → identityMatch=NAME_SIMILAR

  • missingInfo: REQUIRED when cls = "PENDING_INFO" or "POSSIBLE_HIT".
      Suggest specific identifiers that CDD should supply, e.g.:
      ["DOB / age", "nationality", "role / position", "company affiliation", "jurisdiction"]
      Use empty array [] for all other cls.

  • confidence calibration:
      - TRUE_HIT:        0.80 - 1.00 (must be ≥ 0.75 or auto-downgraded)
      - POSSIBLE_HIT:    0.50 - 0.79
      - PENDING_INFO:    0.40 - 0.65
      - FALSE_HIT:       0.70 - 0.95 (confidence it is NOT the customer)
      - IRRELEVANT_MLTF: 0.30 - 0.60
      - NO_HIT:          0.00 - 0.30
`;

    /* ═══════════════════════════════════════════════════════
       ⭐ 已知身份背景(disambiguation 用)
       ═══════════════════════════════════════════════════════ */
       const identityBlock = entityContext && Object.values(entityContext).some(v => v) ? `
═══════════════════════════════════════════
🪪 KNOWN IDENTIFYING INFORMATION (provided by compliance officer):
═══════════════════════════════════════════
${formatEntityContext(entityContext)}

⚠️ CRITICAL USE OF THIS DATA — APPLY STEP 1 RIGOROUSLY:

  STEP 1A first: Compare the name in the result CHARACTER-BY-CHARACTER
                 against "${searchEntityName}".
    • If similar but NOT exact (e.g. "陳大文" search → "陳文" result)
      → identityMatch = "NAME_SIMILAR" → FALSE_HIT (stop, do not check identifiers)
    • If completely different
      → identityMatch = "DIFFERENT_NAME" → NO_HIT
    • If exact / recognised variant
      → proceed to STEP 1B

  STEP 1B: Only if name is exact, then compare identifiers:
    • Identifiers contradict (different age, profession, jurisdiction, company)
      → identityMatch = "CONTRADICTED" → FALSE_HIT
    • 1 identifier matches, others unknown
      → identityMatch = "PARTIAL_MATCH" → POSSIBLE_HIT (if ML/TF) or IRRELEVANT_MLTF
    • ≥ 2 identifiers match
      → identityMatch = "FULL_MATCH" → TRUE_HIT (if ML/TF) or IRRELEVANT_MLTF
` : `
═══════════════════════════════════════════
⚠️ NO KNOWN IDENTIFYING INFORMATION PROVIDED
═══════════════════════════════════════════

  🚨 THIS IS A CRITICAL CONSTRAINT — READ CAREFULLY:

  The compliance officer did NOT provide any identifying details (DOB, nationality,
  role, company, ID number, address). This means you CANNOT verify whether a result
  is the actual customer or a DIFFERENT person with the same name.

  BUT YOU MUST STILL APPLY STEP 1A RIGOROUSLY:

  Compare the name in the result CHARACTER-BY-CHARACTER against "${searchEntityName}".

    • If name is similar but NOT exact (e.g. "陳大文" vs "陳文", "陳大明")
      → identityMatch = "NAME_SIMILAR" → FALSE_HIT
      (This rule applies REGARDLESS of whether KNOWN INFO is provided.
       A different name is a different person, full stop.)

    • If completely different
      → identityMatch = "DIFFERENT_NAME" → NO_HIT

    • If exact / recognised variant
      → identityMatch = "NO_INFO" (cannot verify further) → proceed to STEP 2

  Chinese personal names ESPECIALLY have extremely high duplication rates
  (e.g. "陳志明", "李偉明", "王小明" — thousands of holders each).

  MANDATORY CLASSIFICATION RULES IN THIS SCENARIO (only for NAME_EXACT):

  ┌────────────────────────────────┬──────────────────────────────┐
  │  Result has ML/TF content      │  Result has NO ML/TF content │
  ├────────────────────────────────┼──────────────────────────────┤
  │  → identityMatch = "NO_INFO"   │  → identityMatch = "NO_INFO" │
  │  → cls = "PENDING_INFO"        │  → cls = "IRRELEVANT_MLTF"   │
  │  → confidence ≤ 0.65           │  → confidence ≤ 0.55         │
  │  → missingInfo MUST list       │  → missingInfo = []          │
  │     specific identifiers       │                              │
  │     needed (DOB, role, etc.)   │                              │
  └────────────────────────────────┴──────────────────────────────┘

  🚫 ABSOLUTELY FORBIDDEN in this scenario:
    • Do NOT classify as TRUE_HIT (impossible without identifier verification)
    • Do NOT classify as POSSIBLE_HIT (reserved for PARTIAL_MATCH only)

  ✅ The ONLY valid classifications with no KNOWN INFO are:
     PENDING_INFO, IRRELEVANT_MLTF, NO_HIT, FALSE_HIT (only via NAME_SIMILAR)
`;

    /* ═══════════════════════════════════════════════════════
       ⭐ Sanction vs Adverse Media — 共用主體 + 微調差異
       ═══════════════════════════════════════════════════════ */
    const taskLine = isSanction
      ? `TASK: Analyze each Google search result and classify whether the entity is on any sanctions list or involved in sanctions-related violations.`
      : `TASK: Analyze each Google search result and classify it using the 3-step decision tree below.`;

    const moduleSpecificScopeNote = isSanction ? `
⚠️ SANCTION-SCREENING SPECIFIC NOTES:
  • Primary in-scope categories: OFAC SDN, UN, EU, UK OFSI, HKMA, MAS sanctions lists.
  • Also in-scope: sanctions evasion, asset freezes, travel bans, arms embargoes, secondary sanctions, proliferation financing.
  • An entity IMPLEMENTING sanctions compliance is NOT a TRUE_HIT.
  • "sanctions" appearing in general regulatory context (where entity is not the target) ≠ TRUE_HIT.
` : `
⚠️ ADVERSE-MEDIA SPECIFIC NOTES:
  • Focus on ML/TF predicate offences and AML-relevant regulatory actions.
  • Sanctions findings ARE in-scope here too (treat as TRUE_HIT under "Sanctions Evasion" category).
`;

    /* ═══════════════════════════════════════════════════════
       ⭐ Page Content / Snippet 來源說明
       ═══════════════════════════════════════════════════════ */
    const dataSourceNote = hasPageContent ? `
YOU HAVE TWO DATA SOURCES:
1. Google search result snippets (from PDF)
2. Full page content of each result (appended below, marked with "--- PAGE CONTENT: [url] ---")

⚠️ Base your classification PRIMARILY on the full page content when available.
   A snippet alone is NEVER sufficient evidence for TRUE_HIT — verify with full content.
` : `
⚠️ NOTE: Only Google search snippets are available (no full page content was scraped).
   Be CONSERVATIVE — if a snippet is ambiguous, classify as IRRELEVANT_MLTF or POSSIBLE_HIT 
   rather than TRUE_HIT.
`;

    /* ═══════════════════════════════════════════════════════
       ⭐ 組裝最終 Prompt
       ═══════════════════════════════════════════════════════ */
    return `You are a senior compliance analyst performing ${isSanction ? 'Sanctions List Screening' : 'Adverse Media Screening'} for KYC/AML purposes.

${taskLine}

═══════════════════════════════════════════
ENTITY UNDER SCREENING: "${searchEntityName}"
═══════════════════════════════════════════
${identityBlock}
${urlAnchorBlock} 
${pdfCleaningNote}
${dataSourceNote}
${moduleSpecificScopeNote}
${decisionTree}
${outputFormat}

Analyze ALL search results from this PDF. ${reminderText}

Content:
${enrichedContent.slice(0, 80000)}

${reminderText}`;
  };


   const buildSystemPrompt = () => {
    const moduleName = isSanction ? 'Sanctions List Screening' : 'Adverse Media Screening';
    const moduleFocus = isSanction
      ? 'identifying entities that are designated on sanctions lists (OFAC SDN, UN, EU, UK OFSI, HKMA, MAS), subject to asset freezes, involved in sanctions evasion / circumvention / front-company arrangements, or otherwise within the scope of sanctions enforcement'
      : 'identifying entities involved in money laundering, terrorist financing, predicate offences (bribery, fraud, tax evasion, drug/human/arms trafficking), or AML-relevant regulatory enforcement actions';
    const scopeWord = isSanction ? 'sanctions' : 'ML/TF';
    const scopeViolation = isSanction ? 'sanctions violations' : 'ML/TF predicate offences';

    const pdfParsingNote = `
PDF PARSING DISCIPLINE
======================
You are analyzing text extracted from a Google Search results PDF. Apply these parsing rules STRICTLY:

1. IGNORE "AI Overview" / "AI 概覽" sections - these are Google's auto-generated summaries, NOT search results.
2. IGNORE Google UI noise: navigation bars, "顯示更多" / "Show more", "翻譯這個網頁" / "Translate this page", pagination, footer.
3. A single Google search of 10 results is OFTEN split across 2+ PDF pages. "--- PAGE BREAK ---" markers indicate paper boundaries, NOT a new search. PROCESS ALL PAGES.
4. If the PDF contains TWO DIFFERENT searches (one quoted with 0 results + one unquoted with results), analyze only the unquoted search.
5. Each real search result has: Source name, URL, Title, Snippet (1-2 lines). LinkedIn, Facebook, HKEXnews PDFs are ALL valid results.
6. If a single result is split across "--- PAGE BREAK ---" (title on page 1, snippet on page 2), merge into ONE result.
7. Process EVERY distinct search result. Do not skip, do not merge unrelated items.
`;

    return `
ROLE AND MISSION
================
You are a senior KYC/AML compliance analyst AI specialising in ${moduleName}.

Your mission: ${moduleFocus}, while MINIMIZING false positives.

You serve a Hong Kong bank's CDD/EDD review process. Your output is reviewed by AML advisory and feeds into Suspicious Transaction Reporting decisions. Inaccurate classifications create real downstream cost:
  - False positives waste analyst time and create unnecessary customer friction.
  - False negatives create regulatory risk and potential ML/TF exposure.

OUTPUT CONTRACT (NON-NEGOTIABLE)
================================
1. Output ONLY a valid JSON array. Nothing else - no greeting, no commentary, no explanation outside the JSON.
2. Do NOT wrap in markdown code fences.
3. Start with [ and end with ]. Period.
4. Every distinct search result in the PDF must produce EXACTLY ONE JSON item (do not skip, do not merge unrelated results).
5. Use the exact field names and enum values specified in the user prompt's RESPONSE FORMAT section.
6. If you cannot identify any results, return an empty array [] - never invent results.

CLASSIFICATION DISCIPLINE (3-STEP DECISION TREE)
================================================
Apply this discipline to EVERY result, in this exact order:

  STEP 1 -> SUBJECT MATCH      (Is this the target entity?)
  STEP 2 -> ADVERSE CONTENT    (Any negative information?)
  STEP 3 -> ML/TF SCOPE        (Is it within ${scopeWord} scope?)

Decision summary (apply LITERALLY):
  - Completely different name (no shared chars/words)                -> NO_HIT
  - Name SIMILAR but NOT exact (e.g. 陳大文 vs 陳文, 陳大文 vs 陳大明,
    Mary Wong vs Mary Wang) — likely different person                -> FALSE_HIT
  - Name EXACT + KNOWN INFO contradicts (different person)           -> FALSE_HIT
  - Name EXACT + No KNOWN INFO + ML/TF content                       -> PENDING_INFO + missingInfo
  - Name EXACT + No KNOWN INFO + NO ML/TF content                    -> IRRELEVANT_MLTF
  - Name EXACT + PARTIAL KNOWN INFO match + ML/TF content            -> POSSIBLE_HIT + missingInfo
  - Name EXACT + PARTIAL KNOWN INFO match + NO ML/TF content         -> IRRELEVANT_MLTF
  - Name EXACT + FULL KNOWN INFO match + ML/TF content within scope  -> TRUE_HIT
  - Name EXACT + FULL KNOWN INFO match + NO ML/TF (or out of scope)  -> IRRELEVANT_MLTF
  - Entity not mentioned / no meaningful content                     -> NO_HIT

⚠️ HARD RULE 1: Name comparison is CHARACTER-BY-CHARACTER for Chinese names and
   WORD-BY-WORD for English names. Any difference suggesting a different individual
   → NAME_SIMILAR → FALSE_HIT.

⚠️ HARD RULE 2: TRUE_HIT and POSSIBLE_HIT require NAME_EXACT + at least 1 KNOWN INFO
   identifier to corroborate. If no KNOWN INFO was provided, the maximum
   classification for a NAME_EXACT + ML/TF result is PENDING_INFO.

⚠️ HARD RULE 3: NAME_SIMILAR ALWAYS overrides content — even if the article
   discusses serious ML/TF activity, a similar-but-different name means it is
   NOT the screened customer. Classify as FALSE_HIT.

ANTI-FALSE-POSITIVE PRINCIPLES
==============================
1. ACCURACY OVER QUANTITY. A wrongly assigned TRUE_HIT is worse than missing one.
2. A keyword match alone is NEVER sufficient for TRUE_HIT. The keyword must describe the screened entity's DIRECT involvement in ${scopeViolation}.
3. Chinese personal names have extremely high duplication rates. Name-only match is NEVER sufficient for TRUE_HIT.
4. An entity IMPLEMENTING compliance / sanctions / AML programmes is NOT a TRUE_HIT (positive news).
5. General regulatory news where the entity is not the target is NOT a TRUE_HIT.
6. Civil disputes, contract breaches, employment disputes, IP litigation are NOT ML/TF.
7. "Under investigation" qualifies as TRUE_HIT ONLY if the investigator is a law enforcement body or financial regulator (HKMA, SFC, MAS, SEC, FCA, FinCEN, ICAC, OFAC, etc.) AND the predicate is ML/TF-related.
8. When uncertain between TRUE_HIT and IRRELEVANT_MLTF -> choose IRRELEVANT_MLTF and lower confidence.
9. When uncertain between TRUE_HIT and FALSE_HIT -> choose POSSIBLE_HIT and populate missingInfo.

CONFIDENCE CALIBRATION
======================
  0.90 - 1.00 : Direct authoritative source (official sanctions designation, court conviction, regulator enforcement order with named entity)
  0.75 - 0.89 : Mainstream media reporting + named regulator/investigator + specific allegations + matching identifiers
  0.60 - 0.74 : Single-source media report OR partial identifier corroboration OR allegations without formal charges
  0.40 - 0.59 : Weak evidence, ambiguous identity, or peripheral mention
  Below 0.40  : Insufficient evidence - classify conservatively as NO_HIT or IRRELEVANT_MLTF

HARD RULE 1: TRUE_HIT requires confidence >= 0.75. Below 0.75, MUST downgrade to POSSIBLE_HIT or IRRELEVANT_MLTF.
HARD RULE 2: TRUE_HIT requires at least one matched keyword in ML/TF context. Empty matchedKeywords array means it cannot be TRUE_HIT.

IDENTITY DISAMBIGUATION
=======================
If the user prompt provides "KNOWN IDENTIFYING INFORMATION" about the subject:
  - Treat this as ground truth about the actual person/entity being screened.
  - If a search result's identifiers CONTRADICT the known info -> FALSE_HIT.
  - If a search result has NO identifiers to confirm or deny -> POSSIBLE_HIT.
  - TRUE_HIT requires at least ONE identifier in the result to corroborate the known info.

If NO identifying information is provided:
  - Be especially conservative with common names (especially Chinese names).
  - A name-only match with ML/TF content -> POSSIBLE_HIT (not TRUE_HIT).
  - Populate missingInfo to flag what the compliance officer should provide.

${pdfParsingNote}

FINAL REMINDER
==============
You are a precision instrument, not a coverage maximizer. Conservative, defensible classifications protect both the bank and the customer.
`.trim();
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

      /* ★ 修正 1：用座標還原換行，不再用 .join(' ')；頁數上限提升到 5 */
      for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
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
        pdfText += pageText + '\n\n--- PAGE BREAK ---\n\n';
      }

      if (!pdfText.trim()) throw new Error('PDF 無法提取文字（可能是掃描圖片格式）');

      /* ★ 修正 2：清理 Google PDF 噪音（AI 概覽、UI 元素、引號搜尋等） */
      /* ★ 修正 2:清理 Google PDF 噪音(AI 概覽、UI 元素、引號搜尋等) */
pdfText = cleanGooglePdfText(pdfText);

/* ★ 修正 2.5:Pre-extract URL anchors as ground truth */
const urlAnchorPattern = /https?:\/\/[^\s)>\]"'›]+/g;
const allUrlsRaw = pdfText.match(urlAnchorPattern) || [];
const resultUrls = [...new Set(
  allUrlsRaw
    .map(u => u.replace(/[.,;:!?)\]>'"]+$/, ''))
    .filter(u =>
      !u.includes('google.com/search') &&
      !u.includes('googleapis.com') &&
      !u.includes('gstatic.com') &&
      !u.includes('accounts.google') &&
      !u.includes('schema.org') &&
      !u.includes('translate.google') &&
      !u.includes('support.google') &&
      !u.includes('policies.google') &&
      u.length > 15
    )
)];

console.log(`🔗 Pre-extracted ${resultUrls.length} URL anchors:`, resultUrls);

let enrichedContent = pdfText;
let scrapedCount = 0;
{
  setProgress(30); setStage('正在抓取搜尋結果網頁內容...');
  const urls = extractUrlsFromPdf(pdfText);
  if (urls.length > 0) {
    const pageResults = await Promise.allSettled(urls.map(url => fetchPageContent(url)));
    const enrichments = urls.map((url, i) => {
      const result = pageResults[i];
      const text = result.status === 'fulfilled' ? result.value : null;
      if (text) scrapedCount++;
      return text ? `\n--- PAGE CONTENT: ${url} ---\n${text}\n--- END ---` : '';
    }).filter(Boolean).join('\n');
    if (enrichments) enrichedContent = pdfText + '\n\n=== FULL PAGE CONTENTS ===\n' + enrichments;
  }
}

setProgress(45); setStage('Poe AI 分析中...');

/* ★ 用真實的 resultUrls 數量,移除舊的 externalUrlCount 計算 */
const resultCount = resultUrls.length > 0 ? resultUrls.length : 10;

const hasPageContent = scrapedCount > 0;

/* ★ 必須傳入 resultUrls 作為第 7 個參數 */
const fullPrompt = buildAIPrompt(searchEntity, enrichedContent, resultCount, hasPageContent, lang, entityContext, resultUrls);

      const res = await fetch('https://api.poe.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({
          model: 'gpt-5.5',
          messages: [
            { role: 'system', content: buildSystemPrompt() },
            { role: 'user', content: fullPrompt }
          ],
          temperature: 0.05,
          max_tokens: 16384
        })
      });

      setProgress(80); setStage('正在解析 AI 回應...');
      if (!res.ok) { const errData = await res.json().catch(() => ({})); throw new Error(errData?.error?.message || `HTTP ${res.status}`); }
      const data = await res.json();
      const rawText = data?.choices?.[0]?.message?.content || '[]';
      let parsed;
      try { const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim(); parsed = JSON.parse(cleaned); }
      catch {
        try {
          const firstBracket = rawText.indexOf('['); const lastBracket = rawText.lastIndexOf(']');
          if (firstBracket === -1 || lastBracket === -1 || lastBracket < firstBracket) throw new Error('no array found');
          parsed = JSON.parse(rawText.slice(firstBracket, lastBracket + 1));
        } catch { throw new Error(`AI 回應格式錯誤。實際回傳：${rawText ? rawText.slice(0, 200) : '(empty)'}`); }
      }
      if (!Array.isArray(parsed) || parsed.length === 0) {
        parsed = [{ rank: 1, title: lang === 'zh' ? '無分析結果' : 'No results', source: '', date: '', snippet: lang === 'zh' ? 'AI未返回有效結果。' : 'AI returned no valid results.', matchedKeywords: [], cls: 'NO_HIT', confidence: 1.0, reason: lang === 'zh' ? '返回空結果。' : 'Returned empty results.', riskCat: 'N/A' }];
      }
      const VALID_CLS = ['TRUE_HIT', 'POSSIBLE_HIT', 'PENDING_INFO', 'FALSE_HIT', 'IRRELEVANT_MLTF', 'NO_HIT'];
            parsed = parsed.map((r, i) => ({
        ...r,
        rank: i + 1,
        cls: VALID_CLS.includes(r.cls) ? r.cls : 'NO_HIT',
        identityMatch: ['FULL_MATCH', 'PARTIAL_MATCH', 'NO_INFO', 'CONTRADICTED', 'NAME_SIMILAR', 'DIFFERENT_NAME'].includes(r.identityMatch) ? r.identityMatch : 'NO_INFO',
        nameInResult: r.nameInResult || '',
        confidence: typeof r.confidence === 'number' ? Math.round(Math.min(1, Math.max(0, r.confidence)) * 100) / 100 : 0.8,
        matchedKeywords: Array.isArray(r.matchedKeywords) ? r.matchedKeywords.slice(0, 5) : [],
        missingInfo: Array.isArray(r.missingInfo) ? r.missingInfo.slice(0, 8) : [],
        title: r.title || '',
        source: r.source || '',
        date: r.date || '',
        snippet: r.snippet || '',
        reason: r.reason || '',
        riskCat: r.riskCat || 'N/A'
      }));

      // ═══════════════════════════════════════════════════════
      // POST-PROCESSING SAFETY NET
      // ═══════════════════════════════════════════════════════
      const hasKnownInfo = entityContext && Object.values(entityContext).some(v => v && String(v).trim() !== '');

      parsed = parsed.map(r => {
        const hasMLTF = r.matchedKeywords && r.matchedKeywords.length > 0;

        // 🛡️ Rule 1: TRUE_HIT confidence < 0.75 → downgrade to IRRELEVANT_MLTF
        if (r.cls === 'TRUE_HIT' && r.confidence < 0.75) {
          return { ...r, cls: 'IRRELEVANT_MLTF', reason: `[Auto-downgraded: confidence ${r.confidence} < 0.75] ${r.reason}`, riskCat: 'N/A (Low Confidence)' };
        }

        // 🛡️ Rule 2: TRUE_HIT with empty matchedKeywords → downgrade to IRRELEVANT_MLTF
        if (r.cls === 'TRUE_HIT' && r.matchedKeywords.length === 0) {
          return { ...r, cls: 'IRRELEVANT_MLTF', reason: `[Auto-downgraded: no matched keywords] ${r.reason}`, riskCat: 'N/A (No Keywords)' };
        }

        // 🛡️ Rule 3 🆕: identityMatch=NAME_SIMILAR → ALWAYS FALSE_HIT
        //    (regardless of cls AI assigned — name is the strongest signal)
        if (r.identityMatch === 'NAME_SIMILAR' && r.cls !== 'FALSE_HIT' && r.cls !== 'NO_HIT') {
          return {
            ...r,
            cls: 'FALSE_HIT',
            confidence: Math.max(r.confidence || 0.7, 0.80),
            riskCat: 'N/A (Different Person)',
            reason: `[Auto-corrected: name "${r.nameInResult || 'in result'}" is similar but NOT exact to "${searchEntity}" — different individual.] ${r.reason}`
          };
        }

        // 🛡️ Rule 4: No KNOWN INFO + NAME_EXACT + ML/TF content
        //           → MUST be PENDING_INFO (block TRUE_HIT/POSSIBLE_HIT upgrades)
        if (
          !hasKnownInfo &&
          (r.identityMatch === 'NO_INFO' || r.identityMatch === 'PARTIAL_MATCH' || r.identityMatch === 'FULL_MATCH') &&
          hasMLTF &&
          (r.cls === 'TRUE_HIT' || r.cls === 'POSSIBLE_HIT')
        ) {
          const defaultMissing = ['DOB / age', 'nationality', 'role / position', 'company affiliation', 'jurisdiction'];
          return {
            ...r,
            cls: 'PENDING_INFO',
            identityMatch: 'NO_INFO',
            confidence: Math.min(r.confidence || 0.5, 0.60),
            missingInfo: r.missingInfo && r.missingInfo.length > 0 ? r.missingInfo : defaultMissing,
            reason: `[Auto-downgraded: no KNOWN INFO provided — identity cannot be confirmed; awaiting CDD identifiers.] ${r.reason}`
          };
        }

        // 🛡️ Rule 5: identityMatch=CONTRADICTED → force FALSE_HIT
        if (r.identityMatch === 'CONTRADICTED' && r.cls !== 'FALSE_HIT' && r.cls !== 'NO_HIT') {
          return {
            ...r,
            cls: 'FALSE_HIT',
            confidence: Math.max(r.confidence || 0.7, 0.75),
            reason: `[Auto-corrected: KNOWN INFO contradicts — different person.] ${r.reason}`
          };
        }

        // 🛡️ Rule 6: identityMatch=FULL/PARTIAL + NO ML/TF + cls=NO_HIT
        //           → upgrade to IRRELEVANT_MLTF (audit trail)
        if (
          (r.identityMatch === 'FULL_MATCH' || r.identityMatch === 'PARTIAL_MATCH') &&
          !hasMLTF &&
          r.cls === 'NO_HIT'
        ) {
          return {
            ...r,
            cls: 'IRRELEVANT_MLTF',
            confidence: Math.min(r.confidence || 0.5, 0.50),
            reason: `[Auto-upgraded: identity matches KNOWN INFO but content is non-ML/TF — documented as reviewed.] ${r.reason}`
          };
        }

        return r;
      });

      setProgress(100);
      timerIdsRef.current.push(setTimeout(() => { setIsAnalyzing(false); setAnalysisComplete(true); setResults(parsed); }, 300));
    } catch (err) { setIsAnalyzing(false); setProgress(0); setStage(''); setErrorMsg(`分析失敗：${err.message}`); }
  };
    
  const counts = useMemo(() => {
    const c = { TRUE_HIT: 0, POSSIBLE_HIT: 0, PENDING_INFO: 0, FALSE_HIT: 0, IRRELEVANT_MLTF: 0, NO_HIT: 0 };
    results.forEach(r => { if (c[r.cls] !== undefined) c[r.cls]++; });
    return c;
  }, [results]);

  const filteredResults = useMemo(() => filterType === 'ALL' ? results : results.filter(r => r.cls === filterType), [results, filterType]);
    const summaryText = useMemo(() => {
    if (!results.length) return '';
    const clsLabel = (cls) => CLS_CONFIG[cls]?.label || cls;
    return results.map((r, i) =>
      `${i + 1}. ${clsLabel(r.cls)}: ${r.reason}`
    ).join('\n');
  }, [results]);
   const updateResultCls = (rank, newCls, note) => {
    setResults(prev => prev.map(r =>
      r.rank === rank
        ? {
            ...r,
            cls: newCls,
            reason: `[Manual] ${note} | Original(${r.cls}): ${r.reason}`,
            _manualOverride: true,
          }
        : r
    ));
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
    const c = CLS_CONFIG[r.cls] || CLS_CONFIG['NO_HIT'];
    const Icon = c.icon;
    const isOpen = expandedId === r.rank;
    
    // 邊框與陰影顏色 mapping
    const accentColor = {
      TRUE_HIT: { 
        border: 'border-red-200', 
        ring: 'hover:ring-red-200',
        leftBar: 'bg-gradient-to-b from-red-500 to-rose-600',
        rankBg: 'bg-gradient-to-br from-red-100 to-rose-200 text-red-700',
      },
      POSSIBLE_HIT: { 
        border: 'border-purple-200', 
        ring: 'hover:ring-purple-200',
        leftBar: 'bg-gradient-to-b from-purple-500 to-violet-600',
        rankBg: 'bg-gradient-to-br from-purple-100 to-violet-200 text-purple-700',
      },
      PENDING_INFO: { 
        border: 'border-indigo-200', 
        ring: 'hover:ring-indigo-200',
        leftBar: 'bg-gradient-to-b from-indigo-500 to-blue-600',
        rankBg: 'bg-gradient-to-br from-indigo-100 to-blue-200 text-indigo-700',
      },
      FALSE_HIT: { 
        border: 'border-amber-200', 
        ring: 'hover:ring-amber-200',
        leftBar: 'bg-gradient-to-b from-amber-500 to-orange-600',
        rankBg: 'bg-gradient-to-br from-amber-100 to-orange-200 text-amber-700',
      },
      IRRELEVANT_MLTF: { 
        border: 'border-slate-200', 
        ring: 'hover:ring-slate-200',
        leftBar: 'bg-gradient-to-b from-slate-400 to-slate-500',
        rankBg: 'bg-gradient-to-br from-slate-100 to-slate-200 text-slate-700',
      },
      NO_HIT: { 
        border: 'border-emerald-200', 
        ring: 'hover:ring-emerald-200',
        leftBar: 'bg-gradient-to-b from-emerald-500 to-teal-600',
        rankBg: 'bg-gradient-to-br from-emerald-100 to-teal-200 text-emerald-700',
      },
    }[r.cls] || {};

    return (
      <div className={`relative bg-white border ${accentColor.border} rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(15,23,42,0.04)] hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)] transition-all hover:-translate-y-0.5`}>
        {/* Left accent bar */}
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentColor.leftBar}`} />
        
        <div 
          className="p-4 pl-5 cursor-pointer flex items-start gap-3" 
          onClick={() => setExpandedId(isOpen ? null : r.rank)}
        >
          {/* Rank + Icon Column */}
          <div className="flex flex-col items-center gap-1.5 shrink-0">
            <span className={`text-xs font-black w-7 h-7 rounded-xl ${accentColor.rankBg} flex items-center justify-center shadow-sm`}>
              {r.rank}
            </span>
            <div className={`w-7 h-7 rounded-lg ${c.bg} flex items-center justify-center`}>
              <Icon className={`w-4 h-4 ${c.text}`} strokeWidth={2.2} />
            </div>
          </div>
          
          {/* Content Column */}
          <div className="flex-1 min-w-0">
            {/* Meta Row */}
            <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${c.badge}`}>
                {detectedLang === 'zh' ? c.labelZh : c.label}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md font-bold">
                <span className={`w-1 h-1 rounded-full ${
                  r.confidence >= 0.9 ? 'bg-emerald-500' :
                  r.confidence >= 0.75 ? 'bg-amber-500' : 'bg-red-500'
                }`} />
                {Math.round(r.confidence * 100)}%
              </span>
              <span className="text-[11px] text-slate-600 font-semibold">{r.source}</span>
              <span className="text-[10px] text-slate-400">·</span>
              <span className="text-[10px] text-slate-400 font-mono">{r.date}</span>
              {r._manualOverride && (
                <span className="inline-flex items-center gap-1 text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-md font-bold">
                  ✏️ Manual
                </span>
              )}
            </div>
            
            {/* Title */}
            <h3 className="text-sm font-bold text-slate-900 leading-snug mb-1">{r.title}</h3>
            
            {/* Snippet */}
            <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">{r.snippet}</p>
            
            {/* Keywords */}
            {r.matchedKeywords.length > 0 && (
              <div className="flex gap-1 mt-2 flex-wrap">
                {r.matchedKeywords.map((kw, i) => (
                  <span 
                    key={i} 
                    className={`${
                      isSanction 
                        ? 'bg-gradient-to-r from-orange-50 to-red-50 text-orange-700 border-orange-200' 
                        : 'bg-gradient-to-r from-red-50 to-rose-50 text-red-700 border-red-200'
                    } border px-2 py-0.5 rounded-md text-[10px] font-semibold`}
                  >
                    {kw}
                  </span>
                ))}
              </div>
            )}
          </div>
          
          {/* Chevron */}
          <div className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
            isOpen ? 'bg-slate-100 rotate-0' : 'hover:bg-slate-100'
          }`}>
            {isOpen 
              ? <ChevronDown className="w-4 h-4 text-slate-600" strokeWidth={2.5} /> 
              : <ChevronRight className="w-4 h-4 text-slate-400" strokeWidth={2.5} />
            }
          </div>
        </div>
        
        {/* Expanded Section */}
        {isOpen && (
          <div className="px-4 pb-4 pl-5">
            {/* AI Analysis Box */}
            <div className={`${c.bg} rounded-xl p-4 border ${c.border}`}>
              <div className="flex items-center gap-2 mb-2.5">
                <div className={`w-8 h-8 rounded-lg ${c.bg} border ${c.border} flex items-center justify-center`}>
                  <Brain className={`w-4 h-4 ${c.text}`} strokeWidth={2.2} />
                </div>
                <div>
                  <div className={`text-xs font-black ${c.text} tracking-wide uppercase`}>AI 分析</div>
                  <div className="text-[10px] text-slate-500">
                    {r.cls === 'TRUE_HIT' ? '🚨 真實命中' 
                      : r.cls === 'POSSIBLE_HIT' ? '⚠️ 存疑' 
                      : r.cls === 'FALSE_HIT' ? '❌ 誤報' 
                      : r.cls === 'IRRELEVANT_MLTF' ? 'ℹ️ 無關' 
                      : '✅ 無命中'}
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">
                {r.reason.replace(/^(TRUE HIT|FALSE HIT|IRRELEVANT ML\/TF|IRRELEVANT|NO HIT):\s*/i, '')}
              </p>
              
              {/* Stats */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-current/10">
                <div className="flex-1 bg-white/60 rounded-lg p-2">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Risk Category</div>
                  <div className={`text-xs font-bold ${c.text} mt-0.5`}>{r.riskCat}</div>
                </div>
                <div className="flex-1 bg-white/60 rounded-lg p-2">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Confidence</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${accentColor.leftBar}`}
                        style={{ width: `${Math.round(r.confidence * 100)}%` }} 
                      />
                    </div>
                    <span className="text-xs font-black text-slate-900">{Math.round(r.confidence * 100)}%</span>
                  </div>
                </div>
              </div>
            </div>
            
            {r.cls === 'TRUE_HIT' && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={(e) => { e.stopPropagation(); flagSTR(r.rank, r); }}
                  className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    strFlaggedRanks.has(r.rank)
                      ? 'bg-gradient-to-r from-red-600 to-rose-700 text-white shadow-lg shadow-red-500/40'
                      : 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-md shadow-red-500/30'
                  }`}
                >
                  {strFlaggedRanks.has(r.rank) ? '✅ 已標記 STR' : '🚨 標記 STR'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'FALSE_HIT', 'Manually downgraded from TRUE_HIT'); }}
                  className="px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition flex items-center gap-1.5"
                >
                  ↓ 降級
                </button>
              </div>
            )}
            {r.cls === 'PENDING_INFO' && (
              <div className="mt-3 space-y-3">
                <div className="bg-gradient-to-br from-indigo-50 to-blue-100 border border-indigo-200 rounded-xl p-3.5">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow shadow-indigo-500/30">
                      <Loader className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                    </div>
                    <div className="text-xs font-black text-indigo-900">⏳ 待 CDD 補充以下資料</div>
                  </div>
                  {r.missingInfo && r.missingInfo.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {r.missingInfo.map((info, i) => (
                        <span 
                          key={i} 
                          className="bg-white text-indigo-700 border border-indigo-200 px-2 py-1 rounded-lg text-[11px] font-bold shadow-sm"
                        >
                          ❓ {info}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-indigo-600 mb-2 italic">
                      AI 未指定具體欄位 — 請至少補充:DOB、國籍、職務、公司關聯
                    </div>
                  )}
                  <div className="text-[11px] text-indigo-700 bg-white/60 rounded-lg p-2 flex items-start gap-1.5">
                    <span>🚨</span>
                    <span>
                      <b>名字匹配 + 有 ML/TF 內容,但缺乏身份驗證資料。</b>
                      請補充上方資料後重新分析,即可升級為 TRUE_HIT / POSSIBLE_HIT 或下調為 FALSE_HIT。
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'FALSE_HIT', 'CDD confirmed: different person after identifier check'); }}
                    className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white px-3 py-2 rounded-xl text-xs font-bold shadow-md shadow-emerald-500/30 transition-all"
                  >
                    ✅ 確認非同人
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'POSSIBLE_HIT', 'CDD supplied partial identifiers — partial match confirmed'); }}
                    className="flex-1 bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-3 py-2 rounded-xl text-xs font-bold shadow-md shadow-purple-500/30 transition-all"
                  >
                    🟣 升為 Possible
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'TRUE_HIT', 'CDD supplied full identifiers — confirmed same person'); }}
                    className="flex-1 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white px-3 py-2 rounded-xl text-xs font-bold shadow-md shadow-red-500/30 transition-all"
                  >
                    🚨 升為 True Hit
                  </button>
                </div>
              </div>
            )}
            
            {r.cls === 'POSSIBLE_HIT' && (
              <div className="mt-3 space-y-3">
                {r.missingInfo && r.missingInfo.length > 0 && (
                  <div className="bg-gradient-to-br from-purple-50 to-violet-100 border border-purple-200 rounded-xl p-3.5">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shadow shadow-purple-500/30">
                        <Search className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                      </div>
                      <div className="text-xs font-black text-purple-900">需要核實的資料</div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {r.missingInfo.map((info, i) => (
                        <span 
                          key={i} 
                          className="bg-white text-purple-700 border border-purple-200 px-2 py-1 rounded-lg text-[11px] font-bold shadow-sm"
                        >
                          ❓ {info}
                        </span>
                      ))}
                    </div>
                    <div className="text-[11px] text-purple-700 bg-white/60 rounded-lg p-2 flex items-start gap-1.5">
                      <span>💡</span>
                      <span>請提供以上資料後重新分析，或由合規人員手動核實。</span>
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'FALSE_HIT', 'Manually confirmed as different person'); }}
                    className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white px-3 py-2 rounded-xl text-xs font-bold shadow-md shadow-emerald-500/30 transition-all"
                  >
                    ✅ 確認非同人
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); updateResultCls(r.rank, 'TRUE_HIT', 'Manually upgraded from POSSIBLE_HIT'); }}
                    className="flex-1 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white px-3 py-2 rounded-xl text-xs font-bold shadow-md shadow-red-500/30 transition-all"
                  >
                    🚨 升級為 True Hit
                  </button>
                </div>
              </div>
            )}
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
                      {searchEntity ? (
                        detectLanguage(searchEntity) === 'zh' 
                          ? <span className="text-red-600">🇨🇳 中文</span> 
                          : <span className="text-blue-600">🇬🇧 英文</span>
                      ) : (
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
                  <p className="text-[11px] text-slate-500 mt-0.5">使用 GPT 5.5 進行語義分析與分類</p>
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
                  <span className="inline-block px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-bold text-[9px]">GPT 5.5</span>
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
              {/* Statistics Grid - Modern */}
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
                <div className="bg-white rounded-2xl border border-slate-200 p-3 text-center shadow-[0_2px_8px_rgba(15,23,42,0.04)] hover:shadow-[0_4px_16px_rgba(15,23,42,0.08)] transition-all">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">{results.length}</div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">Total</div>
                </div>
                {Object.entries(CLS_CONFIG).map(([key, c]) => { 
                  const Icon = c.icon; 
                  const colorMap = {
                    TRUE_HIT: 'from-red-50 to-rose-100 border-red-200 hover:shadow-red-200/50',
                    POSSIBLE_HIT: 'from-purple-50 to-violet-100 border-purple-200 hover:shadow-purple-200/50',
                    PENDING_INFO: 'from-indigo-50 to-blue-100 border-indigo-200 hover:shadow-indigo-200/50',
                    FALSE_HIT: 'from-amber-50 to-orange-100 border-amber-200 hover:shadow-amber-200/50',
                    IRRELEVANT_MLTF: 'from-slate-50 to-slate-100 border-slate-200 hover:shadow-slate-200/50',
                    NO_HIT: 'from-emerald-50 to-teal-100 border-emerald-200 hover:shadow-emerald-200/50',
                  };
                  return (
                    <div key={key} className={`bg-gradient-to-br ${colorMap[key]} rounded-2xl border p-3 text-center shadow-sm hover:shadow-md transition-all`}>
                      <div className={`text-2xl font-black ${c.text} tracking-tight`}>{counts[key]}</div>
                      <div className={`text-[10px] ${c.text} font-bold uppercase tracking-wider mt-0.5 flex items-center justify-center gap-1`}>
                        <Icon className="w-3 h-3" />
                        <span className="truncate">{detectedLang === 'zh' ? c.labelZh : c.label}</span>
                      </div>
                    </div>
                  ); 
                })}
              </div>

              {/* Risk Assessment Banner - Bold */}
              <div className={`relative overflow-hidden rounded-2xl p-4 text-white shadow-lg ${
                counts.TRUE_HIT > 0 
                  ? 'bg-gradient-to-r from-red-500 via-red-600 to-rose-700 shadow-red-500/30' 
                  : counts.PENDING_INFO > 0
                    ? 'bg-gradient-to-r from-indigo-500 via-indigo-600 to-blue-700 shadow-indigo-500/30'
                    : counts.POSSIBLE_HIT > 0 
                      ? 'bg-gradient-to-r from-purple-500 via-purple-600 to-violet-700 shadow-purple-500/30' 
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
                        {counts.TRUE_HIT > 0 ? '🚨 HIGH RISK' 
                          : counts.PENDING_INFO > 0 ? '⏳ AWAITING CDD INFO'
                          : counts.POSSIBLE_HIT > 0 ? '⚠️ REVIEW NEEDED' 
                          : '✅ LOW RISK'}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs opacity-90 max-w-xs text-right">
                    {counts.TRUE_HIT > 0 ? riskDescHigh 
                      : counts.PENDING_INFO > 0 ? `${counts.PENDING_INFO} result(s) require CDD identifier follow-up` 
                      : riskDescLow}
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-2 shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
                <div className="flex gap-1 flex-wrap">
                  {[
                    { k: 'ALL', l: `全部`, count: results.length, color: 'slate' },
                    ...Object.entries(CLS_CONFIG).map(([k, c]) => ({ 
                      k, 
                      l: detectedLang === 'zh' ? c.labelZh : c.label, 
                      count: counts[k],
                      color: k === 'TRUE_HIT' ? 'red' : k === 'POSSIBLE_HIT' ? 'purple' : k === 'PENDING_INFO' ? 'indigo' : k === 'FALSE_HIT' ? 'amber' : k === 'IRRELEVANT_MLTF' ? 'slate' : 'emerald'
                    }))
                  ].map(f => {
                    const isActive = filterType === f.k;
                    return (
                      <button 
                        key={f.k} 
                        onClick={() => setFilterType(f.k)} 
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                          isActive 
                            ? f.color === 'red' ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-md shadow-red-500/30'
                            : f.color === 'purple' ? 'bg-gradient-to-r from-purple-500 to-violet-600 text-white shadow-md shadow-purple-500/30'
                            : f.color === 'indigo' ? 'bg-gradient-to-r from-indigo-500 to-blue-600 text-white shadow-md shadow-indigo-500/30'
                            : f.color === 'amber' ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/30'
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
              <div className="space-y-2">{filteredResults.length === 0 ? <div className="text-center py-8 text-sm text-gray-400">無結果</div> : filteredResults.map(r => <ResultCard key={r.rank} r={r} />)}</div>
              <button onClick={() => { setAnalysisComplete(false); setResults([]); setPdfFile(null); setProgress(0); }} className="w-full py-2 rounded-lg text-xs text-gray-500 border border-dashed hover:border-gray-400 hover:text-gray-700">🔄 重新分析（清除結果)
                  </button>         
              {/* 📋 分析結果摘要（可複製）*/}
              <div className="bg-gray-50 rounded-xl border p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-gray-700">📋 分析結果摘要（可複製）</h3>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(summaryText).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      });
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      copied ? 'bg-green-600 text-white' : 'bg-slate-700 text-white hover:bg-slate-600'
                    }`}
                  >
                    {copied ? '✅ 已複製' : '📋 複製全部'}
                  </button>
                </div>
                <pre className="w-full max-h-96 overflow-y-auto text-xs font-mono bg-white border rounded-lg p-3 whitespace-pre-wrap text-gray-700 select-all">
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
                    <p className="text-[11px] text-slate-500">EN + ZH 雙語 · 自動偵測</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-blue-50/50 to-indigo-50/50 rounded-xl border border-blue-100 p-4">
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-blue-100">
                      <h3 className="text-sm font-bold text-blue-700">🇬🇧 English Keywords</h3>
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-blue-500 text-white">
                        {EN_KEYWORDS.length}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {EN_KEYWORDS.map((kw, i) => (
                        <span 
                          key={i} 
                          className="bg-white text-blue-700 border border-blue-200 px-2 py-1 rounded-md text-[11px] font-semibold shadow-sm hover:shadow-md transition-all"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-red-50/50 to-rose-50/50 rounded-xl border border-red-100 p-4">
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-red-100">
                      <h3 className="text-sm font-bold text-red-700">🇨🇳 中文關鍵字</h3>
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-red-500 text-white">
                        {ZH_KEYWORDS.length}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {ZH_KEYWORDS.map((kw, i) => (
                        <span 
                          key={i} 
                          className="bg-white text-red-700 border border-red-200 px-2 py-1 rounded-md text-[11px] font-semibold shadow-sm hover:shadow-md transition-all"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
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
<button onClick={() => setSvgTransform({ x: 0, y: 0, scale: 1 })} className="bg-gray-200 text-gray-600 px-2 py-1 rounded text-xs" title={t.resetView}>↺</button>
<span className="text-xs text-gray-400">{Math.round(svgTransform.scale * 100)}%</span>
{/* ★ END NEW */}
              <button onClick={() => openModal('addRel', { sourceId: '', targetId: '', type: 'ownership', percentage: '', shares: '', description: '', inputMode: 'shares' })} className="bg-blue-600 text-white px-2 py-1 rounded text-xs">{t.addRelationship}</button>
              {dagSelected && <button onClick={() => setDagSelected(null)} className="bg-gray-200 text-gray-600 px-2 py-1 rounded text-xs">{t.clearSelection}</button>}
            </div>
            <div className="flex-1 overflow-auto relative" onClick={() => setContextMenu(null)}>
              <svg ref={svgRef} width={W} height={Math.max(H, 350)}
  onWheel={e => { e.preventDefault(); setSvgTransform(p => ({ ...p, scale: Math.max(0.3, Math.min(3, +(p.scale + (e.deltaY > 0 ? -0.1 : 0.1)).toFixed(1))) })); }}>
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
                    onClick={e => { e.stopPropagation(); if (!dragMode) setDagSelected(ent.id === dagSelected ? null : ent.id); }}
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
              }
            });
            // 自動加入備註
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

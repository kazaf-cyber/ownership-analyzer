/**
 * KYC/AML Compliance Management System
 * 
 * 修正日誌 (2026-04-01):
 * ✅ 1. 修正日期生成的時區問題（使用本地時間而非 UTC）
 * ✅ 2. 修正 CSV 導出的換行符編碼錯誤
 * ✅ 3. 修正 calcCRR 函數中 PEP 強制提升的執行順序
 * ✅ 4. 修正 findUBOs 函數中 control 關係的百分比累積邏輯
 * ✅ 5. 為循環檢測函數增加說明註釋
 * ✅ 6. 改進 showToast 避免快速點擊時的競態條件
 * ✅ 7. 實作 PEP Category 的風險等級差異化
 * ✅ 8. 改進 openModal 確保狀態獨立性
 * 
 * 修正日誌 (2026-04-08):
 * ❌ 9. [已移除] SERP 截圖功能（Google 會攔截 Worker IP）
 * 
 * 修正日誌 (2026-04-09):
 * ✅ 10. 新增網頁內容抓取（Worker /api/scrape），AI 基於全文分析而非僅 snippet
 * ✅ 11. 新增後處理自動降級：低信心度 / 無關鍵字的 TRUE_HIT 自動降為 IRRELEVANT_MLTF
 * ✅ 12. AI Prompt 加入 enrichedContent，max_tokens 提升至 12288
 * ✅ 13. 移除 SERP 截圖功能及相關 UI（Google 對 Worker IP 進行攔截）
 * ✅ 14. 新增 Sanction Screening Tab（獨立於 Adverse Media，聚焦制裁名單命中）
 * 
 * 主要修正重點：
 * - UBO 計算邏輯：區分 control（控制權）與 ownership（經濟權益）
 * - 風險評級邏輯：PEP 強制提升現在會在 sanction 檢查前處理
 * - 數據準確性：修正時區和編碼問題
 * - 網頁全文抓取：AI 分析前先抓取搜尋結果的實際網頁內容，大幅提升分類準確度
 * - 制裁篩查：獨立 Tab，AI Prompt 聚焦制裁名單命中
 */

import React, { useState, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom';
import { PieChart, Pie, Cell, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer } from 'recharts';
import { Search, Brain, AlertTriangle, CheckCircle, XCircle, Info, ChevronDown, ChevronRight, Globe, ExternalLink, Loader, Shield } from 'lucide-react';

/* ========== STABLE SUB-COMPONENTS ========== */
function ModalShell({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-start justify-center z-50 p-4 overflow-y-auto" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`bg-white rounded-xl shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-2xl'} w-full mt-8 mb-8`}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-base font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
function BadgeC({ color, children }) {
  const c = { red: 'bg-red-100 text-red-700 border-red-200', amber: 'bg-amber-100 text-amber-700 border-amber-200', green: 'bg-green-100 text-green-700 border-green-200', blue: 'bg-blue-100 text-blue-700 border-blue-200', gray: 'bg-gray-100 text-gray-600 border-gray-200', purple: 'bg-purple-100 text-purple-700 border-purple-200', indigo: 'bg-indigo-100 text-indigo-700 border-indigo-200', teal: 'bg-teal-100 text-teal-700 border-teal-200', cyan: 'bg-cyan-100 text-cyan-700 border-cyan-200' };
  return <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${c[color] || c.gray}`}>{children}</span>;
}
function RiskBadge({ rating, label }) { return <BadgeC color={rating === 'High' ? 'red' : rating === 'Medium' ? 'amber' : 'green'}>{label || rating}</BadgeC>; }
function PriorityDot({ p }) { return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${p === 'critical' ? 'bg-red-500' : p === 'high' ? 'bg-orange-500' : p === 'medium' ? 'bg-yellow-500' : 'bg-green-500'}`} />; }
function FormField({ label, children }) { return <div><label className="text-xs text-gray-500 block mb-1">{label}</label>{children}</div>; }

/* ========== CONSTANTS ========== */
const gid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};
const getToday = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const today = getToday();
const RISK_COLORS = { High: '#ef4444', Medium: '#f59e0b', Low: '#22c55e' };
const PIE_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
const DEFAULT_HIGH_RISK = ['Iran', 'North Korea', 'Myanmar', 'Syria', 'Afghanistan', 'Libya', 'Somalia', 'South Sudan', 'Yemen', 'Iraq'];
const DEFAULT_OFFSHORE = ['BVI', 'Cayman Islands', 'Panama', 'Bermuda', 'Jersey', 'Guernsey', 'Isle of Man', 'Liechtenstein', 'Vanuatu', 'Seychelles'];
const DEFAULT_MONITORED = ['Russia', 'Turkey', 'UAE', 'Pakistan', 'Cambodia', 'Nigeria', 'Albania', 'Philippines', 'Barbados', 'Senegal'];
const ALL_COUNTRIES = [...new Set([...DEFAULT_HIGH_RISK, ...DEFAULT_OFFSHORE, ...DEFAULT_MONITORED, 'USA', 'UK', 'Germany', 'France', 'Japan', 'Australia', 'Canada', 'Singapore', 'Hong Kong', 'Taiwan', 'Switzerland', 'Netherlands', 'Ireland', 'Luxembourg', 'China', 'India', 'Brazil', 'South Korea', 'New Zealand', 'Sweden', 'Norway'])].sort();
const DOC_COMPANY = ['Certificate of Incorporation', 'Register of Directors', 'Register of Shareholders', 'Memorandum & Articles', 'Financial Statements', 'Proof of Address', 'Sanctions Screening Report', 'Source of Funds Declaration', 'Tax Residency Certificate'];
const DOC_PERSON = ['Passport / ID', 'Proof of Address', 'Source of Wealth Declaration', 'CV / Profile', 'Sanctions Screening Report', 'PEP Screening Report', 'Bank Reference Letter'];
const DEFAULT_WEIGHTS = { jurisdiction: 25, pep: 25, sanctions: 20, negativeNews: 10, entityType: 10, ownership: 10 };
const WK = { jurisdiction: 'weightJurisdiction', pep: 'weightPep', sanctions: 'weightSanctions', negativeNews: 'weightNegativeNews', entityType: 'weightEntityType', ownership: 'weightOwnership' };

const AUTO_HIGH_RISK_SUBTYPES = ['Trust', 'Nominee', 'Nominee Shareholder'];
const SDD_ELIGIBLE_CATEGORIES = ['listed', 'government', 'stateOwned'];

const SAMPLE_ENTITIES = [
  { id: 'e1', name: 'Alpha Holdings Ltd', type: 'company', subType: 'Holding Company', companyCategory: 'private', jurisdiction: 'BVI', totalShares: 10000, isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: '2025-01-15', score: 68, rating: 'Medium' }, { date: '2025-06-10', score: 72, rating: 'High' }, { date: '2025-12-01', score: 75, rating: 'High' }], lastReviewDate: '2025-12-01', nextReviewDate: '2026-06-01', documents: [{ id: 'd1', name: 'Certificate of Incorporation', status: 'received', expiry: null }, { id: 'd2', name: 'Register of Directors', status: 'received', expiry: null }, { id: 'd3', name: 'Register of Shareholders', status: 'pending', expiry: null }, { id: 'd4', name: 'Financial Statements', status: 'expired', expiry: '2025-12-31' }], screeningLogs: [{ id: 's1', date: '2025-12-01', system: 'World-Check', type: 'Sanctions', result: 'Clear' }, { id: 's2', date: '2025-12-01', system: 'World-Check', type: 'PEP', result: 'Clear' }], str: null, notes: [{ id: 'n1', text: 'Initial onboarding completed.', date: '2025-01-15', author: 'Analyst A' }, { id: 'n2', text: 'Annual review: risk elevated due to BVI.', date: '2025-12-01', author: 'CO' }], cddRecords: [] },
  { id: 'e2', name: 'Beta Trading Co', type: 'company', subType: 'Trading Company', companyCategory: 'listed', jurisdiction: 'Hong Kong', totalShares: 1000, isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: '2025-03-10', score: 35, rating: 'Low' }, { date: '2025-09-15', score: 42, rating: 'Medium' }], lastReviewDate: '2025-09-15', nextReviewDate: '2026-03-15', documents: [{ id: 'd5', name: 'Certificate of Incorporation', status: 'received', expiry: null }], screeningLogs: [{ id: 's3', date: '2025-09-15', system: 'Dow Jones', type: 'Sanctions', result: 'Clear' }], str: null, notes: [], cddRecords: [] },
  { id: 'e3', name: 'Gamma Trust', type: 'company', subType: 'Trust', companyCategory: 'private', jurisdiction: 'Cayman Islands', totalShares: null, isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: true, riskOverride: null, riskHistory: [{ date: '2025-02-20', score: 78, rating: 'High' }], lastReviewDate: '2025-02-20', nextReviewDate: '2025-08-20', documents: [{ id: 'd7', name: 'Trust Deed', status: 'received', expiry: null }, { id: 'd8', name: 'Register of Beneficiaries', status: 'pending', expiry: null }], screeningLogs: [{ id: 's4', date: '2025-02-20', system: 'World-Check', type: 'Negative News', result: 'Hit - tax evasion' }], str: { flagged: true, submittedDate: '2025-03-01', mlroApproved: true, mlroDate: '2025-03-05' }, notes: [{ id: 'n4', text: 'Negative media flagged.', date: '2025-02-20', author: 'Analyst A' }], cddRecords: [] },
  { id: 'e4', name: 'John Smith', type: 'person', subType: 'Director', companyCategory: null, jurisdiction: 'UK', totalShares: null, isPEP: true, pepCategory: 'domestic', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: '2025-01-15', score: 62, rating: 'Medium' }, { date: '2025-07-01', score: 65, rating: 'Medium' }], lastReviewDate: '2025-07-01', nextReviewDate: '2026-01-01', documents: [{ id: 'd9', name: 'Passport / ID', status: 'received', expiry: '2027-05-15' }], screeningLogs: [{ id: 's5', date: '2025-07-01', system: 'World-Check', type: 'PEP', result: 'Hit - Former MP' }], str: null, notes: [{ id: 'n5', text: 'PEP: former MP.', date: '2025-01-15', author: 'Analyst A' }], cddRecords: [] },
  { id: 'e5', name: 'Jane Doe', type: 'person', subType: 'Shareholder', companyCategory: null, jurisdiction: 'USA', totalShares: null, isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: '2025-01-15', score: 18, rating: 'Low' }], lastReviewDate: '2025-01-15', nextReviewDate: '2026-01-15', documents: [{ id: 'd11', name: 'Passport / ID', status: 'received', expiry: '2028-11-20' }], screeningLogs: [{ id: 's6', date: '2025-01-15', system: 'Dow Jones', type: 'Sanctions', result: 'Clear' }], str: null, notes: [], cddRecords: [] },
  { id: 'e6', name: 'Delta Corp', type: 'company', subType: 'Operating Company', companyCategory: 'stateOwned', jurisdiction: 'Singapore', totalShares: 5000, isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: '2025-04-01', score: 22, rating: 'Low' }], lastReviewDate: '2025-04-01', nextReviewDate: '2026-04-01', documents: [], screeningLogs: [], str: null, notes: [], cddRecords: [] },
  { id: 'e7', name: 'Epsilon Foundation', type: 'company', subType: 'Foundation', companyCategory: 'private', jurisdiction: 'Panama', totalShares: null, isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: '2025-05-15', score: 71, rating: 'High' }], lastReviewDate: '2025-05-15', nextReviewDate: '2025-11-15', documents: [], screeningLogs: [], str: null, notes: [], cddRecords: [] },
  { id: 'e8', name: 'David Chen', type: 'person', subType: 'Beneficiary', companyCategory: null, jurisdiction: 'China', totalShares: null, isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: '2025-06-01', score: 45, rating: 'Medium' }], lastReviewDate: '2025-06-01', nextReviewDate: '2025-12-01', documents: [{ id: 'd15', name: 'Passport / ID', status: 'received', expiry: '2026-02-01' }], screeningLogs: [], str: null, notes: [], cddRecords: [] },
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
    dragModeOn: '🔗 Drag ON', dragMode: '🔗 Drag', addRelationship: '+ Add Rel', clearSelection: 'Clear',
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
    annualReview: 'Annual Review Required',
    saveRel: 'Save Relationship',
    duplicateRelWarning: '⚠️ A relationship already exists between these two entities with the same type.',
    circularRelWarning: '⚠️ This would create a circular ownership chain.',
    selfRelWarning: '⚠️ Source and target cannot be the same entity.',
    sharesExceedWarning: '⚠️ Total allocated shares ({allocated}) would exceed total issued shares ({total}).',
    reviewCycleDays: 'Review Cycle (days)',
    eddRequired: '🔴 EDD Required: High-risk entity requires Enhanced Due Diligence.',
    docExpiringSoon: '⚠️ Document expiring within 30 days',
    exportCSV: '📥 Export CSV',
    lastUpdated: 'Last Updated',
    entityStatus: 'Status',
    pendingDocsCount: 'Pending Docs',
    relCount: 'Relationships',
    noRelWarning: '⚠️ This entity has no relationships.',
    percentageExceeds100: '⚠️ Total ownership of target exceeds 100%.',
    requiredField: 'This field is required.',
    dueDiligenceLevel: 'Due Diligence Level',
    sdd: 'SDD', cdd: 'CDD', edd: 'EDD',
    sddDesc: 'Simplified', cddDesc: 'Standard', eddDesc: 'Enhanced',
    reviewCycleHigh: 'High Risk: Review every 12 months',
    reviewCycleMedium: 'Medium Risk: Review every 24 months',
    reviewCycleLow: 'Low Risk: Review every 36 months',
    autoReviewReminder: 'Auto-calculated next review based on risk rating',
    pepCategory: 'PEP Category',
    selectPepCategory: 'Select PEP Category',
    pepForeign: 'Foreign PEP',
    pepDomestic: 'Domestic PEP',
    pepInternational: 'International Org. PEP',
    pepFamilyMember: 'PEP Family Member',
    pepCloseAssociate: 'PEP Close Associate',
    pepAutoHighRisk: 'Auto elevated to High Risk (PEP)',
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
    dragModeOn: '🔗 拖拽 ON', dragMode: '🔗 拖拽', addRelationship: '+ 新增關係', clearSelection: '取消',
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
    annualReview: '強制年審',
    saveRel: '儲存關係',
    duplicateRelWarning: '⚠️ 這兩個實體之間已存在相同類型的關係。',
    circularRelWarning: '⚠️ 此操作將形成循環持股鏈。',
    selfRelWarning: '⚠️ 來源與目標不能為同一實體。',
    sharesExceedWarning: '⚠️ 分配股數總計（{allocated}）將超過已發行總股數（{total}）。',
    reviewCycleDays: '審查週期（天）',
    eddRequired: '🔴 需要 EDD：高風險實體需進行加強盡職調查。',
    docExpiringSoon: '⚠️ 文件將於 30 天內到期',
    exportCSV: '📥 匯出 CSV',
    lastUpdated: '最後更新',
    entityStatus: '狀態',
    pendingDocsCount: '待收文件',
    relCount: '關係數',
    noRelWarning: '⚠️ 此實體尚無任何關係。請考慮將其連結至持股結構。',
    percentageExceeds100: '⚠️ 目標公司的持股比例合計超過 100%。',
    requiredField: '此欄位為必填。',
    dueDiligenceLevel: '盡職調查等級',
    sdd: 'SDD 簡化', cdd: 'CDD 標準', edd: 'EDD 加強',
    sddDesc: '簡化盡職調查', cddDesc: '標準盡職調查', eddDesc: '加強盡職調查',
    reviewCycleHigh: '高風險：每 12 個月審查',
    reviewCycleMedium: '中風險：每 24 個月審查',
    reviewCycleLow: '低風險：每 36 個月審查',
    autoReviewReminder: '依據風險評級自動計算下次審查日',
    pepCategory: 'PEP 類別',
    selectPepCategory: '請選擇 PEP 類別',
    pepForeign: '外國 PEP',
    pepDomestic: '國內 PEP',
    pepInternational: '國際組織 PEP',
    pepFamilyMember: 'PEP 家屬成員',
    pepCloseAssociate: 'PEP 密切關係人',
    pepAutoHighRisk: '已自動提升為高風險（PEP）',
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
  'FALSE_HIT': { label: 'False Hit', labelZh: '誤報', desc: 'Full name / gender / DOB / Age not match', icon: XCircle, bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  'IRRELEVANT_MLTF': { label: 'Irrelevant to ML/TF', labelZh: '無關 ML/TF', desc: 'No negative news related to ML/TF or sanctions', icon: Info, bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-600', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
  'NO_HIT': { label: 'No Hit', labelZh: '無命中', desc: 'No search keywords found, or the search returned no result', icon: CheckCircle, bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700', badge: 'bg-green-100 text-green-800 border-green-200' }
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
  const query = `"${entityName}" (${keywordString})`;
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
  return { query: `"${entityName}" (${kString})`, detectedLang: lang, keywords: kws };
}

/* ── 保留舊 API（合併全部 Parts，供 Mock / 向下相容）── */
function buildSanctionQueryAuto(entityName) {
  const lang = detectLanguageDetail(entityName);
  const all = getSanctionKeywordsByPart(lang);
  const keywords = [...all.part1, ...all.part2, ...all.part3];
  const kString = keywords.map(k => `"${k}"`).join(' OR ');
  return { query: `"${entityName}" (${kString})`, detectedLang: lang === 'zh_cn' ? 'zh' : lang === 'zh_tw' ? 'zh' : 'en', keywords };
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


/* ========== GENERIC SCREENING COMPONENT (shared by Adverse Media & Sanction) ========== */

function ScreeningModule({ entityName: initialEntityName, mode }) {
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
  const [workerUrl, setWorkerUrl] = useState(_saved?.workerUrl || '');
  const [workerKey, setWorkerKey] = useState(_saved?.workerKey || '');
  const [showWorkerConfig, setShowWorkerConfig] = useState(false);
  const [sanctionPart, setSanctionPart] = useState('part1');
  const [workerStatus, setWorkerStatus] = useState('');

  React.useEffect(() => {
    if (analysisComplete && results.length > 0) {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
          results, searchEntity, analysisComplete, detectedLang, filterType, apiKey,
          workerUrl, workerKey,
        }));
      } catch {}
    }
  }, [results, analysisComplete, detectedLang, filterType, searchEntity, apiKey, workerUrl, workerKey]);

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
    const base = workerUrl.replace(/\/+$/, '');
    const resp = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(workerKey ? { 'X-Worker-Key': workerKey } : {}) },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  };

  const fetchPageContent = async (url) => {
    if (!workerUrl.trim()) return null;
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
    if (!workerUrl.trim()) return;
    setWorkerStatus('');
    try {
      const base = workerUrl.replace(/\/+$/, '');
      const r = await fetch(`${base}/api/health`, { headers: workerKey ? { 'X-Worker-Key': workerKey } : {} });
      const d = await r.json();
      setWorkerStatus(d.ok ? `✅ 連線成功 | 路由: ${d.routes?.join(', ') || 'N/A'}` : '❌ 回應異常');
    } catch (e) { setWorkerStatus(`❌ ${e.message}`); }
  };

  const handlePdfUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') { setPdfFile(file); setErrorMsg(''); }
    else if (file) setErrorMsg('請上傳 PDF 格式文件（.pdf）');
  };

  /* ── 生成 AI Prompt（制裁篩查 vs 不良媒體各自不同）── */
  const buildAIPrompt = (searchEntityName, enrichedContent, resultCount, hasPageContent, lang) => {
    if (isSanction) {
      return `You are a senior compliance analyst performing Sanctions List Screening for KYC/AML purposes.

TASK: Analyze each Google search result from the PDF and classify whether the entity appears on any sanctions list or is involved in sanctions-related violations.

═══════════════════════════════════════════
ENTITY UNDER SCREENING: "${searchEntityName}"
═══════════════════════════════════════════

${hasPageContent ? `YOU HAVE TWO DATA SOURCES:
1. Google search result snippets (from PDF)
2. Full page content of each result (appended below, marked with "--- PAGE CONTENT: [url] ---")

IMPORTANT: Base your classification PRIMARILY on the full page content when available.
Only fall back to snippets if the full page content is missing for that result.
A snippet alone is NOT sufficient evidence for TRUE_HIT — you MUST verify with full content when available.
` : `NOTE: Only Google search snippets are available. Be CONSERVATIVE — if a snippet is ambiguous, classify as IRRELEVANT_MLTF rather than TRUE_HIT.
`}
STAGE 1 — NAME VERIFICATION:
• Does the search result refer to the EXACT same entity (not a similarly named one)?
• Check: jurisdiction, industry, legal form, key persons mentioned.
• If different entity → FALSE_HIT (stop here).

STAGE 2 — SANCTIONS RELEVANCE (only if Stage 1 passes):
• Is the content DIRECTLY related to ANY of the following sanctions concerns?
  ✅ RELEVANT (→ TRUE_HIT):
    - Entity listed on OFAC SDN List / Sectoral Sanctions Identifications (SSI) List
    - Entity listed on UN Security Council Consolidated Sanctions List
    - Entity listed on EU Consolidated Sanctions List
    - Entity listed on UK OFSI / HM Treasury Sanctions List
    - Entity listed on HKMA / MAS / local regulator sanctions lists
    - Asset freeze orders / travel bans / arms embargoes targeting the entity
    - Entity investigated for sanctions evasion or circumvention
    - Entity acting as front company for sanctioned persons/entities
    - Entity designated under any country-specific sanctions programme
    - Secondary sanctions exposure (facilitating sanctioned transactions)
    - Proliferation financing concerns (WMD-related)

  ❌ NOT RELEVANT (→ IRRELEVANT_MLTF):
    - Entity implementing sanctions compliance programmes (positive news)
    - General news about sanctions regimes that does NOT target the entity
    - Entity mentioned as a compliant party in sanctions context
    - Commercial disputes / civil lawsuits unrelated to sanctions
    - General regulatory guidance about sanctions screening
    - Article mentions sanctions but entity is not a target or subject

CLASSIFICATION OUTPUT:
- TRUE_HIT: Stage 1 ✅ AND Stage 2 ✅ — entity confirmed AND directly sanctioned, designated, or investigated for sanctions violations
- FALSE_HIT: Stage 1 ❌ — different entity with similar name
- IRRELEVANT_MLTF: Stage 1 ✅ but Stage 2 ❌ — correct entity but NOT sanctions-related
- NO_HIT: Entity not mentioned at all, or no meaningful content

CRITICAL ANTI-FALSE-POSITIVE RULES:
1. An entity IMPLEMENTING sanctions compliance is NOT a TRUE_HIT.
2. "sanctions" keyword appearing in general regulatory context ≠ TRUE_HIT.
3. Only classify as TRUE_HIT if the entity is the TARGET of sanctions or under investigation FOR sanctions violations.
4. If uncertain between TRUE_HIT and IRRELEVANT_MLTF, classify as IRRELEVANT_MLTF and set confidence < 0.7.

RESPONSE FORMAT — JSON array only, no other text:
[{
  "rank": 1,
  "title": "Exact article title",
  "source": "publication name",
  "date": "YYYY-MM-DD",
  "snippet": "Verbatim 2-3 sentence excerpt",
  "matchedKeywords": ["only keywords in sanctions context"],
  "cls": "TRUE_HIT",
  "confidence": 0.95,
  "reason": "STAGE 1: [name verification]. STAGE 2: [sanctions relevance with specific list/regime identified].",
  "riskCat": "OFAC SDN / EU Sanctions / UN Sanctions / Sanctions Evasion / Asset Freeze / Proliferation / N/A"
}]

Analyze ALL ~${resultCount} results from this PDF. Start with [ end with ].

Content:
${enrichedContent.slice(0, 50000)}

REMINDER: Output ${resultCount} JSON items. Start with [ end with ]. Nothing else.`;
    }

    /* ── Adverse Media Prompt (unchanged) ── */
    return `You are a senior compliance analyst performing Adverse Media Screening for KYC/AML purposes.

TASK: Analyze each Google search result from the PDF and classify it using a strict TWO-STAGE process.

═══════════════════════════════════════════
ENTITY UNDER SCREENING: "${searchEntityName}"
═══════════════════════════════════════════

${hasPageContent ? `YOU HAVE TWO DATA SOURCES:
1. Google search result snippets (from PDF)
2. Full page content of each result (appended below, marked with "--- PAGE CONTENT: [url] ---")

IMPORTANT: Base your classification PRIMARILY on the full page content when available.
Only fall back to snippets if the full page content is missing for that result.
A snippet alone is NOT sufficient evidence for TRUE_HIT — you MUST verify with full content when available.
` : `NOTE: Only Google search snippets are available. Be CONSERVATIVE — if a snippet is ambiguous, classify as IRRELEVANT_MLTF rather than TRUE_HIT.
`}
STAGE 1 — NAME VERIFICATION:
• Does the search result refer to the EXACT same entity (not a similarly named one)?
• Check: jurisdiction, industry, legal form, key persons mentioned.
• If different entity → FALSE_HIT (stop here).

STAGE 2 — ML/TF RELEVANCE (only if Stage 1 passes):
• Is the content DIRECTLY related to ANY of the following predicate offences or regulatory concerns?
  ✅ RELEVANT (→ TRUE_HIT):
    - Money laundering / proceeds of crime
    - Terrorist financing / CFT
    - Sanctions violations (OFAC, EU, UN)
    - Bribery / corruption of public officials
    - Tax evasion / tax fraud (criminal, not civil disputes)
    - Drug trafficking / human trafficking
    - Fraud with criminal prosecution (not civil breach of contract)
    - Proliferation financing
    - Regulatory enforcement actions by financial regulators (HKMA, MAS, FCA, SEC, FinCEN, etc.)
    - Designated / listed by government agencies

  ❌ NOT RELEVANT (→ IRRELEVANT_MLTF):
    - Civil lawsuits / breach of contract / commercial disputes
    - Employment disputes / labour issues
    - Product liability / consumer complaints
    - General corporate news (IPO, merger, earnings)
    - Keyword appears but in unrelated context
    - Article merely mentions AML/sanctions as industry background
    - Regulatory news that does NOT name the entity as a subject

CLASSIFICATION OUTPUT:
- TRUE_HIT: Stage 1 ✅ AND Stage 2 ✅ — entity confirmed AND content is directly ML/TF related
- FALSE_HIT: Stage 1 ❌ — different entity with similar name
- IRRELEVANT_MLTF: Stage 1 ✅ but Stage 2 ❌ — correct entity but NOT ML/TF related
- NO_HIT: Entity not mentioned at all, or no meaningful content

CRITICAL ANTI-FALSE-POSITIVE RULES:
1. A keyword match alone is NEVER sufficient for TRUE_HIT.
2. "sued for breach of contract" = IRRELEVANT_MLTF, even if the word "fraud" appears nearby.
3. "under investigation" is TRUE_HIT ONLY if the investigation is by law enforcement or financial regulators for ML/TF predicate offences.
4. News articles about general regulatory changes that mention the entity only as a market participant = NO_HIT.
5. If uncertain between TRUE_HIT and IRRELEVANT_MLTF, classify as IRRELEVANT_MLTF and set confidence < 0.7.

RESPONSE FORMAT — JSON array only, no other text:
[{
  "rank": 1,
  "title": "Exact article title",
  "source": "publication name",
  "date": "YYYY-MM-DD",
  "snippet": "Verbatim 2-3 sentence excerpt",
  "matchedKeywords": ["only keywords used in ML/TF context"],
  "cls": "TRUE_HIT",
  "confidence": 0.92,
  "reason": "STAGE 1: [name verification reasoning]. STAGE 2: [ML/TF relevance reasoning with specific predicate offence identified].",
  "riskCat": "Money Laundering / Sanctions Evasion / Bribery / Tax Evasion (Criminal) / Terrorist Financing / Fraud (Criminal) / Regulatory Action / N/A"
}]

Analyze ALL ~${resultCount} results from this PDF. Start with [ end with ].

Content:
${enrichedContent.slice(0, 50000)}

REMINDER: Output ${resultCount} JSON items. Start with [ end with ]. Nothing else.`;
  };

  const buildSystemPrompt = () => {
    if (isSanction) {
      return `You are a KYC/AML compliance analyst AI specialising in Sanctions List Screening. You output ONLY valid JSON arrays.
Your primary goal is ACCURACY — correctly identifying entities that are sanctioned or designated.
FALSE POSITIVES are worse than false negatives.
An entity implementing sanctions compliance is NOT the same as an entity BEING sanctioned.
When in doubt, classify as IRRELEVANT_MLTF rather than TRUE_HIT.`;
    }
    return `You are a KYC/AML compliance analyst AI. You output ONLY valid JSON arrays.
Your primary goal is ACCURACY over quantity of hits.
FALSE POSITIVES are worse than false negatives in compliance screening.
When in doubt, classify as IRRELEVANT_MLTF rather than TRUE_HIT.
A keyword appearing in text does NOT automatically make it a TRUE_HIT —
the keyword must describe the screened entity's DIRECT involvement in ML/TF predicate offences.`;
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
      for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pdfText += content.items.map(x => x.str).join(' ') + '\n';
      }
      if (!pdfText.trim()) throw new Error('PDF 無法提取文字（可能是掃描圖片格式）');

      let enrichedContent = pdfText;
      let scrapedCount = 0;
      if (workerUrl.trim()) {
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
      const resultCount = (pdfText.match(/https?:\/\//g) || []).length;
      const hasPageContent = scrapedCount > 0;

      const fullPrompt = buildAIPrompt(searchEntity, enrichedContent, resultCount, hasPageContent, lang);

      const res = await fetch('https://api.poe.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({
          model: 'gemini-3.1-flash-lite',
          messages: [
            { role: 'system', content: buildSystemPrompt() },
            { role: 'user', content: fullPrompt }
          ],
          temperature: 0.05,
          max_tokens: 12288
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
      const VALID_CLS = ['TRUE_HIT', 'FALSE_HIT', 'IRRELEVANT_MLTF', 'NO_HIT'];
      parsed = parsed.map((r, i) => ({ ...r, rank: i + 1, cls: VALID_CLS.includes(r.cls) ? r.cls : 'NO_HIT', confidence: typeof r.confidence === 'number' ? Math.round(Math.min(1, Math.max(0, r.confidence)) * 100) / 100 : 0.8, matchedKeywords: Array.isArray(r.matchedKeywords) ? r.matchedKeywords.slice(0, 5) : [], title: r.title || '', source: r.source || '', date: r.date || '', snippet: r.snippet || '', reason: r.reason || '', riskCat: r.riskCat || 'N/A' }));

      parsed = parsed.map(r => {
        if (r.cls === 'TRUE_HIT' && r.confidence < 0.75) {
          return { ...r, cls: 'IRRELEVANT_MLTF', reason: `[Auto-downgraded: confidence ${r.confidence} < 0.75] ${r.reason}`, riskCat: 'N/A (Low Confidence)' };
        }
        if (r.cls === 'TRUE_HIT' && r.matchedKeywords.length === 0) {
          return { ...r, cls: 'IRRELEVANT_MLTF', reason: `[Auto-downgraded: no matched keywords] ${r.reason}`, riskCat: 'N/A (No Keywords)' };
        }
        return r;
      });

      setProgress(100);
      timerIdsRef.current.push(setTimeout(() => { setIsAnalyzing(false); setAnalysisComplete(true); setResults(parsed); }, 300));
    } catch (err) { setIsAnalyzing(false); setProgress(0); setStage(''); setErrorMsg(`分析失敗：${err.message}`); }
  };

  const counts = useMemo(() => {
    const c = { TRUE_HIT: 0, FALSE_HIT: 0, IRRELEVANT_MLTF: 0, NO_HIT: 0 };
    results.forEach(r => { if (c[r.cls] !== undefined) c[r.cls]++; });
    return c;
  }, [results]);

  const filteredResults = useMemo(() => filterType === 'ALL' ? results : results.filter(r => r.cls === filterType), [results, filterType]);

  const ResultCard = ({ r }) => {
    const c = CLS_CONFIG[r.cls] || CLS_CONFIG['NO_HIT'];
    const Icon = c.icon;
    const isOpen = expandedId === r.rank;
    return (
      <div className={`border-2 ${c.border} rounded-xl overflow-hidden bg-white`}>
        <div className="p-3 cursor-pointer hover:bg-gray-50 flex items-start gap-3" onClick={() => setExpandedId(isOpen ? null : r.rank)}>
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs font-bold text-gray-400 w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">{r.rank}</span>
            <Icon className={`w-4 h-4 ${c.text}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${c.badge}`}>{detectedLang === 'zh' ? c.labelZh : c.label}</span>
              <span className="text-xs text-gray-400">{Math.round(r.confidence * 100)}% confidence</span>
              <span className="text-xs text-gray-400">|</span>
              <span className="text-xs text-gray-500">{r.source}</span>
              <span className="text-xs text-gray-400">{r.date}</span>
            </div>
            <h3 className="text-sm font-bold text-gray-800 leading-snug">{r.title}</h3>
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{r.snippet}</p>
            {r.matchedKeywords.length > 0 && (<div className="flex gap-1 mt-1.5 flex-wrap">{r.matchedKeywords.map((kw, i) => (<span key={i} className={`${isSanction ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-red-50 text-red-600 border-red-200'} border px-1.5 py-0.5 rounded text-xs`}>{kw}</span>))}</div>)}
          </div>
          <div className="text-gray-300 pt-1">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</div>
        </div>
        {isOpen && (
          <div className="px-3 pb-3">
            <div className={`${c.bg} rounded-lg p-3`}>
              <div className="flex items-center gap-1.5 mb-1.5"><Brain className={`w-3.5 h-3.5 ${c.text}`} /><span className={`text-xs font-bold ${c.text}`}>AI 分析</span></div>
              <p className="text-xs text-gray-700">
                <span className={`font-bold mr-1 ${r.cls === 'TRUE_HIT' ? 'text-red-700' : r.cls === 'FALSE_HIT' ? 'text-amber-700' : r.cls === 'IRRELEVANT_MLTF' ? 'text-slate-600' : 'text-green-700'}`}>
                  {r.cls === 'TRUE_HIT' ? 'TRUE HIT' : r.cls === 'FALSE_HIT' ? 'FALSE HIT' : r.cls === 'IRRELEVANT_MLTF' ? 'IRRELEVANT' : 'NO HIT'}:
                </span>
                {r.reason.replace(/^(TRUE HIT|FALSE HIT|IRRELEVANT ML\/TF|IRRELEVANT|NO HIT):\s*/i, '')}
              </p>
              <div className="flex gap-3 mt-2 text-xs text-gray-500"><span>Risk: <b className={c.text}>{r.riskCat}</b></span><span>Confidence: <b>{Math.round(r.confidence * 100)}%</b></span></div>
            </div>
            {r.cls === 'TRUE_HIT' && (<div className="flex gap-2 mt-2"><button className="bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded-lg text-xs font-bold hover:bg-red-100">🚨 標記 STR</button></div>)}
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
    <div className="min-h-screen bg-gray-50">
      <div className={`${headerBg} text-white px-4 py-3`}>
        <h1 className="text-base font-bold flex items-center gap-2">{moduleIcon} {moduleTitle}</h1>
        <p className="text-xs text-slate-400 mt-0.5">{moduleSubtitle}</p>
      </div>
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex overflow-x-auto">
          {[{id:'demo',label:'🎬 開始'},{id:'arch',label:'🏗️ 架構說明'},{id:'keywords',label:'🔑 關鍵字配置'}].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab === t.id ? (isSanction ? 'border-orange-500 text-orange-700 bg-orange-50' : 'border-blue-500 text-blue-700 bg-blue-50') : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{t.label}</button>
          ))}
        </div>
      </div>
      <div className="max-w-6xl mx-auto p-4">
        {activeTab === 'demo' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
              <button onClick={() => setShowWorkerConfig(!showWorkerConfig)} className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-gray-50">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-teal-600" />
                  <span className="text-sm font-bold text-gray-700">📰 網頁全文抓取設定</span>
                  {workerUrl.trim() ? <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">✅ 已設定</span> : <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-200">選填</span>}
                </div>
                {showWorkerConfig ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </button>
              {showWorkerConfig && (
                <div className="px-4 pb-4 space-y-3 border-t">
                  <div className="pt-3 bg-teal-50 rounded-lg p-3 text-xs text-teal-700">
                    <b>💡 功能說明：</b>
                    <br />📰 <b>網頁抓取</b>：AI 分析前自動抓取每個搜尋結果的實際網頁全文（最多 3000 字/頁），大幅提升分類準確度。
                    <br />若未設定 Worker，仍可使用手動 Google 搜尋 + PDF 上傳流程（AI 僅基於 snippet 分析）。
                  </div>
                  <div><label className="text-xs text-gray-500 mb-1 block">Worker URL</label><input type="text" value={workerUrl} onChange={e => setWorkerUrl(e.target.value)} placeholder="https://kyc-ams-proxy.xxx.workers.dev" className="w-full border-2 rounded-lg px-3 py-2 text-sm font-mono focus:border-teal-500 focus:outline-none" /></div>
                  <div><label className="text-xs text-gray-500 mb-1 block">Worker Key（選填）</label><input type="password" value={workerKey} onChange={e => setWorkerKey(e.target.value)} className="w-full border-2 rounded-lg px-3 py-2 text-sm font-mono focus:border-teal-500 focus:outline-none" /></div>
                  <div className="flex gap-2">
                    <button onClick={testWorkerConnection} className="bg-slate-700 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-slate-600">🔌 測試連線</button>
                    {workerUrl.trim() && (<button onClick={() => { setWorkerUrl(''); setWorkerKey(''); setWorkerStatus(''); }} className="text-xs text-gray-400 hover:text-red-500 px-3 py-2">清除</button>)}
                  </div>
                  {workerStatus && (<div className={`text-xs rounded-lg p-2 ${workerStatus.startsWith('✅') ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>{workerStatus}</div>)}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-6 h-6 rounded-full ${isSanction ? 'bg-orange-600' : 'bg-blue-600'} text-white text-xs font-bold flex items-center justify-center`}>1</span>
                <h2 className="text-sm font-bold text-gray-800">執行 Google 搜尋</h2>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 mb-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">實體名稱</label>
                  <input type="text" value={searchEntity} onChange={e => setSearchEntity(e.target.value)} maxLength={200} className="w-full border-2 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" placeholder="輸入英文或中文名稱..." />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">自動檢測語言</label>
                  <div className="h-10 px-4 rounded-lg border-2 bg-gray-50 flex items-center gap-2">
                    <Globe className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-bold">{searchEntity ? (detectLanguage(searchEntity) === 'zh' ? <span className="text-red-600">🇨🇳 中文</span> : <span className="text-blue-600">🇬🇧 英文</span>) : '請輸入名稱'}</span>
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

              <div className={`mt-3 ${isSanction ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200'} border rounded-lg p-3 text-xs ${isSanction ? 'text-orange-800' : 'text-blue-800'}`}>
                <b>📋 操作說明：</b> 點擊「在 Google 開啟搜尋」，確認結果後用 <b>Ctrl+P（Cmd+P）→ 另存為 PDF</b> 儲存第一頁。
              </div>
            </div>

            <div className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-6 h-6 rounded-full ${isSanction ? 'bg-orange-600' : 'bg-blue-600'} text-white text-xs font-bold flex items-center justify-center`}>2</span>
                <h2 className="text-sm font-bold text-gray-800">上傳搜尋結果 PDF</h2>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 items-start">
                <label className="flex-1 cursor-pointer">
                  <div className={`border-2 border-dashed rounded-lg p-4 text-center transition ${pdfFile ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'}`}>
                    {pdfFile ? (<div className="flex items-center justify-center gap-2"><CheckCircle className="w-5 h-5 text-green-500" /><div className="text-left"><div className="text-sm font-bold text-green-700">{pdfFile.name}</div><div className="text-xs text-green-600">{(pdfFile.size / 1024).toFixed(0)} KB · PDF</div></div></div>) : (<div><div className="text-2xl mb-1">📄</div><div className="text-sm font-bold text-gray-600">點擊上傳 PDF</div><div className="text-xs text-gray-400 mt-0.5">支援 Google 搜尋結果頁面 PDF</div></div>)}
                  </div>
                  <input type="file" accept="application/pdf" onChange={handlePdfUpload} className="hidden" />
                </label>
                {pdfFile && (<button onClick={() => setPdfFile(null)} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 px-2 py-1 border rounded-lg"><XCircle className="w-3 h-3" /> 移除</button>)}
              </div>
            </div>

            <div className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-6 h-6 rounded-full ${isSanction ? 'bg-orange-600' : 'bg-blue-600'} text-white text-xs font-bold flex items-center justify-center`}>3</span>
                <h2 className="text-sm font-bold text-gray-800">AI 分析{isSanction ? '（制裁名單命中）' : ''}</h2>
                {workerUrl.trim() && <span className="text-xs text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200">📰 將自動抓取網頁全文</span>}
              </div>
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1"><label className="text-xs text-gray-500">POE API Key</label><button onClick={() => setShowKeyInput(!showKeyInput)} className="text-xs text-blue-500 hover:underline">{showKeyInput ? '隱藏' : '顯示/修改'}</button></div>
                {showKeyInput ? (<input type="text" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-or-v1-..." className="w-full border-2 rounded-lg px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none" />) : (<div className="border-2 rounded-lg px-3 py-2 text-sm text-gray-400 bg-gray-50 font-mono">{apiKey ? `${apiKey.slice(0, 10)}${'•'.repeat(Math.min(20, apiKey.length - 10))}` : '（未設定）'}</div>)}
                <p className="text-xs text-gray-400 mt-1">使用 <b>Gemini-2.5-Flash</b>（via Poe API）。<a href="https://poe.com/api_key" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline ml-1">取得 Poe API Key →</a></p>
              </div>
              {errorMsg && (<div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{errorMsg}</div>)}
              <button onClick={runAnalysis} disabled={isAnalyzing || !pdfFile || !searchEntity} className={`w-full ${isSanction ? 'bg-orange-600 hover:bg-orange-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white py-2.5 rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2`}>
                {isAnalyzing ? <><Loader className="w-4 h-4 animate-spin" />AI 分析中...</> : <><Brain className="w-4 h-4" />開始 AI {isSanction ? '制裁篩查' : '分析'}</>}
              </button>
            </div>

            {isAnalyzing && (<div className={`${isSanction ? 'bg-orange-50' : 'bg-indigo-50'} rounded-lg p-3`}><div className="flex justify-between text-xs mb-1.5"><span className={`${isSanction ? 'text-orange-700' : 'text-indigo-700'} font-medium`}>{stage}</span><span className={isSanction ? 'text-orange-500' : 'text-indigo-500'}>{progress}%</span></div><div className={`h-2 ${isSanction ? 'bg-orange-100' : 'bg-indigo-100'} rounded-full overflow-hidden`}><div className={`h-full ${isSanction ? 'bg-orange-500' : 'bg-indigo-500'} rounded-full transition-all duration-500`} style={{ width: `${progress}%` }} /></div></div>)}

            {analysisComplete && (<>
              <div className="grid grid-cols-5 gap-2">
                <div className="bg-white rounded-lg border p-3 text-center"><div className="text-xl font-bold text-gray-800">{results.length}</div><div className="text-xs text-gray-500">Total</div></div>
                {Object.entries(CLS_CONFIG).map(([key, c]) => { const Icon = c.icon; return (<div key={key} className={`${c.bg} rounded-lg border ${c.border} p-3 text-center`}><div className={`text-xl font-bold ${c.text}`}>{counts[key]}</div><div className={`text-xs ${c.text} flex items-center justify-center gap-1`}><Icon className="w-3 h-3" />{detectedLang === 'zh' ? c.labelZh : c.label}</div></div>); })}
              </div>
              <div className={`${counts.TRUE_HIT > 0 ? 'bg-red-600' : 'bg-green-600'} rounded-lg p-3 text-white flex items-center justify-between`}>
                <div className="flex items-center gap-2"><Shield className="w-5 h-5" /><span className="font-bold text-sm">{riskLabel}</span><span className="text-lg font-black">{counts.TRUE_HIT > 0 ? 'HIGH RISK' : 'LOW RISK'}</span></div>
                <span className="text-xs opacity-80">{counts.TRUE_HIT > 0 ? riskDescHigh : riskDescLow}</span>
              </div>
              <div className="flex gap-1.5 flex-wrap">{[{ k: 'ALL', l: `全部 (${results.length})` }, ...Object.entries(CLS_CONFIG).map(([k, c]) => ({ k, l: `${detectedLang === 'zh' ? c.labelZh : c.label} (${counts[k]})` }))].map(f => (<button key={f.k} onClick={() => setFilterType(f.k)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${filterType === f.k ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>{f.l}</button>))}</div>
              <div className="space-y-2">{filteredResults.length === 0 ? <div className="text-center py-8 text-sm text-gray-400">無結果</div> : filteredResults.map(r => <ResultCard key={r.rank} r={r} />)}</div>
              <button onClick={() => { setAnalysisComplete(false); setResults([]); setPdfFile(null); setProgress(0); }} className="w-full py-2 rounded-lg text-xs text-gray-500 border border-dashed hover:border-gray-400 hover:text-gray-700">🔄 重新分析（清除結果）</button>
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
            <div className="bg-white rounded-xl border shadow-sm p-5">
              <h2 className="text-sm font-bold text-gray-800 mb-4">🔄 {isSanction ? '制裁篩查' : '搜尋'}流程（含網頁全文抓取）</h2>
              {[
                { n: 1, icon: '📝', t: '輸入實體名稱', d: `系統自動生成 ${isSanction ? '制裁篩查' : 'Google'} 搜尋查詢字串` },
                { n: 2, icon: '🔍', t: '執行 Google 搜尋', d: '點擊連結在 Google 搜尋，確認搜尋結果' },
                { n: 3, icon: '📄', t: '儲存為 PDF', d: '使用 Ctrl+P → 另存為 PDF' },
                { n: 4, icon: '⬆️', t: '上傳 PDF', d: '在步驟 2 上傳剛儲存的 PDF 文件' },
                { n: 5, icon: '📰', t: '網頁全文抓取（自動）', d: '若已設定 Worker，系統自動從 PDF 中提取外部 URL，透過 /api/scrape 抓取每個網頁的實際內容' },
                { n: 6, icon: '🤖', t: `AI 分析（${isSanction ? '制裁名單命中' : '基於全文'}）`, d: isSanction ? '將 PDF snippet + 網頁全文合併，AI 基於完整內容判斷是否命中制裁名單' : '將 PDF snippet + 網頁全文合併為 enrichedContent，AI 基於完整內容分析分類' },
                { n: 7, icon: '🛡️', t: '後處理自動降級', d: '信心度 < 75% 或無匹配關鍵字的 TRUE_HIT 自動降為 IRRELEVANT_MLTF' },
                { n: 8, icon: '📊', t: '顯示分類結果', d: '按 True Hit / False Hit / Irrelevant / No Hit 分類展示' }
              ].map(s => (<div key={s.n} className="flex items-start gap-3 pb-3 mb-3 border-b last:border-0"><div className={`w-8 h-8 rounded-lg ${isSanction ? 'bg-orange-100 text-orange-700' : 'bg-indigo-100 text-indigo-700'} flex items-center justify-center text-sm font-bold shrink-0`}>{s.n}</div><div><div className="flex items-center gap-1.5"><span>{s.icon}</span><span className="font-bold text-gray-800 text-sm">{s.t}</span></div><p className="text-xs text-gray-600 mt-0.5">{s.d}</p></div></div>))}
            </div>
          </div>
        )}

          {activeTab === 'keywords' && (
          <div className="space-y-4">
            {isSanction ? (
              /* ── 制裁篩查：3 Parts × 3 Languages ── */
              <>
                {['part1', 'part2', 'part3'].map((p, idx) => {
                  const en  = [SANCTION_EN_PART1, SANCTION_EN_PART2, SANCTION_EN_PART3][idx];
                  const tw  = [SANCTION_ZH_TW_PART1, SANCTION_ZH_TW_PART2, SANCTION_ZH_TW_PART3][idx];
                  const cn  = [SANCTION_ZH_CN_PART1, SANCTION_ZH_CN_PART2, SANCTION_ZH_CN_PART3][idx];
                  return (
                    <div key={p} className="bg-white rounded-xl border shadow-sm p-5">
                      <h2 className="text-sm font-bold text-orange-700 mb-3">
                        Part {idx + 1} — {en.length} countries
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <h3 className="text-xs font-bold text-blue-700 mb-2">🇬🇧 English</h3>
                          <div className="flex flex-wrap gap-1.5">
                            {en.map((kw, i) => (
                              <span key={i} className="bg-orange-50 text-orange-700 border-orange-200 border px-2 py-1 rounded-lg text-xs">{kw}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-red-700 mb-2">🇹🇼 繁體中文</h3>
                          <div className="flex flex-wrap gap-1.5">
                            {tw.map((kw, i) => (
                              <span key={i} className="bg-red-50 text-red-700 border-red-200 border px-2 py-1 rounded-lg text-xs">{kw}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-green-700 mb-2">🇨🇳 简体中文</h3>
                          <div className="flex flex-wrap gap-1.5">
                            {cn.map((kw, i) => (
                              <span key={i} className="bg-green-50 text-green-700 border-green-200 border px-2 py-1 rounded-lg text-xs">{kw}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-xs text-orange-700">
                  📊 <b>合計：</b>
                  Part 1 = {SANCTION_EN_PART1.length} | 
                  Part 2 = {SANCTION_EN_PART2.length} | 
                  Part 3 = {SANCTION_EN_PART3.length} | 
                  <b>Total = {SANCTION_EN_PART1.length + SANCTION_EN_PART2.length + SANCTION_EN_PART3.length} countries</b>
                </div>
              </>
            ) : (
              /* ── Adverse Media：原有關鍵字顯示 ── */
              <div className="bg-white rounded-xl border shadow-sm p-5">
                <h2 className="text-sm font-bold text-gray-800 mb-2">🔑 搜尋關鍵字</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-blue-700 mb-2">🇬🇧 English Keywords ({EN_KEYWORDS.length})</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {EN_KEYWORDS.map((kw, i) => (
                        <span key={i} className="bg-blue-50 text-blue-700 border-blue-200 border px-2 py-1 rounded-lg text-xs">{kw}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-red-700 mb-2">🇨🇳 中文關鍵字 ({ZH_KEYWORDS.length})</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {ZH_KEYWORDS.map((kw, i) => (
                        <span key={i} className="bg-red-50 text-red-700 border-red-200 border px-2 py-1 rounded-lg text-xs">{kw}</span>
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
function AdverseMediaScreening({ entityName }) {
  return <ScreeningModule entityName={entityName} mode="adverseMedia" />;
}

function SanctionScreening({ entityName }) {
  return <ScreeningModule entityName={entityName} mode="sanction" />;
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
  const [dragMode, setDragMode] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState('list');
  const [mobileSideOpen, setMobileSideOpen] = useState(false);
  const [dragState, setDragState] = useState(null);
  const [entityFilter, setEntityFilter] = useState('');
  const [modalType, setModalType] = useState(null);
  const [modalData, setModalData] = useState({});
  const [settingsTab, setSettingsTab] = useState('weights');
  const [showSnapCompare, setShowSnapCompare] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [snapDescInput, setSnapDescInput] = useState('');
  const [expandedCDD, setExpandedCDD] = useState(null);
  const svgRef = useRef(null);

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

  const getRelPercentage = useCallback((rel) => {
    if (rel.shares != null && rel.shares > 0) { const target = entities.find(e => e.id === rel.targetId); if (target?.totalShares > 0) return Math.round((rel.shares / target.totalShares) * 10000) / 100; }
    return rel.percentage;
  }, [entities]);

  function getOwnershipDepth(eid, visited = new Set()) {
    if (visited.has(eid)) return 0; visited.add(eid);
    const ch = relationships.filter(r => r.sourceId === eid && (r.type === 'ownership' || r.type === 'control'));
    return ch.length === 0 ? 0 : 1 + Math.max(...ch.map(c => getOwnershipDepth(c.targetId, visited)));
  }

  const isAutoHighRisk = (entity) => AUTO_HIGH_RISK_SUBTYPES.includes(entity.subType);
  const isSddEligible = (entity) => entity.type === 'company' && SDD_ELIGIBLE_CATEGORIES.includes(entity.companyCategory);
  const getCategoryLabel = (cat) => { const map = { private: t.catPrivate, listed: t.catListed, government: t.catGovernment, stateOwned: t.catStateOwned }; return map[cat] || cat || ''; };

  const wouldCreateCycle = useCallback((sourceId, targetId, excludeRelId = null) => {
    const visited = new Set();
    const queue = [targetId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === sourceId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      relationships.filter(r => r.sourceId === current && (r.type === 'ownership' || r.type === 'control') && r.id !== excludeRelId)
        .forEach(r => queue.push(r.targetId));
    }
    return false;
  }, [relationships]);

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
    if (isAutoHighRisk(entity)) return { score: 100, rating: 'High', breakdown: { jurisdiction: 100, pep: 0, sanctions: 100, negativeNews: 0, entityType: 100, ownership: 100 }, autoHighRisk: true, jurisdictionForced: false, sanctionForced: false, pepForced: false };
    const w = settings.weights;
    let jScore = settings.highRisk.includes(entity.jurisdiction) ? 100 : settings.offshore.includes(entity.jurisdiction) ? 80 : settings.monitored.includes(entity.jurisdiction) ? 50 : 15;
    const pepScore = entity.isPEP ? 100 : 0;
    const sanctScore = entity.isSanctioned ? 100 : 0;
    const newsScore = entity.negativeNews ? 85 : 0;
    let typeScore = ['Trust', 'Foundation', 'SPV'].includes(entity.subType) ? 85 : ['Holding Company', 'Shell Company'].includes(entity.subType) ? 60 : entity.subType === 'Trading Company' ? 35 : 20;
    const depth = getOwnershipDepth(entity.id);
    let ownScore = Math.min(100, depth * 30);
    const total = w.jurisdiction + w.pep + w.sanctions + w.negativeNews + w.entityType + w.ownership;
    const score = total > 0 ? Math.round((jScore * w.jurisdiction + pepScore * w.pep + sanctScore * w.sanctions + newsScore * w.negativeNews + typeScore * w.entityType + ownScore * w.ownership) / total) : 0;
    const rOrder = { Low: 0, Medium: 1, High: 2 };
    let minRating = 'Low';
    if (settings.highRisk.includes(entity.jurisdiction)) minRating = 'High';
    else if (settings.offshore.includes(entity.jurisdiction)) minRating = 'Medium';
    else if (settings.monitored.includes(entity.jurisdiction)) minRating = 'Medium';
    let rating = score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low';
    const rawRating = rating;
    if (rOrder[minRating] > rOrder[rating]) rating = minRating;
    if (entity.isSanctioned) return { score: 100, rating: 'High', breakdown: { jurisdiction: jScore, pep: pepScore, sanctions: 100, negativeNews: newsScore, entityType: typeScore, ownership: ownScore }, autoHighRisk: false, sanctionForced: true, jurisdictionForced: false, pepForced: false };
    let pepForced = false;
    if (entity.isPEP && rating !== 'High') { pepForced = true; rating = 'High'; }
    return { score, rating, breakdown: { jurisdiction: jScore, pep: pepScore, sanctions: sanctScore, negativeNews: newsScore, entityType: typeScore, ownership: ownScore }, autoHighRisk: false, jurisdictionForced: rOrder[minRating] > rOrder[rawRating], pepForced };
  }, [entities, relationships, settings]);

  const getEffectiveRating = (entity) => { const crr = calcCRR(entity); if (crr.autoHighRisk) return { ...crr, overridden: false }; if (crr.pepForced) return { ...crr, overridden: false }; return entity.riskOverride ? { ...crr, rating: entity.riskOverride.rating, overridden: true } : { ...crr, overridden: false }; };

  const findUBOs = useCallback((targetId, threshold) => {
    const po = {};
    const trace = (curId, mult, chain, vis) => {
      if (vis.has(curId)) return;
      vis.add(curId);
      relationships.filter(r => r.targetId === curId && r.type === 'ownership').forEach(rel => {
        const owner = entities.find(e => e.id === rel.sourceId);
        if (!owner) return;
        const pct = getRelPercentage(rel);
        if (pct == null || pct <= 0) return;
        const em = mult * pct / 100;
        const ep = em * 100;
        if (owner.type === 'person') {
          if (!po[owner.id]) po[owner.id] = { entity: owner, totalPct: 0, paths: [] };
          po[owner.id].totalPct += ep;
          po[owner.id].paths.push({ percentage: Math.round(ep * 100) / 100, chain: [owner.name, ...chain], direct: chain.length === 0, viaControl: false, controlPct: null });
        } else { trace(owner.id, em, [owner.name, ...chain], new Set(vis)); }
      });
      relationships.filter(r => r.targetId === curId && r.type === 'control').forEach(rel => {
        const controller = entities.find(e => e.id === rel.sourceId);
        if (!controller) return;
        const ctrlPct = (rel.percentage != null && rel.percentage > 0) ? rel.percentage : 0;
        if (ctrlPct === 0) {
          if (controller.type === 'person') {
            if (!po[controller.id]) po[controller.id] = { entity: controller, totalPct: 0, paths: [] };
            po[controller.id].paths.push({ percentage: 0, chain: [controller.name, ...chain], direct: chain.length === 0, viaControl: true, controlPct: 100 });
          } else { trace(controller.id, mult, [controller.name, ...chain], new Set(vis)); }
          return;
        }
        const em = mult * ctrlPct / 100;
        const ep = em * 100;
        if (controller.type === 'person') {
          if (!po[controller.id]) po[controller.id] = { entity: controller, totalPct: 0, paths: [] };
          po[controller.id].totalPct += ep;
          po[controller.id].paths.push({ percentage: Math.round(ep * 100) / 100, chain: [controller.name, ...chain], direct: chain.length === 0, viaControl: true, controlPct: ctrlPct });
        } else { trace(controller.id, em, [controller.name, ...chain], new Set(vis)); }
      });
    };
    trace(targetId, 1, [], new Set());
    return Object.values(po)
      .filter(({ totalPct, paths }) => Math.round(totalPct * 100) / 100 >= threshold || paths.some(p => p.viaControl && p.controlPct >= 25))
      .map(({ entity, totalPct, paths }) => {
        const hd = paths.some(p => p.direct); const hi = paths.some(p => !p.direct); const hasControl = paths.some(p => p.viaControl);
        return { entity, percentage: Math.round(totalPct * 100) / 100, path: paths[0].chain, paths, direct: hd && !hi, mixed: hd && hi, viaControl: hasControl };
      });
  }, [entities, relationships, getRelPercentage]);

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
    const headers = ['Name', 'Type', 'SubType', 'Category', 'Jurisdiction', 'Risk Rating', 'CRR Score', 'PEP', 'Sanctioned', 'Last Review', 'Next Review', 'DD Level'];
    const rows = entities.map(e => { const r = getEffectiveRating(e); return [e.name, e.type, e.subType, getCategoryLabel(e.companyCategory), e.jurisdiction, r.rating, r.score, e.isPEP, e.isSanctioned, e.lastReviewDate, e.nextReviewDate, getDDLevel(e).toUpperCase()]; });
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `kyc_entities_${today}.csv`; a.click(); URL.revokeObjectURL(url);
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
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-sm">
        <div className="text-6xl mb-4">🏗️</div>
        <h3 className="text-lg font-bold text-gray-700 mb-2">{t.emptyStateTitle}</h3>
        <p className="text-sm text-gray-500 mb-6">{t.emptyStateDesc}</p>
        <div className="flex flex-col gap-3 items-center">
          <button onClick={() => openModal('addEntity', { name: '', type: 'company', subType: '', jurisdiction: 'USA', totalShares: '', companyCategory: 'private' })} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium shadow-sm hover:bg-blue-700 w-full">{t.addEntity}</button>
          <button onClick={loadSampleData} className="bg-white border-2 border-dashed border-gray-300 text-gray-600 px-5 py-2.5 rounded-xl text-sm font-medium hover:border-blue-400 hover:text-blue-600 w-full"><div>{t.loadSample}</div><div className="text-xs text-gray-400 mt-0.5">{t.loadSampleDesc}</div></button>
        </div>
      </div>
    </div>
  ), [t, lang]);

  const SDDBanner = ({ entity }) => { if (!isSddEligible(entity)) return null; return (<div className="bg-cyan-50 border border-cyan-300 rounded-lg p-3 flex items-start gap-2"><span className="text-lg shrink-0">🔵</span><div><div className="text-xs font-bold text-cyan-800">SDD</div><div className="text-xs text-cyan-700 mt-0.5">{t.sddEligible.replace('{type}', getCategoryLabel(entity.companyCategory))}</div></div></div>); };
  const AutoHighRiskBanner = ({ entity }) => { if (!isAutoHighRisk(entity)) return null; return (<div className="bg-red-50 border border-red-300 rounded-lg p-3 flex items-start gap-2"><span className="text-lg shrink-0">🔴</span><div><div className="text-xs font-bold text-red-800">{t.annualReview}</div><div className="text-xs text-red-700 mt-0.5">{t.autoHighRiskNotice.replace('{subType}', entity.subType)}</div></div></div>); };
  const EDDBanner = ({ entity }) => { if (isSddEligible(entity) || isAutoHighRisk(entity)) return null; const eff = getEffectiveRating(entity); if (eff.rating !== 'High') return null; return (<div className="bg-orange-50 border border-orange-300 rounded-lg p-3 flex items-start gap-2"><span className="text-lg shrink-0">🟠</span><div><div className="text-xs font-bold text-orange-800">EDD</div><div className="text-xs text-orange-700 mt-0.5">{t.eddRequired}</div></div></div>); };

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
    const KPI = ({ label, value, color, sub }) => (<div className="bg-white rounded-xl shadow-sm border p-3"><div className="text-xs text-gray-500">{label}</div><div className={`text-xl font-bold ${color || 'text-gray-800'} mt-1`}>{value}</div>{sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}</div>);
    return (<div>
      <div className="flex items-center justify-between mb-3"><h2 className="text-lg font-bold text-gray-800">{t.dashboard}</h2><div className="flex gap-2"><button onClick={exportCSV} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-green-700">{t.exportCSV}</button><button onClick={() => openModal('confirmClearAll')} className="text-xs text-gray-400 hover:text-red-500">{t.clearAll}</button></div></div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <KPI label={t.totalEntities} value={entities.length} sub={`${entities.filter(e => e.type === 'company').length} ${t.companies}, ${entities.filter(e => e.type === 'person').length} ${t.persons}`} />
        <KPI label={t.highRisk} value={riskDist.High} color="text-red-600" sub={t.entitiesRatedHigh} />
        <KPI label={t.overdueReviews} value={overdue} color={overdue > 0 ? 'text-orange-600' : 'text-green-600'} />
        <KPI label={t.expiredDocs} value={expDocCnt} color={expDocCnt > 0 ? 'text-amber-600' : 'text-green-600'} />
        <KPI label={t.strFlagged} value={entities.filter(e => e.str?.flagged).length} />
        <KPI label={t.dueDiligenceLevel} value={`S:${ddDist.SDD} C:${ddDist.CDD} E:${ddDist.EDD}`} sub="SDD / CDD / EDD" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="bg-white rounded-xl shadow-sm border p-3"><h3 className="text-xs font-semibold text-gray-600 mb-1">{t.riskDistribution}</h3><ResponsiveContainer width="100%" height={150}><PieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" label={({ name, value }) => `${name}:${value}`}>{pieData.map((e, i) => <Cell key={i} fill={RISK_COLORS[e.key] || PIE_COLORS[i]} />)}</Pie></PieChart></ResponsiveContainer></div>
        <div className="bg-white rounded-xl shadow-sm border p-3"><h3 className="text-xs font-semibold text-gray-600 mb-1">{t.entityTypes}</h3><ResponsiveContainer width="100%" height={150}><BarChart data={barData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 8 }} /><YAxis /><Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border p-3 mb-4"><h3 className="text-xs font-semibold text-gray-600 mb-1">{t.avgRiskScoreTrend}</h3><ResponsiveContainer width="100%" height={130}><LineChart data={trendData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 9 }} /><YAxis domain={[0, 100]} /><RTooltip /><Line type="monotone" dataKey="avgScore" stroke="#ef4444" strokeWidth={2} /></LineChart></ResponsiveContainer></div>
      <div className="bg-white rounded-xl shadow-sm border p-3"><h3 className="text-xs font-semibold text-gray-600 mb-2">{t.autoTodos} ({autoTodos.length})</h3><div className="space-y-1 max-h-48 overflow-y-auto">{autoTodos.map(td => (<div key={td.id} className="flex items-center gap-2 p-1.5 rounded bg-gray-50 hover:bg-gray-100 cursor-pointer text-xs" onClick={() => { setSelectedId(td.entityId); setDetailTab('overview'); setView('workspace'); }}><PriorityDot p={td.priority} /><span className="flex-1 text-gray-700">{td.text}</span><span className="text-gray-400 text-xs px-1.5 py-0.5 bg-gray-200 rounded">{td.type}</span></div>))}{autoTodos.length === 0 && <div className="text-xs text-gray-400 text-center py-3">{t.noPendingTodos}</div>}</div></div>
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
      { label: t.editEntity, action: (id) => { const ent = entities.find(e => e.id === id); if (ent) openModal('editEntity', { ...ent, totalShares: ent.totalShares != null ? String(ent.totalShares) : '' }); } },
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
            <div className="p-2 border-b flex items-center justify-between shrink-0">
              <span className="text-sm font-bold text-gray-700">{t.entityList} ({entities.length})</span>
              <div className="flex gap-1">
                <button onClick={() => openModal('addEntity', { name: '', type: 'company', subType: '', jurisdiction: 'USA', totalShares: '', companyCategory: 'private' })} className="bg-blue-600 text-white px-2 py-1 rounded text-xs">{t.addEntity}</button>
                <button onClick={exportCSV} className="text-xs text-gray-400 hover:text-green-600 px-1" title={t.exportCSV}>📥</button>
              </div>
            </div>
            <div className="px-2 py-1.5 border-b shrink-0"><input value={entityFilter} onChange={e => setEntityFilter(e.target.value)} placeholder={t.filterPlaceholder} className="w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-400 focus:outline-none" /></div>
            {batchSelected.size > 0 && (<div className="px-2 py-2 bg-blue-50 border-b shrink-0"><div className="flex items-center justify-between mb-1.5"><span className="text-xs text-blue-700 font-bold">{batchSelected.size} {t.selected}</span><button onClick={() => setBatchSelected(new Set())} className="text-xs text-gray-400 hover:text-gray-600">✕ {t.clear}</button></div><div className="flex gap-1 flex-wrap">{batchSelected.size === 1 && <button onClick={() => { const id = [...batchSelected][0]; const ent = entities.find(e => e.id === id); if (ent) openModal('editEntity', { ...ent, totalShares: ent.totalShares != null ? String(ent.totalShares) : '' }); }} className="text-xs bg-white border border-blue-300 text-blue-700 px-2 py-1 rounded hover:bg-blue-100 font-medium">{t.editEntity}</button>}{batchSelected.size > 1 && <button onClick={() => openModal('batchEdit', { jurisdiction: '', subType: '' })} className="text-xs bg-white border border-blue-300 text-blue-700 px-2 py-1 rounded hover:bg-blue-100 font-medium">{t.batchEdit}</button>}<button onClick={() => openModal('confirmDeleteBatch')} className="text-xs bg-white border border-red-300 text-red-600 px-2 py-1 rounded hover:bg-red-50 font-medium">{t.deleteSelected}</button><button onClick={() => openModal('batchReview', { date: '' })} className="text-xs bg-white border border-gray-300 text-gray-600 px-2 py-1 rounded hover:bg-gray-100">{t.batchReview}</button></div></div>)}
            <div className="px-2 py-1 border-b bg-gray-50 flex items-center gap-2 shrink-0"><input type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }} onChange={toggleAll} className="shrink-0" /><span className="text-xs text-gray-500 font-medium">{t.selectAll}</span></div>
            <div className="flex-1 overflow-y-auto">
              {filteredEntities.map(ent => {
                const r = getEffectiveRating(ent); const isActive = dagSelected === ent.id; const isChecked = batchSelected.has(ent.id);
                const cddCount = (ent.cddRecords || []).length; const autoHR = isAutoHighRisk(ent);
                return (<div key={ent.id} className={`flex items-center gap-1.5 px-2 py-2 border-b border-gray-50 cursor-pointer hover:bg-blue-50 transition-colors ${isActive ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''} ${isChecked ? 'bg-blue-50/50' : ''}`} onClick={() => setDagSelected(ent.id === dagSelected ? null : ent.id)} onDoubleClick={() => { setSelectedId(ent.id); setDetailTab('overview'); }}>
                  <input type="checkbox" checked={isChecked} onChange={() => toggleBatch(ent.id)} onClick={e => e.stopPropagation()} className="shrink-0" />
                  <span className="text-sm shrink-0">{ent.type === 'person' ? '👤' : '🏢'}</span>
                  <div className="flex-1 min-w-0"><div className="text-xs font-medium text-gray-800 truncate">{ent.name}</div><div className="text-xs text-gray-400 truncate">{ent.subType}{ent.companyCategory && ent.type === 'company' ? ` · ${getCategoryLabel(ent.companyCategory)}` : ''} · {ent.jurisdiction}{cddCount > 0 ? ` · ${cddCount}${t.cddRecordCount}` : ''}</div></div>
                  <div className="shrink-0 flex items-center gap-1">
                    {autoHR && <span className="text-xs" title={t.annualReview}>🔒</span>}
                    <DDLevelBadge entity={ent} />
                    {ent.isPEP && <span className="w-2 h-2 rounded-full bg-purple-500" title={`PEP${ent.pepCategory ? ` - ${pepCategories.find(c => c.v === ent.pepCategory)?.l || ent.pepCategory}` : ''}`} />}
                    {ent.str?.flagged && <span className="w-2 h-2 rounded-full bg-red-500" title="STR" />}
                    <span className={`w-2.5 h-2.5 rounded-full ${r.rating === 'High' ? 'bg-red-500' : r.rating === 'Medium' ? 'bg-amber-500' : 'bg-green-500'}`} />
                  </div>
                </div>);
              })}
            </div>
          </div>
          <div className={`flex-1 flex-col bg-white rounded-xl border overflow-hidden ${workspaceTab === 'list' ? 'hidden md:flex' : 'flex'}`}>
            <div className="p-2 border-b flex items-center gap-2 shrink-0 flex-wrap">
              <span className="text-sm font-bold text-gray-700">{t.structureDiagram}</span><div className="flex-1" />
              <button onClick={() => setDragMode(!dragMode)} className={`px-2 py-1 rounded text-xs font-medium ${dragMode ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'}`}>{dragMode ? t.dragModeOn : t.dragMode}</button>
              <button onClick={() => openModal('addRel', { sourceId: '', targetId: '', type: 'ownership', percentage: '', shares: '', description: '', inputMode: 'shares' })} className="bg-blue-600 text-white px-2 py-1 rounded text-xs">{t.addRelationship}</button>
              {dagSelected && <button onClick={() => setDagSelected(null)} className="bg-gray-200 text-gray-600 px-2 py-1 rounded text-xs">{t.clearSelection}</button>}
            </div>
            <div className="flex-1 overflow-auto relative" onClick={() => setContextMenu(null)}>
              <svg ref={svgRef} width={W} height={Math.max(H, 350)}
                onMouseMove={e => { if (dragState && svgRef.current) { const rect = svgRef.current.getBoundingClientRect(); setDragState(prev => prev ? { ...prev, mx: e.clientX - rect.left, my: e.clientY - rect.top } : null); } }}
                onMouseUp={() => setDragState(null)}>
                <defs>
                  <marker id="arr" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto"><path d="M0,0 L10,3 L0,6 Z" fill="#94a3b8" /></marker>
                  <marker id="arrH" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto"><path d="M0,0 L10,3 L0,6 Z" fill="#3b82f6" /></marker>
                  <marker id="arrR" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto"><path d="M0,0 L10,3 L0,6 Z" fill="#a855f7" /></marker>
                </defs>
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
                  return (<g key={ent.id} opacity={dim ? 0.15 : 1} style={{ cursor: dragMode ? 'crosshair' : 'pointer' }}
                    onClick={e => { e.stopPropagation(); if (!dragMode) setDagSelected(ent.id === dagSelected ? null : ent.id); }}
                    onDoubleClick={() => { setSelectedId(ent.id); setDetailTab('overview'); }}
                    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, entityId: ent.id }); }}
                    onMouseDown={e => { if (dragMode && svgRef.current) { const rect = svgRef.current.getBoundingClientRect(); setDragState({ sourceId: ent.id, mx: e.clientX - rect.left, my: e.clientY - rect.top }); } }}
                    onMouseUp={() => { if (dragState && dragState.sourceId !== ent.id) { openModal('addRel', { sourceId: dragState.sourceId, targetId: ent.id, type: 'ownership', percentage: '', shares: '', description: '', inputMode: 'shares' }); setDragState(null); } }}>
                    {ent.type === 'person' ? <circle cx={pos.x + 65} cy={pos.y + 20} r={22} fill={fill} stroke={border} strokeWidth={sel ? 3 : 2} /> : <rect x={pos.x} y={pos.y} width={130} height={40} rx={6} fill={fill} stroke={border} strokeWidth={sel ? 3 : 2} />}
                    <text x={pos.x + 65} y={ent.type === 'person' ? pos.y + 24 : pos.y + 17} textAnchor="middle" fontSize="9" fontWeight="600" fill="#1e293b">{ent.name.length > 15 ? ent.name.slice(0, 14) + '…' : ent.name}</text>
                    <text x={pos.x + 65} y={ent.type === 'person' ? pos.y + 36 : pos.y + 30} textAnchor="middle" fontSize="7" fill="#64748b">{ent.jurisdiction}{isSddEligible(ent) ? ' 🔵' : ''}</text>
                    {ent.isPEP && <circle cx={pos.x + (ent.type === 'person' ? 88 : 126)} cy={pos.y + 4} r={5} fill="#a855f7" stroke="white" strokeWidth="1.5" />}
                    {isAutoHighRisk(ent) && <circle cx={pos.x + (ent.type === 'person' ? 42 : 4)} cy={pos.y + 4} r={5} fill="#ef4444" stroke="white" strokeWidth="1.5" />}
                  </g>);
                })}
                {dragState && dragState.mx && <line x1={positions[dragState.sourceId]?.x + 65} y1={positions[dragState.sourceId]?.y + 20} x2={dragState.mx} y2={dragState.my} stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 3" />}
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

        {detailTab === 'overview' && (<div className="space-y-3 mb-2"><SDDBanner entity={ent} /><AutoHighRiskBanner entity={ent} /><EDDBanner entity={ent} /></div>)}

        {detailTab === 'cdd' && (<div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2"><h3 className="text-sm font-bold text-gray-700">📋 {t.cddHistory}</h3><button onClick={() => openModal('saveCDD', { reviewer: '', type: 'periodic', status: 'completed', summary: '' })} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-indigo-700 shadow-sm">{t.saveCDD}</button></div>
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-xs text-indigo-700">{t.cddTip}</div>
          {cddRecords.length > 0 ? (<div className="relative pl-6 border-l-2 border-indigo-200 space-y-4">{[...cddRecords].reverse().map((rec, idx) => { const isExpanded = expandedCDD === rec.id; return (<div key={rec.id} className="relative"><div className="absolute -left-8 top-2 w-4 h-4 rounded-full bg-indigo-500 border-2 border-white shadow flex items-center justify-center text-white" style={{ fontSize: '8px' }}>{cddRecords.length - idx}</div><div className={`rounded-xl border ${isExpanded ? 'border-indigo-300 shadow-md' : 'border-gray-200'} overflow-hidden`}><div className={`p-3 ${isExpanded ? 'bg-indigo-50' : 'bg-white hover:bg-gray-50'}`}><div className="flex items-center gap-2 mb-1.5 flex-wrap"><span className="text-base">{cddTypeIcon[rec.type] || '📋'}</span><span className="font-bold text-sm text-gray-800">{cddTypes.find(c => c.v === rec.type)?.l || rec.type}</span><BadgeC color={cddStatusColor[rec.status] || 'gray'}>{cddStatuses.find(c => c.v === rec.status)?.l || rec.status}</BadgeC><span className="text-xs text-gray-400 ml-auto">{rec.date}</span></div><div className="flex items-center gap-2 text-xs text-gray-500 mb-1.5"><span>👤 {rec.reviewer}</span><span>·</span><span>{t.cddRiskScore}: <span className="font-bold" style={{ color: RISK_COLORS[rec.snapshot.riskRating] }}>{rec.snapshot.riskScore}</span></span><span>·</span><RiskBadge rating={rec.snapshot.riskRating} label={tR(rec.snapshot.riskRating)} /></div>{rec.summary && <div className="text-xs text-gray-600 bg-white rounded p-2 border border-gray-100">{rec.summary}</div>}<div className="flex gap-2 mt-2"><button onClick={() => setExpandedCDD(isExpanded ? null : rec.id)} className={`text-xs px-2.5 py-1 rounded font-medium ${isExpanded ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600 hover:bg-indigo-100'}`}>{isExpanded ? t.cddHideDetails : t.cddViewDetails}</button><button onClick={() => openModal('confirmRestoreCDD', { recordId: rec.id })} className="text-xs px-2.5 py-1 rounded font-medium bg-amber-100 text-amber-700 hover:bg-amber-200">{t.cddRestore}</button></div></div>{isExpanded && (<div className="border-t border-indigo-200 p-3 bg-white space-y-3"><div className="text-xs font-semibold text-indigo-700 mb-1">{t.cddCompareTitle}</div><CDDCompareTable ent={ent} snapshot={rec.snapshot} /><button onClick={() => openModal('confirmRestoreCDD', { recordId: rec.id })} className="w-full bg-amber-500 text-white py-2 rounded-lg text-xs font-bold hover:bg-amber-600 mt-2">{t.cddRestore}</button></div>)}</div></div>); })}</div>) : (<div className="text-center py-10"><div className="text-5xl mb-3">📋</div><div className="text-sm text-gray-500 mb-4">{t.noCDDRecords}</div><button onClick={() => openModal('saveCDD', { reviewer: '', type: 'initial', status: 'completed', summary: '' })} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium">{t.saveCDD}</button></div>)}
        </div>)}

        {detailTab === 'overview' && (<div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-xs text-gray-400">{t.type}</span><div className="font-medium text-sm">{ent.subType || ent.type}{ent.type === 'company' && ent.companyCategory ? ` · ${getCategoryLabel(ent.companyCategory)}` : ''}</div></div>
            <div><span className="text-xs text-gray-400">{t.jurisdiction}</span><div className="font-medium text-sm">{ent.jurisdiction}</div></div>
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
          <AdverseMediaScreening key={`ams-${ent.id}`} entityName={ent.name} />
        </div>

        {/* ✅ NEW: Sanction Screening Tab */}
        <div className={detailTab === 'sanctionScreening' ? 'pb-2' : 'hidden'}>
          <SanctionScreening key={`ss-${ent.id}`} entityName={ent.name} />
        </div>

        {detailTab === 'documents' && (<div>
          <div className="flex items-center justify-between mb-2"><div className="text-xs text-gray-500">{t.completion}: <span className={`font-bold ${docComp === 100 ? 'text-green-600' : 'text-amber-600'}`}>{docComp}%</span></div><button onClick={() => openModal('addDoc', { name: '', expiry: '' })} className="bg-blue-600 text-white px-2 py-1 rounded text-xs">{t.addDocument}</button></div>
          <div className="w-full bg-gray-200 rounded-full h-1.5 mb-3"><div className="h-1.5 rounded-full bg-green-500" style={{ width: `${docComp}%` }} /></div>
          {isSddEligible(ent) && <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-2 mb-3 text-xs text-cyan-700">🔵 SDD</div>}
          <div className="space-y-1.5">{ent.documents.map(d => (<div key={d.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg"><span>{d.status === 'received' ? '✅' : d.status === 'expired' ? '❌' : '⏳'}</span><div className="flex-1"><div className="text-xs font-medium text-gray-700">{d.name}</div>{d.expiry && <div className={`text-xs ${d.expiry < today ? 'text-red-500' : isExpiringIn30(d.expiry) ? 'text-amber-500 font-medium' : 'text-gray-400'}`}>{t.expiry}: {d.expiry} {isExpiringIn30(d.expiry) ? ` ⚠️` : ''}</div>}</div><select value={d.status} onChange={e => { updateEntity(ent.id, { documents: ent.documents.map(dd => dd.id === d.id ? { ...dd, status: e.target.value } : dd) }); }} className="text-xs border rounded px-1.5 py-0.5"><option value="pending">{t.pending}</option><option value="received">{t.received}</option><option value="expired">{t.expired}</option><option value="not_applicable">{t.notApplicable}</option></select><button onClick={() => updateEntity(ent.id, { documents: ent.documents.filter(dd => dd.id !== d.id) })} className="text-red-400 hover:text-red-600 text-xs">✕</button></div>))}{ent.documents.length === 0 && <div className="text-xs text-gray-400 text-center py-4">{t.noDocsYet}</div>}</div>
        </div>)}

        {detailTab === 'screening' && (<div>
          <div className="flex justify-between items-center mb-2"><span className="text-xs font-semibold text-gray-700">{t.screeningHistory}</span><button onClick={() => openModal('addScreen', { system: 'World-Check', type: 'Sanctions', result: 'Clear' })} className="bg-blue-600 text-white px-2 py-1 rounded text-xs">{t.addRecord}</button></div>
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
      {(d.type || 'company') === 'company' && (<div className="bg-blue-50 rounded-lg p-3"><FormField label={t.totalSharesLabel}><input type="number" value={d.totalShares || ''} onChange={e => setD('totalShares', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" /></FormField></div>)}
      <button onClick={() => { if (!d.name) { setD('_touched', true); return; } const isAHR = AUTO_HIGH_RISK_SUBTYPES.includes(d.subType); const nextReview = isAHR ? new Date(new Date().getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : ''; setEntities(prev => [...prev, { id: gid(), name: d.name, type: d.type || 'company', subType: d.subType || '', companyCategory: (d.type || 'company') === 'company' ? (d.companyCategory || 'private') : null, jurisdiction: d.jurisdiction || 'USA', totalShares: d.totalShares ? parseInt(d.totalShares) : null, isPEP: false, pepCategory: '', isSanctioned: false, negativeNews: false, riskOverride: null, riskHistory: [{ date: today, score: 0, rating: 'Low' }], lastReviewDate: today, nextReviewDate: nextReview, documents: [], screeningLogs: [], str: null, notes: [], cddRecords: [] }]); closeModal(); }} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium mt-2">{t.addEntity}</button>
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
      {(d.type || 'company') === 'company' && (<div className="bg-blue-50 rounded-lg p-3"><FormField label={t.totalSharesLabel}><input type="number" value={d.totalShares != null ? d.totalShares : ''} onChange={e => setD('totalShares', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" /></FormField></div>)}
      <button onClick={() => { if (!d.name || !d.id) return; const isAHR = AUTO_HIGH_RISK_SUBTYPES.includes(d.subType); const up = { name: d.name, type: d.type, subType: d.subType || '', companyCategory: (d.type || 'company') === 'company' ? (d.companyCategory || 'private') : null, jurisdiction: d.jurisdiction, totalShares: d.totalShares ? parseInt(d.totalShares) : null }; if (isAHR) { const ent = entities.find(e => e.id === d.id); if (ent && !ent.nextReviewDate) up.nextReviewDate = new Date(new Date().getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); } updateEntity(d.id, up); closeModal(); }} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium mt-2">{t.saveChanges}</button>
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
      <div className="grid grid-cols-2 gap-3"><FormField label={t.system}><select value={d.system || 'World-Check'} onChange={e => setD('system', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">{['World-Check', 'Dow Jones', 'ComplyAdvantage', 'LexisNexis'].map(s => <option key={s}>{s}</option>)}</select></FormField><FormField label={t.screenType}><select value={d.type || 'Sanctions'} onChange={e => setD('type', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">{['Sanctions', 'PEP', 'Negative News', 'Adverse Media'].map(tp => <option key={tp}>{tp}</option>)}</select></FormField></div>
      <FormField label={t.result}><input value={d.result || ''} onChange={e => setD('result', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" placeholder={t.resultPlaceholder} /></FormField>
      <button onClick={() => { if (!selectedId) return; const ent = entities.find(e => e.id === selectedId); updateEntity(selectedId, { screeningLogs: [...ent.screeningLogs, { id: gid(), date: today, system: d.system || 'World-Check', type: d.type || 'Sanctions', result: d.result || 'Clear' }] }); closeModal(); }} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium">{t.addRecord}</button>
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
    <div className="flex h-screen bg-gray-50 text-gray-800 overflow-hidden" style={{ fontSize: '13px' }}>
      <div className="md:hidden fixed top-0 left-0 right-0 h-10 bg-slate-800 text-white flex items-center px-3 z-30 shrink-0">
        <button onClick={() => setMobileSideOpen(!mobileSideOpen)} className="text-white p-1 text-lg leading-none">☰</button>
        <span className="text-sm font-bold ml-2">🛡️ KYC/AML</span>
        <span className="text-xs text-slate-400 ml-1">{t.appSub}</span>
      </div>
      {toastMsg && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium animate-pulse">{toastMsg}</div>}
      {mobileSideOpen && (<div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setMobileSideOpen(false)} />)}
      <div className={`fixed md:relative left-0 top-0 bottom-0 z-50 w-44 bg-slate-800 text-white flex flex-col shrink-0 transition-transform duration-200 ${mobileSideOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        <div className="p-3 border-b border-slate-700"><div className="text-base font-bold">🛡️ {t.appTitle}</div><div className="text-xs text-slate-400">{t.appSub}</div><button onClick={() => setLang(l => l === 'zh' ? 'en' : 'zh')} className="mt-2 flex items-center gap-1 px-2 py-1 rounded text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-200">{lang === 'zh' ? 'EN' : '中文'}</button></div>
        <nav className="flex-1 py-1">{navItems.map(item => (<button key={item.id} onClick={() => setView(item.id)} className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${view === item.id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}><span>{item.icon}</span>{item.label}{item.id === 'snapshots' && snapshots.length > 0 && <span className="ml-auto bg-slate-600 text-slate-200 px-1.5 py-0.5 rounded-full text-xs leading-none">{snapshots.length}</span>}</button>))}</nav>
        {autoTodos.filter(td => td.priority === 'critical' || td.priority === 'high').length > 0 && <div className="p-2 border-t border-slate-700 text-xs text-red-400">🔔 {autoTodos.filter(td => td.priority === 'critical' || td.priority === 'high').length} {t.urgentItems}</div>}
      </div>
      {view === 'workspace' ? (<div className="flex-1 flex flex-col overflow-hidden p-3 pb-8 pt-10 md:pt-0">{renderWorkspace()}</div>) : (<div className="flex-1 overflow-y-auto p-5 pb-8 pt-10 md:pt-0">{view === 'dashboard' && renderDashboard()}{view === 'search' && renderSearch()}{view === 'snapshots' && renderSnapshots()}{view === 'settings' && renderSettings()}{view === 'report' && renderReport()}</div>)}
      {renderModals()}
      {createPortal(
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999, background: 'rgba(15,23,42,0.95)', borderTop: '1px solid #334155', textAlign: 'center', padding: '5px 0' }}>
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

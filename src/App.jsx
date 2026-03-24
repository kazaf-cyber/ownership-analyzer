import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { AlertTriangle, Shield, ShieldCheck, Users, Building2, User, Plus, Trash2, Eye, FileText, Clock, Search, AlertCircle, Globe, Scale, Download, History, X, Check, Info, Layers, Link2, Crown, Ban, Languages, GitBranch, PanelLeftClose, PanelLeftOpen, Hash, Percent, Lock, Edit3 } from 'lucide-react';

const i18n = {
  en: {
    appTitle: 'CDD Analysis Platform', appSubtitle: 'Customer Due Diligence • UBO Identification • Risk Assessment',
    workspace: 'Workspace', uboAnalysis: 'UBO Analysis', warnings: 'Warnings', auditTrail: 'Audit Trail', report: 'Report',
    entitiesPanel: 'Entities', relationshipsPanel: 'Relationships',
    addEntity: 'Add Entity', editEntity: 'Edit Entity', search: 'Search entities...',
    name: 'Name', type: 'Type', company: 'Company', person: 'Individual',
    jurisdiction: 'Jurisdiction / Nationality', subtype: 'Entity Subtype',
    pepStatus: 'PEP Status', sanctions: 'Sanctions Screening', adverseMedia: 'Adverse Media',
    industry: 'Industry', sof: 'Source of Funds', sofDetail: 'SOF Detail',
    sow: 'Source of Wealth', sowDetail: 'SOW Detail', incorporationDate: 'Incorporation Date',
    lastReviewDate: 'Last Review Date', regulated: 'Regulated Entity (holds licence)',
    notes: 'Notes', save: 'Save', cancel: 'Cancel', select: '— Select —',
    addRelationship: 'Add Relationship', editRelationship: 'Edit Relationship',
    from: 'From (Shareholder/Controller)',
    to: 'To (Company/Entity)', ownershipPct: 'Ownership %', controlTypes: 'Control Types',
    nomineeArrangement: 'Nominee arrangement', add: 'Add', update: 'Update',
    crr: 'Comprehensive Risk Rating (CRR)', score: 'Score', reviewCycle: 'Review Cycle',
    ddLevel: 'DD Level', edd: 'EDD Required', cdd: 'Standard CDD', sdd: 'SDD Eligible',
    highRisk: 'High', mediumRisk: 'Medium', lowRisk: 'Low',
    uboThreshold: 'UBO threshold: ≥25% effective ownership OR significant control.',
    effectiveOwnership: 'effective', depth: 'Depth', layers: 'layers',
    control: 'Control', via: 'via', viaNominee: 'VIA NOMINEE',
    noEntities: 'No entities yet. Click "Add Entity" to begin.',
    noRelationships: 'No relationships yet. Add from the Relationships tab.',
    noUBOs: 'No UBOs identified. Add entities and relationships.',
    noWarnings: 'No warnings detected.', noAudit: 'No audit entries yet.',
    criticalSanctions: 'CRITICAL: Sanctions Hit', escalateMLRO: 'Escalate to MLRO. Consider STR.',
    bearerShareWarning: 'Bearer shares permitted — verify none issued.',
    shellCompanyWarning: 'Incorporated < 1 year — potential shell company.',
    reviewOverdue: 'CDD review overdue!',
    due: 'Due', annual: 'Annual (12m)', biennial: 'Biennial (24m)', triennial: 'Triennial (36m)',
    shareholders: 'Shareholders / Controllers', identifiedUBOs: 'Identified UBOs',
    regulatedNote: 'Regulated Entity — SDD eligible on look-through',
    reportTitle: 'CDD Analysis Report', generated: 'Generated',
    totalEntities: 'Total Entities', highRiskCount: 'High Risk',
    ubosIdentified: 'UBOs Identified', warningsCount: 'Warnings',
    sanctionsAlert: 'SANCTIONS ALERT', pepIdentified: 'PEP Identified',
    uboSummary: 'UBO Summary', complexityWarnings: 'Complexity & Red Flag Warnings',
    entityAdded: 'Entity Added', entityRemoved: 'Entity Removed', entityUpdated: 'Entity Updated',
    relationshipAdded: 'Relationship Added', relationshipRemoved: 'Relationship Removed',
    relationshipUpdated: 'Relationship Updated',
    added: 'Added', removed: 'Removed', updated: 'Updated',
    allChangesLogged: 'All changes logged for compliance audit.',
    dagTitle: 'Ownership & Control Structure (DAG)',
    dagDescription: 'Real-time DAG visualization. Click nodes to view details.',
    dagEmpty: 'Add entities to visualize the structure.',
    complexStructure: 'Complex structure', offshoreJurisdictions: 'offshore jurisdictions — complex cross-border',
    highRiskJurisdiction: 'High-risk jurisdiction', offshoreJurisdiction: 'Offshore jurisdiction',
    pep: 'PEP', sanctionsConfirmed: 'Sanctions confirmed hit', sanctionsPotential: 'Sanctions potential hit',
    highAdverseMedia: 'High adverse media', medAdverseMedia: 'Medium adverse media', lowAdverseMedia: 'Low adverse media',
    highRiskIndustry: 'High-risk industry', nomineeStructure: 'Nominee structure',
    trustFoundation: 'Trust/Foundation structure', bearerShareJurisdiction: 'Bearer share jurisdiction',
    shellRisk: 'Company < 1yr (shell risk)', regulatedReduction: 'Regulated entity (risk ↓)',
    ownershipChainDepth: 'Chain depth',
    assessCommercial: 'layers — assess rationale',
    blockTransaction: 'SANCTIONS HIT — BLOCK TRANSACTION',
    escalateReview: 'Potential sanctions — escalate',
    flags: 'Flags', nominee: 'NOMINEE', sanctioned: 'SANCTIONED',
    zoomIn: '+', zoomOut: '−', resetView: 'Reset', fitView: 'Fit',
    legend: 'Legend', companyNode: 'Company', personNode: 'Individual',
    highRiskNode: 'High Risk', nomineeLink: 'Nominee',
    collapsePanel: 'Collapse', expandPanel: 'Expand',
    clickNodeHint: 'Click a node in the DAG or list to view details',
    entityDetail: 'Entity Detail', close: 'Close',
    totalShares: 'Total Issued Shares', sharesHeld: 'Shares Held',
    inputMode: 'Input Mode', byPercentage: 'By Percentage', byShares: 'By Shares',
    autoCalc: 'Auto-calculated', shares: 'shares',
    personCannotBeOwned: 'Individuals cannot be owned/held by another entity.',
    onlyCompaniesAsTarget: 'Only companies can be selected as target.',
    noCompanyTarget: 'Please add a company entity first to set as target.',
    shareInfo: 'Enter total issued shares so the system can auto-calculate ownership %.',
    autoHighRiskTrust: '⚠️ Trust/Foundation — AUTO HIGH RISK, mandatory annual review',
    autoHighRiskNominee: '⚠️ Nominee Shareholder — AUTO HIGH RISK, mandatory annual review',
    forcedHighRisk: 'Forced High Risk',
    forcedAnnualReview: 'Mandatory Annual Review',
    trustNomineePolicy: 'Per policy: Trusts, Foundations & Nominee Shareholders are automatically classified as High Risk with mandatory Annual (12m) EDD review cycle.',
    lockedHighRisk: 'LOCKED: High Risk (Policy)',
    autoTag: 'AUTO',
    loadSample: '📋 Load Complex Example',
    loadSampleConfirm: 'Loading the sample will overwrite all current data. Continue?',
    sampleLoaded: 'Sample data loaded',
    sampleDescription: 'Click "Load Complex Example" to see a multi-layer structure with Trust, Foundation, Nominee Shareholder, PEP, sanctions hits and more.',
    editHint: 'Click ✏️ to edit',
  },
  zh: {
    appTitle: 'CDD 盡職調查分析平台', appSubtitle: '客戶盡職調查 • UBO 識別 • 風險評估',
    workspace: '工作區', uboAnalysis: 'UBO 分析', warnings: '警示', auditTrail: '審計軌跡', report: '報告',
    entitiesPanel: '實體', relationshipsPanel: '關係',
    addEntity: '新增實體', editEntity: '編輯實體', search: '搜尋...',
    name: '名稱', type: '類型', company: '公司', person: '個人',
    jurisdiction: '管轄區/國籍', subtype: '子類型',
    pepStatus: 'PEP 狀態', sanctions: '制裁篩查', adverseMedia: '負面新聞',
    industry: '行業', sof: '資金來源', sofDetail: '資金來源詳情',
    sow: '財富來源', sowDetail: '財富來源詳情', incorporationDate: '成立日期',
    lastReviewDate: '上次審查日期', regulated: '受監管實體（持牌照）',
    notes: '備註', save: '儲存', cancel: '取消', select: '— 請選擇 —',
    addRelationship: '新增關係', editRelationship: '編輯關係',
    from: '從（股東/控制人）',
    to: '至（被持有公司）', ownershipPct: '持股 %', controlTypes: '控制類型',
    nomineeArrangement: '代名人安排', add: '新增', update: '更新',
    crr: '綜合風險評級 (CRR)', score: '分數', reviewCycle: '審查週期',
    ddLevel: '盡調等級', edd: '加強盡調 (EDD)', cdd: '標準盡調 (CDD)', sdd: '簡化盡調 (SDD)',
    highRisk: '高風險', mediumRisk: '中風險', lowRisk: '低風險',
    uboThreshold: 'UBO 門檻：≥25% 有效持股或重大控制權。',
    effectiveOwnership: '有效持股', depth: '深度', layers: '層',
    control: '控制', via: '透過', viaNominee: '透過代名人',
    noEntities: '尚未新增實體。點擊「新增實體」開始。',
    noRelationships: '尚未新增關係。請在「關係」面板中新增。',
    noUBOs: '未識別到 UBO。請新增實體和關係。',
    noWarnings: '未偵測到警示。', noAudit: '尚無審計記錄。',
    criticalSanctions: '嚴重：制裁命中', escalateMLRO: '立即上報 MLRO。考慮提交 STR。',
    bearerShareWarning: '允許不記名股份——請確認未發行。',
    shellCompanyWarning: '成立不到 1 年——潛在空殼公司。',
    reviewOverdue: 'CDD 審查已逾期！',
    due: '到期', annual: '每年（12月）', biennial: '三年（36月）', triennial: '三年（36月）',
    shareholders: '股東/控制人', identifiedUBOs: '已識別 UBO',
    regulatedNote: '受監管實體——可簡化盡調',
    reportTitle: 'CDD 分析報告', generated: '生成日期',
    totalEntities: '實體總數', highRiskCount: '高風險',
    ubosIdentified: '已識別 UBO', warningsCount: '警示',
    sanctionsAlert: '制裁警報', pepIdentified: '已識別 PEP',
    uboSummary: 'UBO 摘要', complexityWarnings: '複雜性與紅旗警示',
    entityAdded: '新增實體', entityRemoved: '刪除實體', entityUpdated: '更新實體',
    relationshipAdded: '新增關係', relationshipRemoved: '刪除關係',
    relationshipUpdated: '更新關係',
    added: '已新增', removed: '已刪除', updated: '已更新',
    allChangesLogged: '所有變更均記錄以供審計。',
    dagTitle: '持股與控制架構圖（DAG）',
    dagDescription: '即時 DAG 視覺化。點擊節點查看詳情。',
    dagEmpty: '新增實體以視覺化架構。',
    complexStructure: '複雜架構', offshoreJurisdictions: '個離岸管轄區——跨境架構',
    highRiskJurisdiction: '高風險管轄區', offshoreJurisdiction: '離岸管轄區',
    pep: 'PEP', sanctionsConfirmed: '制裁確認命中', sanctionsPotential: '制裁潛在命中',
    highAdverseMedia: '高度負面新聞', medAdverseMedia: '中度負面新聞', lowAdverseMedia: '低度負面新聞',
    highRiskIndustry: '高風險行業', nomineeStructure: '代名人架構',
    trustFoundation: '信託/基金會架構', bearerShareJurisdiction: '不記名股份管轄區',
    shellRisk: '成立不足1年（空殼風險）', regulatedReduction: '受監管實體（風險↓）',
    ownershipChainDepth: '持股鏈深度',
    assessCommercial: '層——需評估商業合理性',
    blockTransaction: '制裁命中——阻止交易',
    escalateReview: '潛在制裁——上報審查',
    flags: '風險標記', nominee: '代名人', sanctioned: '已制裁',
    zoomIn: '+', zoomOut: '−', resetView: '重置', fitView: '適配',
    legend: '圖例', companyNode: '公司', personNode: '個人',
    highRiskNode: '高風險', nomineeLink: '代名人',
    collapsePanel: '收合', expandPanel: '展開',
    clickNodeHint: '點擊 DAG 節點或列表查看詳情',
    entityDetail: '實體詳情', close: '關閉',
    totalShares: '已發行總股數', sharesHeld: '持有股數',
    inputMode: '輸入方式', byPercentage: '按百分比', byShares: '按股數',
    autoCalc: '自動計算', shares: '股',
    personCannotBeOwned: '個人不能被其他實體持有。',
    onlyCompaniesAsTarget: '只能選擇公司作為被持有目標。',
    noCompanyTarget: '請先新增一個公司實體作為被持有目標。',
    shareInfo: '填寫公司已發行總股數，系統將自動計算持股百分比。',
    autoHighRiskTrust: '⚠️ 信託/基金會——自動歸為高風險，強制每年審查',
    autoHighRiskNominee: '⚠️ 代名人股東——自動歸為高風險，強制每年審查',
    forcedHighRisk: '強制高風險',
    forcedAnnualReview: '強制每年審查',
    trustNomineePolicy: '根據政策：信託、基金會及代名人股東自動歸為高風險，並強制執行每年（12個月）EDD 審查週期。',
    lockedHighRisk: '鎖定：高風險（政策）',
    autoTag: '自動',
    loadSample: '📋 載入複雜範例',
    loadSampleConfirm: '載入範例將覆蓋目前所有數據，確定要繼續嗎？',
    sampleLoaded: '已載入範例數據',
    sampleDescription: '點擊「載入複雜範例」可查看包含多層架構、信託、基金會、代名人股東、PEP、制裁命中等複雜股權結構範本。',
    editHint: '點擊 ✏️ 編輯',
  }
};

const FATF_HIGH_RISK = ['Iran','DPRK','Myanmar','Syria','Yemen','Afghanistan','Albania','Barbados','Burkina Faso','Cambodia','Cayman Islands','Democratic Republic of Congo','Gibraltar','Haiti','Jamaica','Jordan','Mali','Mozambique','Nigeria','Pakistan','Panama','Philippines','Senegal','South Africa','South Sudan','Tanzania','Trinidad and Tobago','Türkiye','Uganda','Vietnam'];
const OFFSHORE_JURISDICTIONS = ['BVI','Cayman Islands','Panama','Bermuda','Jersey','Guernsey','Isle of Man','Liechtenstein','Marshall Islands','Seychelles','Mauritius','Samoa','Vanuatu','Bahamas','Curaçao','Luxembourg','Cyprus','Malta','Hong Kong','Singapore','Labuan'];
const BEARER_SHARE_JURISDICTIONS = ['Panama','Marshall Islands','Liberia','Antigua and Barbuda','Dominica','St. Kitts and Nevis','St. Vincent and the Grenadines'];
const HIGH_RISK_INDUSTRIES = ['Gambling & Casinos','Virtual Assets / Crypto','Arms & Defence','Precious Metals & Stones','Money Services Business','Real Estate','Art & Antiquities','Tobacco','Adult Entertainment','Shell Company Services','Trust & Company Services','Non-Profit / Charity'];
const PEP_TYPES = ['None','Foreign PEP','Domestic PEP','International Org PEP','RCA (Relative/Close Associate)'];
const SANCTION_STATUS = ['Not Screened','No Hit','Potential Hit','Confirmed Hit'];
const ADVERSE_MEDIA_STATUS = ['Not Checked','No Findings','Findings - Low','Findings - Medium','Findings - High'];
const CONTROL_TYPES = ['Ownership','Voting Rights','Board Appointment','Veto Power','Contractual Control','Trust Beneficiary','Nominee Arrangement','Other'];
const SOF_OPTIONS = ['Employment Income','Business Profits','Investment Returns','Inheritance','Sale of Property','Gift/Donation','Pension/Retirement','Government Funds','Other'];
const ENTITY_SUBTYPES_COMPANY = ['Standard Company','Trust','Foundation','Fund','SPV','Partnership','Government Entity','Regulated Entity'];
const ENTITY_SUBTYPES_PERSON = ['Individual','Nominee Shareholder','Sole Proprietorship'];
const FORCED_HIGH_RISK_SUBTYPES = ['Trust', 'Foundation', 'Nominee Shareholder'];
const ALL_JURISDICTIONS = ['Afghanistan','Albania','Antigua and Barbuda','Australia','Austria','Bahamas','Barbados','Belgium','Bermuda','Brazil','BVI','Burkina Faso','Cambodia','Canada','Cayman Islands','China','Curaçao','Cyprus','Czech Republic','Democratic Republic of Congo','Denmark','Dominica','DPRK','Estonia','Finland','France','Germany','Gibraltar','Greece','Guernsey','Haiti','Hong Kong','Hungary','Iceland','India','Indonesia','Iran','Ireland','Isle of Man','Israel','Italy','Jamaica','Japan','Jersey','Jordan','Kenya','Labuan','Latvia','Lebanon','Liberia','Liechtenstein','Lithuania','Luxembourg','Malaysia','Mali','Malta','Marshall Islands','Mauritius','Mexico','Monaco','Mozambique','Myanmar','Netherlands','New Zealand','Nigeria','Norway','Pakistan','Panama','Philippines','Poland','Portugal','Romania','Russia','Samoa','Saudi Arabia','Senegal','Seychelles','Singapore','Slovakia','Slovenia','South Africa','South Korea','South Sudan','Spain','Sri Lanka','St. Kitts and Nevis','St. Vincent and the Grenadines','Sweden','Switzerland','Syria','Taiwan','Tanzania','Thailand','Trinidad and Tobago','Türkiye','UAE','UK','Ukraine','USA','Vanuatu','Vietnam','Yemen'].sort();

const getJurisdictionRisk = (j) => FATF_HIGH_RISK.includes(j) ? 'High' : OFFSHORE_JURISDICTIONS.includes(j) ? 'Medium' : 'Low';
const isOffshore = (j) => OFFSHORE_JURISDICTIONS.includes(j);
const isBearerShareRisk = (j) => BEARER_SHARE_JURISDICTIONS.includes(j);
const isForcedHighRisk = (entity) => FORCED_HIGH_RISK_SUBTYPES.includes(entity.subtype);

function generateSampleData() {
  const ts = Date.now();
  const sid = (n) => `sample_${n}_${ts}`;
  const sampleEntities = [
    { id: sid(1), name: 'Global Tech Holdings Ltd', type: 'company', jurisdiction: 'BVI', subtype: 'Standard Company', pepType: 'None', sanctionStatus: 'No Hit', adverseMedia: 'No Findings', industry: 'Technology', controlTypes: ['Ownership'], isRegulated: false, incorporationDate: '2019-03-15', lastReviewDate: '2025-06-01', sof: 'Business Profits', sow: 'Business Profits', sofDetail: 'Tech licensing revenue', sowDetail: 'Accumulated business profits', notes: 'Main holding company — BVI incorporated.', totalShares: '10000' },
    { id: sid(2), name: 'ABC Investment Ltd', type: 'company', jurisdiction: 'Cayman Islands', subtype: 'Standard Company', pepType: 'None', sanctionStatus: 'No Hit', adverseMedia: 'No Findings', industry: 'Other', controlTypes: ['Ownership'], isRegulated: false, incorporationDate: '2020-08-20', lastReviewDate: '2025-03-10', sof: 'Investment Returns', sow: 'Investment Returns', sofDetail: 'Portfolio returns', sowDetail: 'Initial capital injection', notes: 'Intermediate holding — Cayman Islands', totalShares: '1000' },
    { id: sid(3), name: 'XYZ Fund LP', type: 'company', jurisdiction: 'Luxembourg', subtype: 'Fund', pepType: 'None', sanctionStatus: 'No Hit', adverseMedia: 'No Findings', industry: 'Banking', controlTypes: ['Ownership'], isRegulated: true, incorporationDate: '2018-01-10', lastReviewDate: '2025-01-15', sof: 'Investment Returns', sow: 'Investment Returns', sofDetail: 'Fund subscriptions', sowDetail: 'Institutional investors', notes: 'CSSF-regulated fund. SDD eligible.', totalShares: '5000' },
    { id: sid(4), name: 'Smith Family Trust', type: 'company', jurisdiction: 'Jersey', subtype: 'Trust', pepType: 'None', sanctionStatus: 'No Hit', adverseMedia: 'No Findings', industry: 'Trust & Company Services', controlTypes: ['Ownership'], isRegulated: false, incorporationDate: '2015-06-01', lastReviewDate: '2024-12-01', sof: 'Inheritance', sow: 'Inheritance', sofDetail: 'Family wealth transfer', sowDetail: 'Smith family accumulated assets', notes: 'Settlor: John Smith | Trustee: Jersey Trust Co Ltd', totalShares: '' },
    { id: sid(5), name: 'Pacific Foundation', type: 'company', jurisdiction: 'Panama', subtype: 'Foundation', pepType: 'None', sanctionStatus: 'Potential Hit', adverseMedia: 'Findings - Medium', industry: 'Non-Profit / Charity', controlTypes: ['Ownership'], isRegulated: false, incorporationDate: '2021-11-30', lastReviewDate: '2024-09-15', sof: 'Gift/Donation', sow: 'Other', sofDetail: 'Charitable donations received', sowDetail: 'Founder personal wealth', notes: 'Founder: Roberto Garcia | ⚠️ Potential sanctions match', totalShares: '' },
    { id: sid(6), name: 'John Smith', type: 'person', jurisdiction: 'Hong Kong', subtype: 'Individual', pepType: 'Foreign PEP', sanctionStatus: 'No Hit', adverseMedia: 'Findings - Low', industry: '', controlTypes: ['Ownership'], isRegulated: false, incorporationDate: '', lastReviewDate: '2025-04-01', sof: 'Employment Income', sow: 'Business Profits', sofDetail: 'Director fees', sowDetail: 'Founded tech business in 2010', notes: 'Foreign PEP: Advisory Board Member, Country X', totalShares: '' },
    { id: sid(7), name: 'Mary Johnson', type: 'person', jurisdiction: 'USA', subtype: 'Individual', pepType: 'None', sanctionStatus: 'No Hit', adverseMedia: 'No Findings', industry: '', controlTypes: ['Ownership'], isRegulated: false, incorporationDate: '', lastReviewDate: '2025-02-20', sof: 'Business Profits', sow: 'Business Profits', sofDetail: 'Tech consulting firm revenue', sowDetail: 'Self-made entrepreneur since 2008', notes: 'US citizen, based in New York.', totalShares: '' },
    { id: sid(8), name: 'David Lee', type: 'person', jurisdiction: 'Singapore', subtype: 'Individual', pepType: 'None', sanctionStatus: 'No Hit', adverseMedia: 'No Findings', industry: '', controlTypes: ['Ownership'], isRegulated: false, incorporationDate: '', lastReviewDate: '2025-05-01', sof: 'Investment Returns', sow: 'Investment Returns', sofDetail: 'Fund management fees', sowDetail: 'Investment portfolio built over 15 years', notes: 'GP / Fund manager at XYZ Fund LP.', totalShares: '' },
    { id: sid(9), name: 'Chen Wei', type: 'person', jurisdiction: 'China', subtype: 'Nominee Shareholder', pepType: 'None', sanctionStatus: 'No Hit', adverseMedia: 'Findings - Low', industry: '', controlTypes: ['Ownership', 'Nominee Arrangement'], isRegulated: false, incorporationDate: '', lastReviewDate: '2025-01-10', sof: 'Business Profits', sow: 'Business Profits', sofDetail: 'Import/export trading business', sowDetail: 'Trading business established 2005', notes: '⚠️ NOMINEE: Holds 25% of Global Tech on behalf of undisclosed principal', totalShares: '' },
    { id: sid(10), name: 'Roberto Garcia', type: 'person', jurisdiction: 'Panama', subtype: 'Individual', pepType: 'RCA (Relative/Close Associate)', sanctionStatus: 'Potential Hit', adverseMedia: 'Findings - High', industry: '', controlTypes: ['Ownership'], isRegulated: false, incorporationDate: '', lastReviewDate: '2024-08-01', sof: 'Business Profits', sow: 'Inheritance', sofDetail: 'Family conglomerate dividends', sowDetail: 'Inherited multi-sector family empire', notes: '⚠️ HIGH RISK | RCA: Brother is government minister of Country Y', totalShares: '' },
  ];
  const sampleRelationships = [
    { id: `rel_1_${ts}`, fromId: sid(6), toId: sid(1), percentage: 15, sharesHeld: '1500', controlTypes: ['Ownership', 'Board Appointment'], isNominee: false, inputMode: 'shares' },
    { id: `rel_2_${ts}`, fromId: sid(2), toId: sid(1), percentage: 25, sharesHeld: '2500', controlTypes: ['Ownership'], isNominee: false, inputMode: 'shares' },
    { id: `rel_3_${ts}`, fromId: sid(4), toId: sid(1), percentage: 20, sharesHeld: '2000', controlTypes: ['Ownership', 'Trust Beneficiary'], isNominee: false, inputMode: 'shares' },
    { id: `rel_4_${ts}`, fromId: sid(5), toId: sid(1), percentage: 15, sharesHeld: '1500', controlTypes: ['Ownership'], isNominee: false, inputMode: 'shares' },
    { id: `rel_5_${ts}`, fromId: sid(9), toId: sid(1), percentage: 25, sharesHeld: '2500', controlTypes: ['Ownership', 'Nominee Arrangement'], isNominee: true, inputMode: 'shares' },
    { id: `rel_6_${ts}`, fromId: sid(7), toId: sid(2), percentage: 60, sharesHeld: '600', controlTypes: ['Ownership', 'Voting Rights'], isNominee: false, inputMode: 'shares' },
    { id: `rel_7_${ts}`, fromId: sid(3), toId: sid(2), percentage: 40, sharesHeld: '400', controlTypes: ['Ownership'], isNominee: false, inputMode: 'shares' },
    { id: `rel_8_${ts}`, fromId: sid(8), toId: sid(3), percentage: 100, sharesHeld: '5000', controlTypes: ['Ownership', 'Board Appointment', 'Voting Rights'], isNominee: false, inputMode: 'shares' },
    { id: `rel_9_${ts}`, fromId: sid(10), toId: sid(5), percentage: 100, sharesHeld: '', controlTypes: ['Ownership', 'Contractual Control'], isNominee: false, inputMode: 'percentage' },
  ];
  return { entities: sampleEntities, relationships: sampleRelationships };
}

function calcCRR(entity) {
  let score = 0; const flags = [];
  const forced = isForcedHighRisk(entity);
  const jr = getJurisdictionRisk(entity.jurisdiction);
  if (jr === 'High') { score += 30; flags.push('highRiskJurisdiction'); }
  else if (jr === 'Medium') { score += 15; flags.push('offshoreJurisdiction'); }
  if (entity.pepType && entity.pepType !== 'None') { score += 25; flags.push('pep'); }
  if (entity.sanctionStatus === 'Confirmed Hit') { score += 50; flags.push('sanctionsConfirmed'); }
  else if (entity.sanctionStatus === 'Potential Hit') { score += 20; flags.push('sanctionsPotential'); }
  if (entity.adverseMedia === 'Findings - High') { score += 25; flags.push('highAdverseMedia'); }
  else if (entity.adverseMedia === 'Findings - Medium') { score += 15; flags.push('medAdverseMedia'); }
  else if (entity.adverseMedia === 'Findings - Low') { score += 5; flags.push('lowAdverseMedia'); }
  if (entity.industry && HIGH_RISK_INDUSTRIES.includes(entity.industry)) { score += 15; flags.push('highRiskIndustry'); }
  if (entity.subtype === 'Nominee Shareholder') { score += 15; flags.push('nomineeStructure'); }
  if (entity.subtype === 'Trust' || entity.subtype === 'Foundation') { score += 10; flags.push('trustFoundation'); }
  if (isBearerShareRisk(entity.jurisdiction)) { score += 15; flags.push('bearerShareJurisdiction'); }
  if (entity.type === 'company' && entity.incorporationDate) {
    const age = (new Date() - new Date(entity.incorporationDate)) / (365.25 * 24 * 60 * 60 * 1000);
    if (age < 1) { score += 10; flags.push('shellRisk'); }
  }
  if (entity.isRegulated) { score -= 15; flags.push('regulatedReduction'); }
  if (forced) { score = Math.max(score, 50); }
  return { score: Math.max(0, Math.min(100, score)), level: score >= 50 ? 'High' : score >= 25 ? 'Medium' : 'Low', flags, forced };
}

const riskBadge = (level, t) => {
  const label = level === 'High' ? t.highRisk : level === 'Medium' ? t.mediumRisk : t.lowRisk;
  const c = level === 'High' ? 'bg-red-100 text-red-800 border-red-300' : level === 'Medium' ? 'bg-yellow-100 text-yellow-800 border-yellow-300' : 'bg-green-100 text-green-800 border-green-300';
  return <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold border ${c}`}>{label}</span>;
};

const defaultEntity = () => ({ id: '', name: '', type: 'company', jurisdiction: 'Hong Kong', subtype: 'Standard Company', pepType: 'None', sanctionStatus: 'Not Screened', adverseMedia: 'Not Checked', industry: '', controlTypes: ['Ownership'], isRegulated: false, incorporationDate: '', lastReviewDate: '', sof: '', sow: '', sofDetail: '', sowDetail: '', notes: '', totalShares: '' });
const defaultRel = () => ({ fromId: '', toId: '', percentage: 0, sharesHeld: '', controlTypes: ['Ownership'], isNominee: false, inputMode: 'percentage' });

let auditIdCounter = 1;

function computeDAGLayout(entities, relationships) {
  if (entities.length === 0) return { nodes: [], edges: [] };
  const adj = {}; const inDeg = {};
  entities.forEach(e => { adj[e.id] = []; inDeg[e.id] = 0; });
  relationships.forEach(r => { if (adj[r.fromId]) { adj[r.fromId].push(r.toId); inDeg[r.toId] = (inDeg[r.toId] || 0) + 1; } });
  const layers = {}; const queue = [];
  entities.forEach(e => { if ((inDeg[e.id] || 0) === 0) { queue.push(e.id); layers[e.id] = 0; } });
  while (queue.length > 0) { const cur = queue.shift(); (adj[cur] || []).forEach(nb => { layers[nb] = Math.max(layers[nb] || 0, (layers[cur] || 0) + 1); inDeg[nb]--; if (inDeg[nb] === 0) queue.push(nb); }); }
  entities.forEach(e => { if (layers[e.id] === undefined) layers[e.id] = 0; });
  const layerGroups = {};
  entities.forEach(e => { const l = layers[e.id]; if (!layerGroups[l]) layerGroups[l] = []; layerGroups[l].push(e); });
  const nodeW = 170, nodeH = 64, hGap = 32, vGap = 90;
  const nodes = [];
  Object.keys(layerGroups).forEach(l => { const group = layerGroups[l]; const totalW = group.length * nodeW + (group.length - 1) * hGap; group.forEach((e, idx) => { nodes.push({ ...e, x: idx * (nodeW + hGap) - totalW / 2 + nodeW / 2, y: Number(l) * (nodeH + vGap), w: nodeW, h: nodeH, layer: Number(l) }); }); });
  const nodeMap = {}; nodes.forEach(n => nodeMap[n.id] = n);
  const edges = relationships.map(r => ({ ...r, from: nodeMap[r.fromId], to: nodeMap[r.toId] })).filter(e => e.from && e.to);
  return { nodes, edges };
}

function DAGCanvas({ entities, relationships, t, selectedEntity, onSelectEntity }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 400 });
  const layout = useMemo(() => computeDAGLayout(entities, relationships), [entities, relationships]);

  useEffect(() => {
    const obs = new ResizeObserver(entries => { for (const entry of entries) setCanvasSize({ w: entry.contentRect.width, h: entry.contentRect.height }); });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const fitView = useCallback(() => {
    if (layout.nodes.length === 0) return;
    const xs = layout.nodes.map(n => n.x), ys = layout.nodes.map(n => n.y);
    const minX = Math.min(...xs) - 100, maxX = Math.max(...xs) + 100, minY = Math.min(...ys) - 50, maxY = Math.max(...ys) + 50;
    const w = maxX - minX, h = maxY - minY;
    const newZoom = Math.min(canvasSize.w / (w + 40), (canvasSize.h - 20) / (h + 40), 1.5);
    setZoom(newZoom);
    setPan({ x: -(minX + maxX) / 2 * newZoom, y: -(minY + maxY) / 2 * newZoom + 20 });
  }, [layout, canvasSize]);

  useEffect(() => { if (layout.nodes.length > 0) fitView(); }, [layout.nodes.length]);

  const getMousePos = (e) => { const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return { mx: 0, my: 0 }; return { mx: (e.clientX - rect.left - canvasSize.w / 2 - pan.x) / zoom, my: (e.clientY - rect.top - canvasSize.h / 2 - pan.y) / zoom }; };

  const handleWheel = (e) => { e.preventDefault(); setZoom(z => Math.max(0.2, Math.min(3, z + (e.deltaY > 0 ? -0.08 : 0.08)))); };
  const handleMouseDown = (e) => { const { mx, my } = getMousePos(e); const clickedNode = layout.nodes.find(n => mx >= n.x - n.w / 2 && mx <= n.x + n.w / 2 && my >= n.y - n.h / 2 && my <= n.y + n.h / 2); if (clickedNode) { onSelectEntity(clickedNode.id); return; } setDragging(true); setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y }); };
  const handleMouseMove = (e) => { if (dragging) { setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); return; } const { mx, my } = getMousePos(e); const found = layout.nodes.find(n => mx >= n.x - n.w / 2 && mx <= n.x + n.w / 2 && my >= n.y - n.h / 2 && my <= n.y + n.h / 2); setHovered(found?.id || null); };
  const handleMouseUp = () => setDragging(false);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const dpr = window.devicePixelRatio || 2;
    canvas.width = canvasSize.w * dpr; canvas.height = canvasSize.h * dpr;
    canvas.style.width = canvasSize.w + 'px'; canvas.style.height = canvasSize.h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);
    ctx.save();
    ctx.translate(canvasSize.w / 2 + pan.x, canvasSize.h / 2 + pan.y);
    ctx.scale(zoom, zoom);

    layout.edges.forEach(edge => {
      const fx = edge.from.x, fy = edge.from.y + edge.from.h / 2, tx = edge.to.x, ty = edge.to.y - edge.to.h / 2;
      ctx.beginPath();
      ctx.moveTo(fx, fy); ctx.bezierCurveTo(fx, fy + (ty - fy) * 0.35, tx, fy + (ty - fy) * 0.65, tx, ty);
      const isHL = selectedEntity && (edge.fromId === selectedEntity || edge.toId === selectedEntity);
      ctx.strokeStyle = edge.isNominee ? '#EF4444' : isHL ? '#3B82F6' : '#94A3B8';
      ctx.lineWidth = edge.isNominee ? 2.5 : isHL ? 2 : 1.2;
      if (edge.isNominee) ctx.setLineDash([6, 4]); else ctx.setLineDash([]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - 5, ty - 9); ctx.lineTo(tx + 5, ty - 9); ctx.closePath();
      ctx.fillStyle = edge.isNominee ? '#EF4444' : isHL ? '#3B82F6' : '#94A3B8'; ctx.fill();
      const lx = (fx + tx) / 2 + 12, ly = (fy + ty) / 2;
      ctx.font = 'bold 10px system-ui'; ctx.fillStyle = edge.isNominee ? '#DC2626' : '#475569'; ctx.textAlign = 'center';
      ctx.fillText(`${edge.percentage}%`, lx, ly);
      if (edge.sharesHeld) { ctx.font = '8px system-ui'; ctx.fillStyle = '#94A3B8'; ctx.fillText(`${Number(edge.sharesHeld).toLocaleString()} shares`, lx, ly + 11); }
    });

    layout.nodes.forEach(node => {
      const crr = calcCRR(node);
      const isHov = hovered === node.id, isSel = selectedEntity === node.id;
      const x = node.x - node.w / 2, y = node.y - node.h / 2, r = 8;
      ctx.shadowColor = isSel ? 'rgba(59,130,246,0.5)' : isHov ? 'rgba(59,130,246,0.3)' : 'rgba(0,0,0,0.08)';
      ctx.shadowBlur = isSel ? 14 : isHov ? 10 : 5; ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.lineTo(x + node.w - r, y); ctx.quadraticCurveTo(x + node.w, y, x + node.w, y + r);
      ctx.lineTo(x + node.w, y + node.h - r); ctx.quadraticCurveTo(x + node.w, y + node.h, x + node.w - r, y + node.h);
      ctx.lineTo(x + r, y + node.h); ctx.quadraticCurveTo(x, y + node.h, x, y + node.h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
      ctx.fillStyle = node.sanctionStatus === 'Confirmed Hit' ? '#FEE2E2' : crr.forced ? '#FEF2F2' : node.type === 'company' ? '#EFF6FF' : '#ECFDF5';
      ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      const bColor = crr.level === 'High' ? '#EF4444' : crr.level === 'Medium' ? '#F59E0B' : node.type === 'company' ? '#3B82F6' : '#10B981';
      ctx.strokeStyle = isSel ? '#2563EB' : bColor;
      ctx.lineWidth = isSel ? 2.5 : crr.forced ? 2.5 : isHov ? 2 : 1.2; ctx.stroke();
      if (crr.forced) { ctx.strokeStyle = '#B91C1C'; ctx.lineWidth = 1; const inset = 3; ctx.beginPath(); ctx.moveTo(x + r + inset, y + inset); ctx.lineTo(x + node.w - r - inset, y + inset); ctx.quadraticCurveTo(x + node.w - inset, y + inset, x + node.w - inset, y + r + inset); ctx.lineTo(x + node.w - inset, y + node.h - r - inset); ctx.quadraticCurveTo(x + node.w - inset, y + node.h - inset, x + node.w - r - inset, y + node.h - inset); ctx.lineTo(x + r + inset, y + node.h - inset); ctx.quadraticCurveTo(x + inset, y + node.h - inset, x + inset, y + node.h - r - inset); ctx.lineTo(x + inset, y + r + inset); ctx.quadraticCurveTo(x + inset, y + inset, x + r + inset, y + inset); ctx.closePath(); ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]); }
      ctx.fillStyle = bColor;
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + node.w - r, y); ctx.quadraticCurveTo(x + node.w, y, x + node.w, y + r); ctx.lineTo(x + node.w, y + 5); ctx.lineTo(x, y + 5); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath(); ctx.fill();
      ctx.font = '13px system-ui'; ctx.fillText(node.type === 'company' ? '🏢' : '👤', x + 8, y + 24);
      ctx.font = 'bold 11px system-ui'; ctx.fillStyle = '#1E293B'; ctx.textAlign = 'left';
      ctx.fillText(node.name.length > 14 ? node.name.substring(0, 13) + '…' : node.name, x + 26, y + 24);
      ctx.font = '9px system-ui'; ctx.fillStyle = '#64748B'; ctx.fillText(node.jurisdiction, x + 26, y + 37);
      if (node.type === 'company' && node.totalShares) { ctx.font = '8px system-ui'; ctx.fillStyle = '#94A3B8'; ctx.fillText(`${Number(node.totalShares).toLocaleString()} shares`, x + 26, y + 47); }
      ctx.font = 'bold 9px system-ui'; ctx.fillStyle = crr.level === 'High' ? '#DC2626' : crr.level === 'Medium' ? '#D97706' : '#16A34A'; ctx.fillText(`CRR ${crr.score}`, x + 8, y + 58);
      if (crr.forced) { const lockX = x + node.w - 32, lockY = y + 50; ctx.fillStyle = '#B91C1C'; ctx.beginPath(); ctx.roundRect(lockX, lockY, 26, 12, 2); ctx.fill(); ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.font = 'bold 7px system-ui'; ctx.fillText('🔒 AUTO', lockX + 13, lockY + 9); }
      ctx.textAlign = 'left';
      if (node.pepType !== 'None') { ctx.fillStyle = '#D97706'; ctx.font = 'bold 8px system-ui'; ctx.fillText('PEP', x + node.w - 28, y + 24); }
      if (node.sanctionStatus === 'Confirmed Hit') { ctx.font = '12px system-ui'; ctx.fillText('⛔', x + node.w - 18, y + 38); }
    });
    ctx.restore();
  }, [layout, zoom, pan, hovered, selectedEntity, canvasSize, t]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-2 py-1 bg-slate-50 border-b text-xs shrink-0">
        <span className="font-semibold text-slate-600 flex items-center gap-1"><GitBranch size={12} /> {t.dagTitle}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom(z => Math.min(3, z + 0.15))} className="bg-white border hover:bg-gray-100 w-6 h-6 rounded flex items-center justify-center font-bold">{t.zoomIn}</button>
          <button onClick={() => setZoom(z => Math.max(0.2, z - 0.15))} className="bg-white border hover:bg-gray-100 w-6 h-6 rounded flex items-center justify-center font-bold">{t.zoomOut}</button>
          <button onClick={fitView} className="bg-white border hover:bg-gray-100 px-2 h-6 rounded text-xs">{t.fitView}</button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="bg-white border hover:bg-gray-100 px-2 h-6 rounded text-xs">{t.resetView}</button>
          <span className="text-gray-400 ml-1">{Math.round(zoom * 100)}%</span>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 relative overflow-hidden bg-white">
        {entities.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-sm">{t.dagEmpty}</div>
        ) : (
          <canvas ref={canvasRef} className={`w-full h-full ${dragging ? 'cursor-grabbing' : hovered ? 'cursor-pointer' : 'cursor-grab'}`}
            onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} />
        )}
      </div>
      <div className="flex items-center gap-3 px-2 py-1 bg-slate-50 border-t text-xs text-gray-400 shrink-0">
        <span className="font-semibold">{t.legend}:</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-blue-100 border border-blue-500 inline-block"></span>{t.companyNode}</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-green-100 border border-green-500 inline-block"></span>{t.personNode}</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-100 border-2 border-red-500 inline-block"></span>{t.highRiskNode}</span>
        <span className="flex items-center gap-1"><span className="w-5 border-t-2 border-dashed border-red-500 inline-block"></span>{t.nomineeLink}</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════ RELATIONSHIP FORM (Shared for Add / Edit) ═══════════════════════════ */
function RelationshipForm({ relData, setRelData, entities, companyEntities, onSubmit, onCancel, isEditing, t }) {
  const selectedToEntity = entities.find(e => e.id === relData.toId);
  const toHasShares = selectedToEntity && selectedToEntity.totalShares && parseFloat(selectedToEntity.totalShares) > 0;

  const calcSharesPreview = useMemo(() => {
    if (relData.inputMode !== 'shares' || !relData.toId) return null;
    const toEnt = entities.find(e => e.id === relData.toId);
    if (!toEnt || !toEnt.totalShares) return null;
    const total = parseFloat(toEnt.totalShares);
    const held = parseFloat(relData.sharesHeld);
    if (!total || total <= 0 || isNaN(held)) return null;
    return Math.round((held / total) * 10000) / 100;
  }, [relData.inputMode, relData.toId, relData.sharesHeld, entities]);

  return (
    <div className="bg-white border-2 border-blue-200 rounded-lg p-2.5 space-y-2 text-xs shadow-md">
      <div className="flex items-center gap-2 text-sm font-bold text-blue-700">
        {isEditing ? <Edit3 size={14} /> : <Plus size={14} />}
        {isEditing ? t.editRelationship : t.addRelationship}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <label className="text-gray-500">{t.from}</label>
          <select className="w-full border rounded px-1.5 py-1 text-xs" value={relData.fromId} onChange={e => setRelData({ ...relData, fromId: e.target.value })} disabled={isEditing}>
            <option value="">{t.select}</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.type === 'company' ? '🏢' : '👤'} {e.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-gray-500">{t.to}</label>
          <select className="w-full border rounded px-1.5 py-1 text-xs" value={relData.toId} onChange={e => setRelData({ ...relData, toId: e.target.value, sharesHeld: '', percentage: relData.inputMode === 'shares' ? 0 : relData.percentage })} disabled={isEditing}>
            <option value="">{t.select}</option>
            {companyEntities.map(e => (<option key={e.id} value={e.id}>🏢 {e.name}{e.totalShares ? ` (${Number(e.totalShares).toLocaleString()} ${t.shares})` : ''}</option>))}
          </select>
          {!isEditing && <div className="text-gray-400 mt-0.5 flex items-center gap-0.5"><Info size={8} />{t.onlyCompaniesAsTarget}</div>}
        </div>
      </div>

      {/* Input Mode Toggle */}
      <div className="bg-slate-50 rounded-lg p-2 space-y-1.5">
        <label className="text-gray-500 font-semibold">{t.inputMode}</label>
        <div className="flex rounded-lg overflow-hidden border">
          <button onClick={() => setRelData({ ...relData, inputMode: 'percentage', sharesHeld: '' })}
            className={`flex-1 py-1.5 text-xs font-medium flex items-center justify-center gap-1 transition ${relData.inputMode === 'percentage' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            <Percent size={11} />{t.byPercentage}
          </button>
          <button onClick={() => setRelData({ ...relData, inputMode: 'shares', percentage: 0 })}
            className={`flex-1 py-1.5 text-xs font-medium flex items-center justify-center gap-1 transition ${relData.inputMode === 'shares' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'} ${!toHasShares ? 'opacity-50' : ''}`}
            disabled={!toHasShares}>
            <Hash size={11} />{t.byShares}
          </button>
        </div>
        {relData.inputMode === 'percentage' ? (
          <div>
            <label className="text-gray-500">{t.ownershipPct}</label>
            <div className="flex items-center gap-1">
              <input type="number" min="0" max="100" step="0.01" className="w-full border rounded px-1.5 py-1.5 text-xs" value={relData.percentage} onChange={e => setRelData({ ...relData, percentage: parseFloat(e.target.value) || 0 })} />
              <span className="text-gray-400 font-bold">%</span>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {!toHasShares && relData.toId && <div className="bg-amber-50 border border-amber-200 rounded p-1.5 text-amber-700 flex items-center gap-1"><AlertCircle size={11} />{t.shareInfo}</div>}
            {toHasShares && (<>
              <div className="flex items-center gap-1 text-gray-500"><Building2 size={10} /><span>{selectedToEntity.name} {t.totalShares}: <strong className="text-gray-800">{Number(selectedToEntity.totalShares).toLocaleString()}</strong></span></div>
              <div>
                <label className="text-gray-500">{t.sharesHeld}</label>
                <div className="flex items-center gap-1">
                  <input type="number" min="0" max={selectedToEntity.totalShares} className="w-full border rounded px-1.5 py-1.5 text-xs" placeholder={`0 — ${Number(selectedToEntity.totalShares).toLocaleString()}`} value={relData.sharesHeld} onChange={e => setRelData({ ...relData, sharesHeld: e.target.value })} />
                  <span className="text-gray-400 text-xs shrink-0">{t.shares}</span>
                </div>
              </div>
              {calcSharesPreview !== null && <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 flex items-center justify-between"><span className="text-blue-700 flex items-center gap-1"><Percent size={11} />{t.autoCalc}:</span><span className="text-blue-900 font-bold text-sm">{calcSharesPreview}%</span></div>}
            </>)}
          </div>
        )}
      </div>

      <div><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={relData.isNominee} onChange={e => setRelData({ ...relData, isNominee: e.target.checked })} />{t.nomineeArrangement}</label></div>
      <div>
        <label className="text-gray-500">{t.controlTypes}</label>
        <div className="flex flex-wrap gap-1 mt-0.5">{CONTROL_TYPES.map(ct => <label key={ct} className="flex items-center gap-0.5 text-xs bg-gray-50 rounded px-1 py-0.5"><input type="checkbox" checked={relData.controlTypes?.includes(ct)} onChange={e => { const types = e.target.checked ? [...(relData.controlTypes || []), ct] : (relData.controlTypes || []).filter(tt => tt !== ct); setRelData({ ...relData, controlTypes: types }); }} />{ct}</label>)}</div>
      </div>
      <div className="flex gap-2">
        <button onClick={onSubmit} className={`${isEditing ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'} text-white px-4 py-1.5 rounded text-xs font-medium flex items-center gap-1`}>
          {isEditing ? <><Check size={12} />{t.update}</> : <><Plus size={12} />{t.add}</>}
        </button>
        <button onClick={onCancel} className="bg-gray-200 px-3 py-1.5 rounded text-xs hover:bg-gray-300">{t.cancel}</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════ MAIN APP ═══════════════════════════ */
export default function CDDApp() {
  const [lang, setLang] = useState('zh');
  const t = i18n[lang];
  const [entities, setEntities] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [activeTab, setActiveTab] = useState('workspace');
  const [auditLog, setAuditLog] = useState([]);
  const [showAddEntity, setShowAddEntity] = useState(false);
  const [newEntity, setNewEntity] = useState(defaultEntity());
  const [editingEntity, setEditingEntity] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showRelForm, setShowRelForm] = useState(false);
  const [newRel, setNewRel] = useState(defaultRel());
  const [editingRel, setEditingRel] = useState(null); // ← NEW: editing relationship state
  const [leftPanelTab, setLeftPanelTab] = useState('entities');
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(null);

  const addAudit = useCallback((action, detail) => {
    setAuditLog(prev => [{ id: auditIdCounter++, timestamp: new Date().toISOString(), action, detail }, ...prev]);
  }, []);

  /* ── Custom Confirm Dialog (replaces window.confirm) ── */
  const CustomConfirm = () => {
    if (!showConfirm) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowConfirm(null)}>
        <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full m-4 p-5 space-y-4" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2 text-amber-600"><AlertTriangle size={20} /><span className="font-bold text-sm">{showConfirm.title || ''}</span></div>
          <p className="text-sm text-gray-700">{showConfirm.message}</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowConfirm(null)} className="px-4 py-1.5 rounded text-xs bg-gray-200 hover:bg-gray-300">{t.cancel}</button>
            <button onClick={() => { showConfirm.onConfirm(); setShowConfirm(null); }} className="px-4 py-1.5 rounded text-xs bg-red-600 text-white hover:bg-red-700 font-medium">{t.save}</button>
          </div>
        </div>
      </div>
    );
  };

  const loadSampleData = () => {
    setShowConfirm({
      title: t.loadSample,
      message: t.loadSampleConfirm,
      onConfirm: () => {
        const sample = generateSampleData();
        setEntities(sample.entities); setRelationships(sample.relationships);
        setSelectedEntity(null); setDetailOpen(false); setShowAddEntity(false);
        setEditingEntity(null); setEditingRel(null); setShowRelForm(false);
        setActiveTab('workspace'); setShowReport(false);
        addAudit(t.sampleLoaded, '10 entities + 9 relationships loaded');
      }
    });
  };

  /* ── Entity CRUD ── */
  const addEntity = () => {
    if (!newEntity.name) return;
    const ne = { ...newEntity, id: Date.now().toString() + Math.random().toString(36).substr(2, 5) };
    setEntities(prev => [...prev, ne]);
    addAudit(t.entityAdded, `${t.added} ${newEntity.type === 'company' ? t.company : t.person}: ${newEntity.name}`);
    setNewEntity(defaultEntity()); setShowAddEntity(false);
  };
  const removeEntity = (id) => {
    const ent = entities.find(e => e.id === id);
    setEntities(prev => prev.filter(e => e.id !== id));
    setRelationships(prev => prev.filter(r => r.fromId !== id && r.toId !== id));
    if (selectedEntity === id) { setSelectedEntity(null); setDetailOpen(false); }
    if (editingRel?.fromId === id || editingRel?.toId === id) { setEditingRel(null); }
    if (ent) addAudit(t.entityRemoved, `${t.removed}: ${ent.name}`);
  };
  const updateEntity = (id, updates) => {
    setEntities(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
    const ent = entities.find(e => e.id === id);
    if (ent) addAudit(t.entityUpdated, `${t.updated} ${ent.name}`);
  };

  /* ── Relationship CRUD ── */
  const computeRelPercentage = (relData) => {
    const toEntity = entities.find(e => e.id === relData.toId);
    let finalPct = relData.percentage;
    let sharesHeld = relData.sharesHeld || '';
    if (relData.inputMode === 'shares' && toEntity) {
      const total = parseFloat(toEntity.totalShares);
      const held = parseFloat(relData.sharesHeld);
      if (total > 0 && held >= 0) {
        finalPct = Math.round((held / total) * 10000) / 100;
        sharesHeld = relData.sharesHeld;
      }
    }
    return { finalPct, sharesHeld };
  };

  const addRelationship = () => {
    if (!newRel.fromId || !newRel.toId || newRel.fromId === newRel.toId) return;
    const toEntity = entities.find(e => e.id === newRel.toId);
    if (toEntity && toEntity.type === 'person') return;
    const { finalPct, sharesHeld } = computeRelPercentage(newRel);
    const relToAdd = { ...newRel, id: Date.now().toString(), percentage: finalPct, sharesHeld };
    setRelationships(prev => [...prev, relToAdd]);
    const from = entities.find(e => e.id === newRel.fromId);
    addAudit(t.relationshipAdded, `${from?.name} → ${toEntity?.name}: ${finalPct}%${sharesHeld ? ` (${sharesHeld} ${t.shares})` : ''}`);
    setNewRel(defaultRel()); setShowRelForm(false);
  };

  const updateRelationship = () => {
    if (!editingRel) return;
    const { finalPct, sharesHeld } = computeRelPercentage(editingRel);
    const updated = { ...editingRel, percentage: finalPct, sharesHeld };
    setRelationships(prev => prev.map(r => r.id === updated.id ? updated : r));
    const from = entities.find(e => e.id === updated.fromId);
    const to2 = entities.find(e => e.id === updated.toId);
    addAudit(t.relationshipUpdated, `${t.updated}: ${from?.name} → ${to2?.name}: ${finalPct}%${sharesHeld ? ` (${sharesHeld} ${t.shares})` : ''}`);
    setEditingRel(null);
  };

  const removeRelationship = (id) => {
    const rel = relationships.find(r => r.id === id);
    const from = entities.find(e => e.id === rel?.fromId);
    const to2 = entities.find(e => e.id === rel?.toId);
    setRelationships(prev => prev.filter(r => r.id !== id));
    if (editingRel?.id === id) setEditingRel(null);
    addAudit(t.relationshipRemoved, `${t.removed}: ${from?.name || '?'} → ${to2?.name || '?'}`);
  };

  const startEditRelationship = (rel) => {
    setEditingRel({ ...rel });
    setShowRelForm(false); // close add form if open
  };

  const companyEntities = useMemo(() => entities.filter(e => e.type === 'company'), [entities]);

  /* ── UBO Calculation ── */
  const findUBOs = useMemo(() => {
    const ubos = [];
    const persons = entities.filter(e => e.type === 'person');
    const companies = entities.filter(e => e.type === 'company');
    const calcChain = (personId, targetId, visited = new Set()) => {
      if (visited.has(targetId)) return [];
      visited.add(targetId);
      const directRels = relationships.filter(r => r.fromId === personId && r.toId === targetId);
      const chains = directRels.map(r => [{ percentage: r.percentage, via: targetId, controlTypes: r.controlTypes, isNominee: r.isNominee }]);
      companies.forEach(comp => {
        const relsToTarget = relationships.filter(r => r.fromId === comp.id && r.toId === targetId);
        if (relsToTarget.length === 0) return;
        const subChains = calcChain(personId, comp.id, new Set(visited));
        subChains.forEach(sc => { relsToTarget.forEach(rt => { chains.push([...sc, { percentage: rt.percentage, via: targetId, controlTypes: rt.controlTypes, isNominee: rt.isNominee }]); }); });
      });
      return chains;
    };
    companies.forEach(company => {
      persons.forEach(person => {
        const chains = calcChain(person.id, company.id);
        chains.forEach(chain => {
          const effectivePct = chain.reduce((acc, step) => acc * step.percentage / 100, 1) * 100;
          const allControlTypes = [...new Set(chain.flatMap(s => s.controlTypes))];
          const hasNominee = chain.some(s => s.isNominee);
          if (effectivePct >= 25 || allControlTypes.some(ct => ct !== 'Ownership'))
            ubos.push({ personId: person.id, personName: person.name, companyId: company.id, companyName: company.name, effectivePct: Math.round(effectivePct * 100) / 100, chain, depth: chain.length, controlTypes: allControlTypes, hasNominee });
        });
      });
    });
    return ubos;
  }, [entities, relationships]);

  /* ── Complexity Warnings ── */
  const complexityWarnings = useMemo(() => {
    const warnings = [];
    entities.forEach(entity => {
      const crr = calcCRR(entity);
      crr.flags.forEach(f => {
        if (['nomineeStructure', 'bearerShareJurisdiction', 'shellRisk'].includes(f)) warnings.push({ entityId: entity.id, entityName: entity.name, warning: t[f] || f, severity: 'high' });
        if (f === 'trustFoundation') warnings.push({ entityId: entity.id, entityName: entity.name, warning: t.autoHighRiskTrust, severity: 'high' });
      });
    });
    const maxDepth = findUBOs.reduce((max, u) => Math.max(max, u.depth), 0);
    if (maxDepth > 3) warnings.push({ entityId: null, entityName: t.complexStructure, warning: `${t.ownershipChainDepth}: ${maxDepth} ${t.assessCommercial}`, severity: 'high' });
    const offshoreCount = [...new Set(entities.map(e => e.jurisdiction))].filter(j => isOffshore(j)).length;
    if (offshoreCount >= 3) warnings.push({ entityId: null, entityName: t.complexStructure, warning: `${offshoreCount} ${t.offshoreJurisdictions}`, severity: 'medium' });
    return warnings;
  }, [entities, relationships, findUBOs, t]);

  const filteredEntities = entities.filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase()) || e.jurisdiction.toLowerCase().includes(searchTerm.toLowerCase()));

  const getReviewCycle = (level, forced) => {
    if (forced) return { months: 12, label: t.annual };
    return level === 'High' ? { months: 12, label: t.annual } : level === 'Medium' ? { months: 24, label: t.biennial } : { months: 36, label: t.triennial };
  };

  const handleSelectEntity = (id) => { setSelectedEntity(id); setDetailOpen(true); };

  /* ── Entity Form ── */
  const ForcedHighRiskBanner = ({ entity }) => {
    if (!isForcedHighRisk(entity)) return null;
    return (
      <div className="bg-red-100 border-2 border-red-400 border-dashed rounded-lg p-2 text-xs">
        <div className="flex items-center gap-1.5 text-red-800 font-bold"><Lock size={12} /><span>{t.lockedHighRisk}</span><span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-xs ml-auto">{t.autoTag}</span></div>
        <div className="text-red-700 mt-1">{entity.subtype === 'Nominee Shareholder' ? t.autoHighRiskNominee : t.autoHighRiskTrust}</div>
      </div>
    );
  };

  const EntityForm = ({ entity, setEntity, onSubmit, onCancel, title }) => {
    const subtypes = entity.type === 'company' ? ENTITY_SUBTYPES_COMPANY : ENTITY_SUBTYPES_PERSON;
    const forced = isForcedHighRisk(entity);
    return (
      <div className="bg-white border-2 border-blue-200 rounded-lg p-2.5 space-y-1.5 text-xs shadow-md">
        <h3 className="font-bold text-sm flex items-center gap-2 text-blue-700">{title === t.editEntity ? <Edit3 size={14} /> : <Plus size={14} />}{title}</h3>
        {forced && <ForcedHighRiskBanner entity={entity} />}
        <div className="grid grid-cols-2 gap-1.5">
          <div><label className="text-gray-500">{t.name} *</label><input className="w-full border rounded px-1.5 py-1 text-xs" value={entity.name} onChange={e => setEntity({ ...entity, name: e.target.value })} /></div>
          <div><label className="text-gray-500">{t.type}</label><select className="w-full border rounded px-1.5 py-1 text-xs" value={entity.type} onChange={e => { const nT = e.target.value; setEntity({ ...entity, type: nT, subtype: nT === 'company' ? 'Standard Company' : 'Individual', totalShares: nT === 'person' ? '' : entity.totalShares }); }}><option value="company">{t.company}</option><option value="person">{t.person}</option></select></div>
          <div><label className="text-gray-500">{t.jurisdiction}</label><select className="w-full border rounded px-1.5 py-1 text-xs" value={entity.jurisdiction} onChange={e => setEntity({ ...entity, jurisdiction: e.target.value })}>{ALL_JURISDICTIONS.map(j => <option key={j} value={j}>{j}{FATF_HIGH_RISK.includes(j) ? ' ⚠️' : isOffshore(j) ? ' 🏝️' : ''}</option>)}</select></div>
          <div><label className="text-gray-500 flex items-center gap-1">{t.subtype}{FORCED_HIGH_RISK_SUBTYPES.includes(entity.subtype) && <Lock size={9} className="text-red-500" />}</label><select className="w-full border rounded px-1.5 py-1 text-xs" value={entity.subtype} onChange={e => setEntity({ ...entity, subtype: e.target.value })}>{subtypes.map(s => <option key={s} value={s}>{s}{FORCED_HIGH_RISK_SUBTYPES.includes(s) ? ' 🔒' : ''}</option>)}</select></div>
          {entity.type === 'company' && (<div className="col-span-2"><label className="text-gray-500 flex items-center gap-1"><Hash size={10} />{t.totalShares}</label><input type="number" min="0" className="w-full border rounded px-1.5 py-1 text-xs" placeholder="e.g. 10000" value={entity.totalShares} onChange={e => setEntity({ ...entity, totalShares: e.target.value })} /><div className="text-gray-400 mt-0.5 text-xs flex items-center gap-1"><Info size={9} />{t.shareInfo}</div></div>)}
          <div><label className="text-gray-500">{t.pepStatus}</label><select className="w-full border rounded px-1.5 py-1 text-xs" value={entity.pepType} onChange={e => setEntity({ ...entity, pepType: e.target.value })}>{PEP_TYPES.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
          <div><label className="text-gray-500">{t.sanctions}</label><select className="w-full border rounded px-1.5 py-1 text-xs" value={entity.sanctionStatus} onChange={e => setEntity({ ...entity, sanctionStatus: e.target.value })}>{SANCTION_STATUS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
          <div><label className="text-gray-500">{t.adverseMedia}</label><select className="w-full border rounded px-1.5 py-1 text-xs" value={entity.adverseMedia} onChange={e => setEntity({ ...entity, adverseMedia: e.target.value })}>{ADVERSE_MEDIA_STATUS.map(a => <option key={a} value={a}>{a}</option>)}</select></div>
          <div><label className="text-gray-500">{t.industry}</label><select className="w-full border rounded px-1.5 py-1 text-xs" value={entity.industry} onChange={e => setEntity({ ...entity, industry: e.target.value })}><option value="">{t.select}</option>{HIGH_RISK_INDUSTRIES.map(i2 => <option key={i2} value={i2}>⚠️ {i2}</option>)}<option value="Banking">Banking</option><option value="Insurance">Insurance</option><option value="Manufacturing">Manufacturing</option><option value="Technology">Technology</option><option value="Retail">Retail</option><option value="Other">Other</option></select></div>
          <div><label className="text-gray-500">{t.sof}</label><select className="w-full border rounded px-1.5 py-1 text-xs" value={entity.sof} onChange={e => setEntity({ ...entity, sof: e.target.value })}><option value="">{t.select}</option>{SOF_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
          <div><label className="text-gray-500">{t.sofDetail}</label><input className="w-full border rounded px-1.5 py-1 text-xs" value={entity.sofDetail} onChange={e => setEntity({ ...entity, sofDetail: e.target.value })} /></div>
          <div><label className="text-gray-500">{t.sow}</label><select className="w-full border rounded px-1.5 py-1 text-xs" value={entity.sow} onChange={e => setEntity({ ...entity, sow: e.target.value })}><option value="">{t.select}</option>{SOF_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
          <div><label className="text-gray-500">{t.sowDetail}</label><input className="w-full border rounded px-1.5 py-1 text-xs" value={entity.sowDetail} onChange={e => setEntity({ ...entity, sowDetail: e.target.value })} /></div>
          {entity.type === 'company' && <div><label className="text-gray-500">{t.incorporationDate}</label><input type="date" className="w-full border rounded px-1.5 py-1 text-xs" value={entity.incorporationDate} onChange={e => setEntity({ ...entity, incorporationDate: e.target.value })} /></div>}
          <div><label className="text-gray-500">{t.lastReviewDate}</label><input type="date" className="w-full border rounded px-1.5 py-1 text-xs" value={entity.lastReviewDate} onChange={e => setEntity({ ...entity, lastReviewDate: e.target.value })} /></div>
          <div className="col-span-2"><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={entity.isRegulated} onChange={e => setEntity({ ...entity, isRegulated: e.target.checked })} /> {t.regulated}</label></div>
          <div className="col-span-2"><label className="text-gray-500">{t.notes}</label><textarea className="w-full border rounded px-1.5 py-1 text-xs" rows={2} value={entity.notes} onChange={e => setEntity({ ...entity, notes: e.target.value })} /></div>
        </div>
        <div className="flex gap-2">
          <button onClick={onSubmit} className={`${title === t.editEntity ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'} text-white px-4 py-1.5 rounded text-xs font-medium flex items-center gap-1`}>
            {title === t.editEntity ? <><Check size={12} />{t.save}</> : <><Plus size={12} />{t.save}</>}
          </button>
          <button onClick={onCancel} className="bg-gray-200 px-3 py-1.5 rounded text-xs hover:bg-gray-300">{t.cancel}</button>
        </div>
      </div>
    );
  };

  /* ── Detail Modal ── */
  const DetailModal = () => {
    const entity = entities.find(e => e.id === selectedEntity);
    if (!entity || !detailOpen) return null;
    const crr = calcCRR(entity);
    const cycle = getReviewCycle(crr.level, crr.forced);
    const relatedUBOs = findUBOs.filter(u => u.companyId === selectedEntity);
    const incomingRels = relationships.filter(r => r.toId === selectedEntity);
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setDetailOpen(false)}>
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-screen overflow-y-auto m-4 p-4 space-y-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold flex items-center gap-2">
              {entity.type === 'company' ? <Building2 size={18} className="text-blue-600" /> : <User size={18} className="text-green-600" />}
              {entity.name}
              {entity.sanctionStatus === 'Confirmed Hit' && <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded animate-pulse">{t.sanctioned}</span>}
              {crr.forced && <span className="bg-red-700 text-white text-xs px-2 py-0.5 rounded flex items-center gap-0.5"><Lock size={9} />{t.autoTag}</span>}
            </h3>
            <div className="flex items-center gap-1">
              <button onClick={() => { setEditingEntity({ ...entity }); setShowAddEntity(false); setDetailOpen(false); setLeftPanelTab('entities'); }} className="text-blue-500 hover:text-blue-700 flex items-center gap-0.5 text-xs border border-blue-200 rounded px-2 py-1 hover:bg-blue-50"><Edit3 size={12} />{t.editEntity}</button>
              <button onClick={() => setDetailOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
          </div>
          {crr.forced && <div className="bg-red-100 border-2 border-red-400 border-dashed rounded-lg p-2.5"><div className="flex items-center gap-2 text-red-800 font-bold text-xs"><Lock size={14} /><span>{t.lockedHighRisk}</span></div><div className="text-red-700 text-xs mt-1">{entity.subtype === 'Nominee Shareholder' ? t.autoHighRiskNominee : t.autoHighRiskTrust}</div><div className="text-red-600 text-xs mt-1 flex items-center gap-1"><Clock size={10} />{t.forcedAnnualReview}: {t.annual} | EDD</div></div>}
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-500">{t.type}:</span> <span className="font-medium">{entity.type === 'company' ? t.company : t.person}</span></div>
            <div className={`rounded p-1.5 ${crr.forced ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}><span className="text-gray-500">{t.subtype}:</span> <span className="font-medium">{entity.subtype}</span>{crr.forced && <Lock size={9} className="inline ml-1 text-red-500" />}</div>
            <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-500">{t.jurisdiction}:</span> <span className="font-medium">{entity.jurisdiction}</span> {riskBadge(getJurisdictionRisk(entity.jurisdiction), t)}</div>
            <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-500">{t.industry}:</span> <span className="font-medium">{entity.industry || 'N/A'}</span></div>
            {entity.type === 'company' && entity.totalShares && <div className="bg-gray-50 rounded p-1.5 col-span-2"><span className="text-gray-500">{t.totalShares}:</span> <span className="font-medium">{Number(entity.totalShares).toLocaleString()} {t.shares}</span></div>}
          </div>
          <div className={`rounded-lg p-2.5 border ${crr.level === 'High' ? 'bg-red-50 border-red-200' : crr.level === 'Medium' ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>
            <div className="flex items-center justify-between mb-1"><span className="font-bold text-xs flex items-center gap-1">{t.crr}{crr.forced && <span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-xs flex items-center gap-0.5"><Lock size={8} />{t.autoTag}</span>}</span><div className="flex items-center gap-2">{riskBadge(crr.level, t)} <span className="text-xs font-mono">{crr.score}/100</span></div></div>
            <div className="w-full bg-gray-200 rounded-full h-1.5 mb-1"><div className={`h-1.5 rounded-full ${crr.level === 'High' ? 'bg-red-500' : crr.level === 'Medium' ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${crr.score}%` }}></div></div>
            <div className="text-xs space-y-0.5">{crr.flags.map((f, i) => <div key={i} className="flex items-center gap-1"><AlertCircle size={9} />{t[f] || f}</div>)}</div>
            <div className={`mt-1 text-xs flex items-center gap-1 ${crr.forced ? 'text-red-700 font-semibold' : ''}`}>{crr.forced ? <Lock size={9} /> : <Clock size={9} />}{t.reviewCycle}: {cycle.label} | {crr.level === 'High' ? t.edd : crr.level === 'Medium' ? t.cdd : t.sdd}</div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-xs">
            <div className={`rounded p-1.5 border ${entity.pepType !== 'None' ? 'bg-amber-50 border-amber-200' : 'bg-gray-50'}`}><Crown size={10} /><div className="font-semibold">{t.pepStatus}</div><div>{entity.pepType}</div></div>
            <div className={`rounded p-1.5 border ${entity.sanctionStatus.includes('Hit') ? 'bg-red-50 border-red-200' : 'bg-gray-50'}`}><Ban size={10} /><div className="font-semibold">{t.sanctions}</div><div>{entity.sanctionStatus}</div></div>
            <div className={`rounded p-1.5 border ${entity.adverseMedia?.includes('High') ? 'bg-red-50 border-red-200' : 'bg-gray-50'}`}><Search size={10} /><div className="font-semibold">{t.adverseMedia}</div><div>{entity.adverseMedia}</div></div>
          </div>
          {incomingRels.length > 0 && <div><div className="text-xs font-semibold mb-1">{t.shareholders}:</div>{incomingRels.map(r => { const from = entities.find(e => e.id === r.fromId); return from ? <div key={r.id} className="text-xs bg-gray-50 rounded p-1 mb-0.5">{from.name} → {r.percentage}%{r.sharesHeld ? ` (${Number(r.sharesHeld).toLocaleString()} ${t.shares})` : ''} ({r.controlTypes?.join(', ')}) {r.isNominee && <span className="text-red-600 font-semibold">[{t.nominee}]</span>}</div> : null; })}</div>}
          {relatedUBOs.length > 0 && <div><div className="text-xs font-semibold mb-1">{t.identifiedUBOs}:</div>{relatedUBOs.map((u, i) => <div key={i} className="text-xs bg-purple-50 border border-purple-200 rounded p-1 mb-0.5"><span className="font-semibold">{u.personName}</span> — {u.effectivePct}% {t.effectiveOwnership} {u.hasNominee && <span className="text-red-600">[{t.viaNominee}]</span>}</div>)}</div>}
          {entity.notes && <div className="text-xs bg-gray-50 rounded p-1.5"><span className="font-semibold">{t.notes}:</span> {entity.notes}</div>}
        </div>
      </div>
    );
  };

  /* ── Report View ── */
  const ReportView = () => {
    const highRiskEntities = entities.filter(e => calcCRR(e).level === 'High');
    const forcedEntities = entities.filter(e => isForcedHighRisk(e));
    const sanctionHits = entities.filter(e => e.sanctionStatus === 'Confirmed Hit' || e.sanctionStatus === 'Potential Hit');
    const peps = entities.filter(e => e.pepType !== 'None');
    return (
      <div className="space-y-3 p-4 overflow-y-auto h-full">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">📋 {t.reportTitle}</h2><button onClick={() => setShowReport(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button></div>
        <div className="text-xs text-gray-500">{t.generated}: {new Date().toISOString().split('T')[0]}</div>
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="bg-blue-50 rounded p-2"><div className="text-xl font-bold text-blue-700">{entities.length}</div><div className="text-xs">{t.totalEntities}</div></div>
          <div className="bg-red-50 rounded p-2"><div className="text-xl font-bold text-red-700">{highRiskEntities.length}</div><div className="text-xs">{t.highRiskCount}</div></div>
          <div className="bg-purple-50 rounded p-2"><div className="text-xl font-bold text-purple-700">{findUBOs.length}</div><div className="text-xs">{t.ubosIdentified}</div></div>
          <div className="bg-orange-50 rounded p-2"><div className="text-xl font-bold text-orange-700">{complexityWarnings.length}</div><div className="text-xs">{t.warningsCount}</div></div>
        </div>
        {forcedEntities.length > 0 && <div className="bg-red-50 border-2 border-red-300 border-dashed rounded-lg p-3"><div className="font-bold text-red-800 text-sm flex items-center gap-1"><Lock size={14} />{t.forcedHighRisk}</div><div className="text-xs text-red-700 mt-1 mb-2">{t.trustNomineePolicy}</div>{forcedEntities.map(e => <div key={e.id} className="text-xs mt-1 flex items-center gap-1">• <span className="font-semibold">{e.name}</span> <span className="text-red-500">({e.subtype})</span> — {t.annual} | EDD</div>)}</div>}
        {sanctionHits.length > 0 && <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3"><div className="font-bold text-red-800 text-sm flex items-center gap-1"><Ban size={14} />{t.sanctionsAlert}</div>{sanctionHits.map(e => <div key={e.id} className="text-xs mt-1">• {e.name}: {e.sanctionStatus}</div>)}</div>}
        {peps.length > 0 && <div className="bg-amber-50 border border-amber-300 rounded-lg p-3"><div className="font-bold text-amber-800 text-sm flex items-center gap-1"><Crown size={14} />{t.pepIdentified}</div>{peps.map(e => <div key={e.id} className="text-xs mt-1">• {e.name}: {e.pepType}</div>)}</div>}
        {findUBOs.length > 0 && <div className="bg-purple-50 border border-purple-200 rounded-lg p-3"><div className="font-bold text-sm mb-1">{t.uboSummary}</div>{findUBOs.map((u, i) => <div key={i} className="text-xs mt-1">• {u.personName} → {u.companyName}: {u.effectivePct}% {u.hasNominee && `⚠️ ${t.viaNominee}`}</div>)}</div>}
        {complexityWarnings.length > 0 && <div className="bg-orange-50 border border-orange-200 rounded-lg p-3"><div className="font-bold text-sm mb-1">⚠️ {t.complexityWarnings}</div>{complexityWarnings.map((w, i) => <div key={i} className="text-xs mt-1">• {w.entityName}: {w.warning}</div>)}</div>}
        <div className="border rounded-lg overflow-hidden"><table className="w-full text-xs"><thead className="bg-gray-100"><tr><th className="p-1.5 text-left">{t.name}</th><th className="p-1.5">{t.type}</th><th className="p-1.5">{t.subtype}</th><th className="p-1.5">{t.jurisdiction}</th><th className="p-1.5">{t.crr}</th><th className="p-1.5">{t.ddLevel}</th><th className="p-1.5">{t.reviewCycle}</th></tr></thead><tbody>{entities.map(e => { const crr = calcCRR(e); const cycle = getReviewCycle(crr.level, crr.forced); return (<tr key={e.id} className={`border-t ${crr.forced ? 'bg-red-50' : ''}`}><td className="p-1.5 font-medium flex items-center gap-1">{e.name}{crr.forced && <Lock size={9} className="text-red-500" />}</td><td className="p-1.5 text-center">{e.type === 'company' ? t.company : t.person}</td><td className={`p-1.5 text-center ${crr.forced ? 'text-red-700 font-semibold' : ''}`}>{e.subtype}</td><td className="p-1.5 text-center">{e.jurisdiction}</td><td className="p-1.5 text-center">{riskBadge(crr.level, t)}</td><td className="p-1.5 text-center">{crr.level === 'High' ? 'EDD' : crr.level === 'Medium' ? 'CDD' : 'SDD'}</td><td className={`p-1.5 text-center ${crr.forced ? 'text-red-700 font-bold' : ''}`}>{cycle.label}</td></tr>); })}</tbody></table></div>
      </div>
    );
  };

  const tabs = [
    { key: 'workspace', label: t.workspace, icon: <Layers size={13} /> },
    { key: 'ubos', label: t.uboAnalysis, icon: <Eye size={13} /> },
    { key: 'warnings', label: `${t.warnings} (${complexityWarnings.length})`, icon: <AlertTriangle size={13} /> },
    { key: 'audit', label: t.auditTrail, icon: <History size={13} /> },
  ];

  return (
    <div className="h-screen flex flex-col bg-gray-50 text-gray-900 overflow-hidden">
      {/* HEADER */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-4 py-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Shield size={22} /><div><h1 className="text-sm font-bold leading-tight">{t.appTitle}</h1><p className="text-xs text-slate-400">{t.appSubtitle}</p></div></div>
          <div className="flex items-center gap-2">
            <button onClick={loadSampleData} className="bg-purple-500/80 hover:bg-purple-500 px-2.5 py-1 rounded text-xs flex items-center gap-1 transition"><Layers size={13} />{t.loadSample}</button>
            <button onClick={() => setLang(lang === 'en' ? 'zh' : 'en')} className="bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded text-xs flex items-center gap-1"><Languages size={13} />{lang === 'en' ? '中文' : 'EN'}</button>
            <button onClick={() => { setShowReport(true); setActiveTab('report'); }} className="bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded text-xs flex items-center gap-1"><FileText size={13} />{t.report}</button>
          </div>
        </div>
      </div>
      <div className="bg-red-50 border-b border-red-200 px-4 py-1 text-xs text-red-700 flex items-center gap-2 shrink-0"><Lock size={11} className="shrink-0" /><span className="font-medium">{t.trustNomineePolicy}</span></div>

      {/* TABS */}
      <div className="flex border-b bg-white shrink-0 overflow-x-auto">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => { setActiveTab(tab.key); setShowReport(false); }}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium border-b-2 whitespace-nowrap transition ${activeTab === tab.key && !showReport ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* BODY */}
      <div className="flex-1 flex overflow-hidden">
        {showReport ? <ReportView /> : (
          <>
            {activeTab === 'workspace' && (
              <>
                {/* LEFT PANEL */}
                <div className={`shrink-0 border-r bg-white flex flex-col transition-all duration-200 ${panelCollapsed ? 'w-10' : 'w-96'}`}>
                  {panelCollapsed ? (
                    <div className="flex flex-col items-center py-2 gap-2">
                      <button onClick={() => setPanelCollapsed(false)} className="text-gray-400 hover:text-blue-600"><PanelLeftOpen size={16} /></button>
                      <div className="text-xs text-gray-400 mt-2" style={{ writingMode: 'vertical-rl' }}>{t.entitiesPanel} & {t.relationshipsPanel}</div>
                    </div>
                  ) : (
                    <>
                      <div className="flex border-b shrink-0">
                        <button onClick={() => setLeftPanelTab('entities')} className={`flex-1 text-xs py-1.5 font-medium border-b-2 flex items-center justify-center gap-1 ${leftPanelTab === 'entities' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}><Users size={12} />{t.entitiesPanel}</button>
                        <button onClick={() => setLeftPanelTab('relationships')} className={`flex-1 text-xs py-1.5 font-medium border-b-2 flex items-center justify-center gap-1 ${leftPanelTab === 'relationships' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}><Link2 size={12} />{t.relationshipsPanel}</button>
                        <button onClick={() => setPanelCollapsed(true)} className="px-2 text-gray-400 hover:text-gray-600"><PanelLeftClose size={14} /></button>
                      </div>
                      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                        {/* ═══ ENTITIES TAB ═══ */}
                        {leftPanelTab === 'entities' && (
                          <>
                            <div className="flex items-center gap-1">
                              <div className="relative flex-1"><Search size={12} className="absolute left-2 top-2 text-gray-400" /><input className="w-full border rounded pl-7 pr-2 py-1.5 text-xs" placeholder={t.search} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div>
                              <button onClick={() => { setShowAddEntity(true); setEditingEntity(null); }} className="bg-blue-600 text-white px-2 py-1.5 rounded text-xs hover:bg-blue-700 flex items-center gap-0.5 whitespace-nowrap shrink-0"><Plus size={12} />{t.addEntity}</button>
                            </div>
                            {showAddEntity && !editingEntity && <EntityForm entity={newEntity} setEntity={setNewEntity} onSubmit={addEntity} onCancel={() => setShowAddEntity(false)} title={t.addEntity} />}
                            {editingEntity && <EntityForm entity={editingEntity} setEntity={setEditingEntity} onSubmit={() => { updateEntity(editingEntity.id, editingEntity); setEditingEntity(null); }} onCancel={() => setEditingEntity(null)} title={t.editEntity} />}
                            {filteredEntities.map(entity => {
                              const crr = calcCRR(entity);
                              const isBeingEdited = editingEntity?.id === entity.id;
                              return (
                                <div key={entity.id}
                                  className={`border rounded-lg p-2 hover:shadow-sm transition cursor-pointer text-xs ${selectedEntity === entity.id ? 'ring-2 ring-blue-400 bg-blue-50' : 'bg-white'} ${isBeingEdited ? 'ring-2 ring-green-400' : ''} ${entity.sanctionStatus === 'Confirmed Hit' ? 'border-red-400 bg-red-50' : crr.forced ? 'border-red-300 border-dashed bg-red-50/50' : ''}`}
                                  onClick={() => handleSelectEntity(entity.id)}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1 flex-wrap min-w-0">
                                      {entity.type === 'company' ? <Building2 size={13} className="text-blue-600 shrink-0" /> : <User size={13} className="text-green-600 shrink-0" />}
                                      <span className="font-semibold truncate">{entity.name}</span>
                                      {crr.forced && <span className="bg-red-700 text-white text-xs px-1 rounded flex items-center gap-0.5 shrink-0"><Lock size={8} />{t.autoTag}</span>}
                                      {entity.pepType !== 'None' && <span className="bg-amber-100 text-amber-800 text-xs px-1 rounded shrink-0">PEP</span>}
                                      {entity.sanctionStatus === 'Confirmed Hit' && <span className="bg-red-600 text-white text-xs px-1 rounded animate-pulse shrink-0">⛔</span>}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0 ml-1">
                                      {riskBadge(crr.level, t)}
                                      <button onClick={(e) => { e.stopPropagation(); setEditingEntity({ ...entity }); setShowAddEntity(false); }} className="text-gray-400 hover:text-blue-600 p-0.5 rounded hover:bg-blue-50" title={t.editEntity}><Edit3 size={12} /></button>
                                      <button onClick={(e) => { e.stopPropagation(); removeEntity(entity.id); }} className="text-gray-400 hover:text-red-600 p-0.5 rounded hover:bg-red-50"><Trash2 size={12} /></button>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5 text-gray-500">
                                    <span className="flex items-center gap-0.5"><Globe size={9} />{entity.jurisdiction}</span>
                                    <span className={crr.forced ? 'text-red-600 font-semibold' : ''}>CRR: {crr.score}</span>
                                    {entity.type === 'company' && entity.totalShares && <span className="flex items-center gap-0.5"><Hash size={9} />{Number(entity.totalShares).toLocaleString()}</span>}
                                  </div>
                                </div>
                              );
                            })}
                            {entities.length === 0 && (
                              <div className="text-center py-8 space-y-3">
                                <div className="text-gray-400 text-xs">{t.noEntities}</div>
                                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-purple-700">
                                  <div className="font-semibold mb-1">💡 {t.loadSample}</div>
                                  <div>{t.sampleDescription}</div>
                                  <button onClick={loadSampleData} className="mt-2 bg-purple-600 text-white px-4 py-1.5 rounded-lg text-xs hover:bg-purple-700 transition font-medium">{t.loadSample}</button>
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        {/* ═══ RELATIONSHIPS TAB ═══ */}
                        {leftPanelTab === 'relationships' && (
                          <>
                            <button onClick={() => { setShowRelForm(true); setEditingRel(null); }} className="bg-blue-600 text-white px-3 py-1.5 rounded text-xs hover:bg-blue-700 flex items-center gap-1 w-full justify-center"><Plus size={12} />{t.addRelationship}</button>
                            {companyEntities.length === 0 && <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800 flex items-center gap-1"><Info size={12} />{t.noCompanyTarget}</div>}

                            {/* ADD form */}
                            {showRelForm && !editingRel && (
                              <RelationshipForm
                                relData={newRel} setRelData={setNewRel}
                                entities={entities} companyEntities={companyEntities}
                                onSubmit={addRelationship} onCancel={() => { setShowRelForm(false); setNewRel(defaultRel()); }}
                                isEditing={false} t={t}
                              />
                            )}

                            {/* EDIT form */}
                            {editingRel && (
                              <RelationshipForm
                                relData={editingRel} setRelData={setEditingRel}
                                entities={entities} companyEntities={companyEntities}
                                onSubmit={updateRelationship} onCancel={() => setEditingRel(null)}
                                isEditing={true} t={t}
                              />
                            )}

                            {/* Relationship list */}
                            {relationships.map(rel => {
                              const from = entities.find(e => e.id === rel.fromId);
                              const to2 = entities.find(e => e.id === rel.toId);
                              const isBeingEdited = editingRel?.id === rel.id;
                              return (
                                <div key={rel.id} className={`bg-white border rounded-lg p-2 text-xs transition ${rel.isNominee ? 'border-red-300 bg-red-50' : ''} ${isBeingEdited ? 'ring-2 ring-green-400 bg-green-50' : 'hover:shadow-sm'}`}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1 flex-wrap min-w-0">
                                      <span className="font-medium">{from?.name || '?'}</span>
                                      <span className="text-gray-400">→</span>
                                      <span className="font-medium">{to2?.name || '?'}</span>
                                      <span className="bg-blue-100 text-blue-800 px-1.5 rounded font-semibold">{rel.percentage}%</span>
                                      {rel.sharesHeld && <span className="bg-slate-100 text-slate-600 px-1.5 rounded">{Number(rel.sharesHeld).toLocaleString()} {t.shares}</span>}
                                      {rel.isNominee && <span className="bg-red-100 text-red-800 px-1.5 rounded">{t.nominee}</span>}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0 ml-1">
                                      <button onClick={() => startEditRelationship(rel)} className="text-gray-400 hover:text-blue-600 p-0.5 rounded hover:bg-blue-50" title={t.editRelationship}><Edit3 size={12} /></button>
                                      <button onClick={() => removeRelationship(rel.id)} className="text-gray-400 hover:text-red-600 p-0.5 rounded hover:bg-red-50"><Trash2 size={12} /></button>
                                    </div>
                                  </div>
                                  <div className="text-gray-500 mt-0.5">{rel.controlTypes?.join(', ')}</div>
                                </div>
                              );
                            })}
                            {relationships.length === 0 && !showRelForm && <div className="text-center text-gray-400 py-8 text-xs">{t.noRelationships}</div>}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
                {/* DAG */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  <DAGCanvas entities={entities} relationships={relationships} t={t} selectedEntity={selectedEntity} onSelectEntity={handleSelectEntity} />
                </div>
              </>
            )}

            {activeTab === 'ubos' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                <h2 className="font-bold text-sm flex items-center gap-2"><Eye size={16} />{t.uboAnalysis}</h2>
                <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs">{t.uboThreshold}</div>
                {findUBOs.length > 0 ? findUBOs.map((ubo, i) => {
                  const person = entities.find(e => e.id === ubo.personId);
                  const crr = person ? calcCRR(person) : { level: 'Low', score: 0, flags: [], forced: false };
                  return (
                    <div key={i} className={`bg-white border rounded-lg p-2.5 ${crr.level === 'High' ? 'border-red-300' : ''} ${crr.forced ? 'border-dashed border-red-400' : ''}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2"><User size={15} className="text-purple-600" /><span className="font-bold text-sm">{ubo.personName}</span>{riskBadge(crr.level, t)}{crr.forced && <span className="bg-red-700 text-white text-xs px-1.5 rounded flex items-center gap-0.5"><Lock size={8} />{t.autoTag}</span>}{person?.pepType !== 'None' && <span className="bg-amber-100 text-amber-800 text-xs px-1.5 rounded">PEP: {person.pepType}</span>}{ubo.hasNominee && <span className="bg-red-100 text-red-800 text-xs px-1.5 rounded">{t.viaNominee}</span>}</div>
                        <span className="text-lg font-bold text-purple-700">{ubo.effectivePct}%</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">→ {ubo.companyName} | {t.depth}: {ubo.depth} {t.layers} | {t.control}: {ubo.controlTypes.join(', ')}</div>
                      {person?.sanctionStatus === 'Confirmed Hit' && <div className="text-xs mt-1 text-red-600 font-bold">⛔ {t.blockTransaction}</div>}
                      {crr.flags.length > 0 && <div className="text-xs mt-1 text-gray-600">{t.flags}: {crr.flags.map(f => t[f] || f).join(' | ')}</div>}
                    </div>
                  );
                }) : <div className="text-center text-gray-400 py-12 text-sm">{t.noUBOs}</div>}
              </div>
            )}

            {activeTab === 'warnings' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                <h2 className="font-bold text-sm flex items-center gap-2"><AlertTriangle size={16} />{t.warnings}</h2>
                {entities.filter(e => e.sanctionStatus === 'Confirmed Hit').length > 0 && (
                  <div className="bg-red-100 border-2 border-red-400 rounded-lg p-3"><div className="font-bold text-red-800 flex items-center gap-2"><Ban size={16} />{t.criticalSanctions}</div>{entities.filter(e => e.sanctionStatus === 'Confirmed Hit').map(e => <div key={e.id} className="text-sm mt-1 text-red-700">• {e.name} — {t.escalateMLRO}</div>)}</div>
                )}
                {complexityWarnings.map((w, i) => (
                  <div key={i} className={`border rounded-lg p-2.5 flex items-start gap-2 ${w.severity === 'high' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}`}>
                    <AlertTriangle size={14} className={`mt-0.5 ${w.severity === 'high' ? 'text-red-500' : 'text-yellow-500'}`} />
                    <div><div className="text-sm font-semibold">{w.entityName}</div><div className="text-xs text-gray-600">{w.warning}</div></div>
                  </div>
                ))}
                {entities.filter(e => isBearerShareRisk(e.jurisdiction)).map(e => (
                  <div key={e.id} className="bg-orange-50 border border-orange-200 rounded-lg p-2.5 flex items-start gap-2"><AlertCircle size={14} className="text-orange-500 mt-0.5" /><div><div className="text-sm font-semibold">{e.name}</div><div className="text-xs">{t.bearerShareWarning} ({e.jurisdiction})</div></div></div>
                ))}
                {complexityWarnings.length === 0 && entities.filter(e => e.sanctionStatus === 'Confirmed Hit').length === 0 && <div className="text-center text-gray-400 py-12 text-sm flex flex-col items-center gap-2"><ShieldCheck size={28} />{t.noWarnings}</div>}
              </div>
            )}

            {activeTab === 'audit' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                <h2 className="font-bold text-sm flex items-center gap-2"><History size={16} />{t.auditTrail}</h2>
                <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs">{t.allChangesLogged}</div>
                {auditLog.length > 0 ? auditLog.map(log => (
                  <div key={log.id} className="bg-white border rounded p-2 text-xs flex items-start gap-2"><Clock size={11} className="mt-0.5 text-gray-400 shrink-0" /><div><div className="font-semibold">{log.action}</div><div className="text-gray-500">{log.detail}</div><div className="text-gray-400 mt-0.5">{new Date(log.timestamp).toLocaleString()}</div></div></div>
                )) : <div className="text-center text-gray-400 py-12 text-sm">{t.noAudit}</div>}
              </div>
            )}
          </>
        )}
      </div>
      <DetailModal />
      <CustomConfirm />
    </div>
  );
}

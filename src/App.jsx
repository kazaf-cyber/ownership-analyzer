import React, { useState, useMemo } from 'react';
import { Search, Brain, AlertTriangle, CheckCircle, XCircle, Info, ChevronDown, ChevronRight, Globe, ExternalLink, Loader, Shield } from 'lucide-react';

/* ========== 語言檢測與關鍵字 ========== */

/**
 * 自動檢測文字主要語言（中文 vs 英文）
 * @param {string} text - 要檢測的文字
 * @returns {string} 'zh' | 'en'
 */
function detectLanguage(text) {
  // 計算中文字符數量（Unicode 範圍：\u4e00-\u9fa5）
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g);
  const chineseCount = chineseChars ? chineseChars.length : 0;
  
  // 計算總字符數（排除空格和標點）
  const totalChars = text.replace(/[\s\p{P}]/gu, '').length;
  
  // 如果中文字符超過 30%，判定為中文
  const chineseRatio = totalChars > 0 ? chineseCount / totalChars : 0;
  
  return chineseRatio > 0.3 ? 'zh' : 'en';
}

// 英文關鍵字（ML/TF/制裁相關）
const EN_KEYWORDS = [
  'market abuse', 'regulatory breach', 'tax evasion', 
  'allegation', 'bribery', 'corruption', 'criminal', 
  'fraud', 'illegal', 'indict', 'investigation', 
  'laundering', 'lawsuit', 'penalty', 'prosecution', 
  'sanctions', 'terrorist', 'trafficking', 'ML', 'AML'
];

// 中文關鍵字（洗錢/恐怖融資/制裁相關）
const ZH_KEYWORDS = [
  '市場濫用', '監管違規', '逃稅', '指控', '賄賂', 
  '腐敗', '刑事', '欺詐', '非法', '起訴', 
  '調查', '洗錢', '訴訟', '處罰', '檢舉', 
  '制裁', '恐怖分子', '販運', '洗錢', '反洗錢'
];

/**
 * 根據實體名稱自動構建查詢字串
 * @param {string} entityName - 實體名稱
 * @returns {object} { query: string, detectedLang: string, keywords: string[] }
 */
function buildQueryAuto(entityName) {
  const detectedLang = detectLanguage(entityName);
  const keywords = detectedLang === 'zh' ? ZH_KEYWORDS : EN_KEYWORDS;
  const keywordString = keywords.map(k => `"${k}"`).join(' OR ');
  const query = `"${entityName}" (${keywordString})`;
  
  return { query, detectedLang, keywords };
}

/* ========== 分類配置（4類）========== */

const CLS_CONFIG = {
  'TRUE_HIT': {
    label: 'True Hit',
    labelZh: '真實命中',
    desc: 'The hit is confirmed to be the subject and is associated with negative news related to ML/TF or sanctions',
    icon: AlertTriangle,
    bg: 'bg-red-50',
    border: 'border-red-300',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-800 border-red-200'
  },
  'FALSE_HIT': {
    label: 'False Hit',
    labelZh: '誤報',
    desc: 'Full name / gender / DOB / Age not match',
    icon: XCircle,
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    text: 'text-amber-700',
    badge: 'bg-amber-100 text-amber-800 border-amber-200'
  },
  'IRRELEVANT_MLTF': {
    label: 'Irrelevant to ML/TF',
    labelZh: '無關 ML/TF',
    desc: 'No negative news related to ML/TF or sanctions',
    icon: Info,
    bg: 'bg-slate-50',
    border: 'border-slate-300',
    text: 'text-slate-600',
    badge: 'bg-slate-100 text-slate-700 border-slate-200'
  },
  'NO_HIT': {
    label: 'No Hit',
    labelZh: '無命中',
    desc: 'No search keywords found, or the search returned no result',
    icon: CheckCircle,
    bg: 'bg-green-50',
    border: 'border-green-300',
    text: 'text-green-700',
    badge: 'bg-green-100 text-green-800 border-green-200'
  }
};

/* ========== Mock 數據 ========== */

const MOCK_EN = [
  {
    rank: 1,
    title: 'ABC Holdings Ltd Director Under Investigation for Money Laundering Scheme',
    source: 'South China Morning Post',
    date: '2026-02-15',
    snippet: 'Hong Kong authorities have launched a formal investigation into ABC Holdings Ltd and its director John Chen for allegedly laundering approximately USD 50 million...',
    matchedKeywords: ['laundering', 'investigation'],
    cls: 'TRUE_HIT',
    confidence: 0.94,
    reason: 'Article directly names ABC Holdings Ltd. Money laundering is a core ML/TF concern.',
    riskCat: 'Money Laundering'
  },
  {
    rank: 2,
    title: 'ABC Holdings Ltd Faces Fraud Allegations Linked to Sanctions Evasion',
    source: 'Reuters',
    date: '2026-01-20',
    snippet: 'ABC Holdings Ltd is facing multiple fraud allegations after investigators discovered the company may have facilitated transactions with sanctioned entities...',
    matchedKeywords: ['fraud', 'allegation', 'sanctions'],
    cls: 'TRUE_HIT',
    confidence: 0.92,
    reason: 'Exact entity name match. Fraud + sanctions evasion are directly related to ML/TF.',
    riskCat: 'Sanctions Evasion / Fraud'
  },
  {
    rank: 3,
    title: 'HKMA Names ABC Holdings Ltd in Terrorist Financing Probe',
    source: 'Financial Times',
    date: '2025-11-30',
    snippet: 'The Hong Kong Monetary Authority has named ABC Holdings Ltd among several companies being investigated for potential terrorist financing activities...',
    matchedKeywords: ['terrorist', 'investigation'],
    cls: 'TRUE_HIT',
    confidence: 0.96,
    reason: 'Named by HKMA in terrorist financing investigation—highest severity ML/TF category.',
    riskCat: 'Terrorist Financing'
  },
  {
    rank: 4,
    title: 'ABC Holdings Pty Ltd (Melbourne) Recognised for Innovation Excellence',
    source: 'The Australian',
    date: '2026-01-10',
    snippet: 'ABC Holdings Pty Ltd, an Australian technology startup, has been awarded the 2025 Innovation Excellence Award...',
    matchedKeywords: [],
    cls: 'FALSE_HIT',
    confidence: 0.91,
    reason: 'Different entity: Australian tech startup. Different jurisdiction, industry, no adverse information.',
    riskCat: 'N/A'
  },
  {
    rank: 5,
    title: 'ABC Holdings Ltd Sued by Former Partner for Breach of Commercial Contract',
    source: 'HK Economic Journal',
    date: '2026-02-01',
    snippet: 'ABC Holdings Ltd is facing a civil lawsuit over alleged breach of a commercial supply contract worth HKD 120 million...',
    matchedKeywords: ['lawsuit'],
    cls: 'IRRELEVANT_MLTF',
    confidence: 0.88,
    reason: 'Entity matches but this is a commercial contract dispute—not related to ML/TF.',
    riskCat: 'N/A (Commercial Dispute)'
  },
  {
    rank: 6,
    title: 'Hong Kong Introduces New AML Framework for Financial Institutions in 2026',
    source: 'Bloomberg',
    date: '2026-03-01',
    snippet: 'The Hong Kong government has unveiled a comprehensive new anti-money laundering framework...',
    matchedKeywords: ['AML'],
    cls: 'NO_HIT',
    confidence: 0.93,
    reason: 'General regulatory news. No mention of ABC Holdings Ltd.',
    riskCat: 'N/A'
  }
];

const MOCK_ZH = [
  {
    rank: 1,
    title: 'ABC控股有限公司董事涉洗錢 廉署正式調查',
    source: '南華早報',
    date: '2026-02-10',
    snippet: '香港廉政公署已對 ABC控股有限公司及其董事陳志明展開正式調查，涉嫌透過多間空殼公司洗錢約 5000 萬美元...',
    matchedKeywords: ['洗錢', '調查'],
    cls: 'TRUE_HIT',
    confidence: 0.96,
    reason: '文章直接點名 ABC控股有限公司為廉署調查對象，涉及洗錢。',
    riskCat: '洗錢'
  },
  {
    rank: 2,
    title: 'ABC控股有限公司董事涉賄賂案 遭檢控',
    source: '明報',
    date: '2026-01-25',
    snippet: '律政司已正式檢控 ABC控股有限公司董事陳志明，指其涉嫌向內地官員行賄以取得工程合約...',
    matchedKeywords: ['賄賂', '檢舉'],
    cls: 'TRUE_HIT',
    confidence: 0.93,
    reason: '實體名稱完全吻合，董事遭檢控賄賂案。賄賂是 ML/TF 的上游犯罪。',
    riskCat: '賄賂'
  },
  {
    rank: 3,
    title: 'ABC控股有限公司遭前合作夥伴起訴違約',
    source: '香港經濟日報',
    date: '2026-01-30',
    snippet: 'ABC控股有限公司遭前合作夥伴入稟法院，指控其違反價值 1.2 億港元的商業合約...',
    matchedKeywords: ['訴訟'],
    cls: 'IRRELEVANT_MLTF',
    confidence: 0.86,
    reason: '實體名稱吻合但這是民事商業合約糾紛，與 ML/TF 無關。',
    riskCat: 'N/A（商業糾紛）'
  },
  {
    rank: 4,
    title: '香港金管局公佈 2026 年反洗錢新指引',
    source: '信報財經新聞',
    date: '2026-03-10',
    snippet: '香港金融管理局今日公佈 2026 年反洗錢及恐怖融資新指引...',
    matchedKeywords: ['反洗錢'],
    cls: 'NO_HIT',
    confidence: 0.92,
    reason: '一般監管新聞。全文未提及 ABC控股有限公司。',
    riskCat: 'N/A'
  }
];

/* ========== 主組件 ========== */

export default function AdverseMediaScreening() {
  const [activeTab, setActiveTab] = useState('demo');
  const [searchEntity, setSearchEntity] = useState('ABC Holdings Ltd');
  const [isSearching, setIsSearching] = useState(false);
  const [searchComplete, setSearchComplete] = useState(false);
  const [results, setResults] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [filterType, setFilterType] = useState('ALL');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [showQuery, setShowQuery] = useState(false);
  const [detectedLang, setDetectedLang] = useState('en');

  // 執行搜尋
  const runSearch = () => {
    setIsSearching(true);
    setSearchComplete(false);
    setResults([]);
    setProgress(0);
    setFilterType('ALL');
    setExpandedId(null);

    const { detectedLang: lang } = buildQueryAuto(searchEntity);
    setDetectedLang(lang);

    const stages = [
      { p: 15, s: '準備搜尋參數...', d: 500 },
      { p: 40, s: `執行 Google 搜尋 (${lang === 'zh' ? '中文' : '英文'}關鍵字)...`, d: 1500 },
      { p: 70, s: 'AI 分析結果 1-10...', d: 2000 },
      { p: 95, s: '生成報告...', d: 600 },
      { p: 100, s: '完成', d: 300 }
    ];

    let total = 0;
    stages.forEach(({ p, s, d }) => {
      total += d;
      setTimeout(() => {
        setProgress(p);
        setStage(s);
      }, total);
    });

    setTimeout(() => {
      setIsSearching(false);
      setSearchComplete(true);
      setResults(lang === 'zh' ? MOCK_ZH : MOCK_EN);
    }, total + 200);
  };

  const counts = useMemo(() => {
    const c = { TRUE_HIT: 0, FALSE_HIT: 0, IRRELEVANT_MLTF: 0, NO_HIT: 0 };
    results.forEach(r => c[r.cls]++);
    return c;
  }, [results]);

  const filteredResults = useMemo(() => {
    return filterType === 'ALL' ? results : results.filter(r => r.cls === filterType);
  }, [results, filterType]);

  const ResultCard = ({ r }) => {
    const c = CLS_CONFIG[r.cls];
    const Icon = c.icon;
    const isOpen = expandedId === r.rank;

    return (
      <div className={`border-2 ${c.border} rounded-xl overflow-hidden bg-white`}>
        <div
          className="p-3 cursor-pointer hover:bg-gray-50 flex items-start gap-3"
          onClick={() => setExpandedId(isOpen ? null : r.rank)}
        >
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs font-bold text-gray-400 w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
              {r.rank}
            </span>
            <Icon className={`w-4 h-4 ${c.text}`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${c.badge}`}>
                {detectedLang === 'zh' ? c.labelZh : c.label}
              </span>
              <span className="text-xs text-gray-400">{Math.round(r.confidence * 100)}% confidence</span>
              <span className="text-xs text-gray-400">|</span>
              <span className="text-xs text-gray-500">{r.source}</span>
              <span className="text-xs text-gray-400">{r.date}</span>
            </div>

            <h3 className="text-sm font-bold text-gray-800 leading-snug">{r.title}</h3>
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{r.snippet}</p>

            {r.matchedKeywords.length > 0 && (
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {r.matchedKeywords.map((kw, i) => (
                  <span key={i} className="bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded text-xs">
                    {kw}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="text-gray-300 pt-1">
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
        </div>

        {isOpen && (
          <div className="px-3 pb-3">
            <div className={`${c.bg} rounded-lg p-3`}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Brain className={`w-3.5 h-3.5 ${c.text}`} />
                <span className={`text-xs font-bold ${c.text}`}>AI 分析</span>
              </div>
              <p className="text-xs text-gray-700">{r.reason}</p>
              <div className="flex gap-3 mt-2 text-xs text-gray-500">
                <span>Risk: <b className={c.text}>{r.riskCat}</b></span>
                <span>Confidence: <b>{Math.round(r.confidence * 100)}%</b></span>
              </div>
            </div>

            <div className="flex gap-2 mt-2">
              <button className="bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-lg text-xs font-bold hover:bg-blue-100 flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />
                查看原文
              </button>
              {r.cls === 'TRUE_HIT' && (
                <button className="bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded-lg text-xs font-bold hover:bg-red-100">
                  🚨 標記 STR
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-slate-800 text-white px-4 py-3">
        <h1 className="text-base font-bold flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Adverse Media Screening
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          🔍 自動語言檢測 | Google Search | AI 分類
        </p>
      </div>

      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex overflow-x-auto">
          {[
            { id: 'demo', label: '🎬 Demo 演示' },
            { id: 'arch', label: '🏗️ 架構說明' },
            { id: 'keywords', label: '🔑 關鍵字配置' }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${
                activeTab === t.id
                  ? 'border-blue-500 text-blue-700 bg-blue-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4">
        {activeTab === 'demo' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <Search className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-bold text-gray-800">搜尋配置</h2>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">實體名稱</label>
                  <input
                    type="text"
                    value={searchEntity}
                    onChange={e => setSearchEntity(e.target.value)}
                    className="w-full border-2 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder="輸入英文或中文名稱..."
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">自動檢測語言</label>
                  <div className="h-[42px] px-4 rounded-lg border-2 bg-gray-50 flex items-center gap-2">
                    <Globe className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-bold">
                      {searchEntity ? (
                        detectLanguage(searchEntity) === 'zh' ? (
                          <span className="text-red-600">🇨🇳 中文</span>
                        ) : (
                          <span className="text-blue-600">🇬🇧 英文</span>
                        )
                      ) : '請輸入名稱'}
                    </span>
                  </div>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={runSearch}
                    disabled={isSearching || !searchEntity}
                    className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap h-[42px]"
                  >
                    {isSearching ? (
                      <>
                        <Loader className="w-4 h-4 animate-spin" />
                        搜尋中...
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4" />
                        執行搜尋
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <button
                  onClick={() => setShowQuery(!showQuery)}
                  className="text-xs text-blue-600 font-bold flex items-center gap-1 hover:underline"
                >
                  {showQuery ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  預覽 Google 查詢字串
                </button>
                {showQuery && searchEntity && (
                  <div className="mt-2 bg-gray-900 rounded-lg p-3 overflow-x-auto">
                    <div className="text-xs text-gray-400 mb-1">
                      Google Search Query ({detectLanguage(searchEntity) === 'zh' ? '中文' : '英文'}關鍵字)
                    </div>
                    <code className="text-xs text-green-400">
                      {buildQueryAuto(searchEntity).query}
                    </code>
                  </div>
                )}
              </div>
            </div>

            {isSearching && (
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-blue-700 font-medium">{stage}</span>
                  <span className="text-blue-500">{progress}%</span>
                </div>
                <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {searchComplete && (
              <>
                <div className="grid grid-cols-5 gap-2">
                  <div className="bg-white rounded-lg border p-3 text-center">
                    <div className="text-xl font-bold text-gray-800">{results.length}</div>
                    <div className="text-xs text-gray-500">Total</div>
                  </div>

                  {Object.entries(CLS_CONFIG).map(([key, c]) => {
                    const Icon = c.icon;
                    return (
                      <div key={key} className={`${c.bg} rounded-lg border ${c.border} p-3 text-center`}>
                        <div className={`text-xl font-bold ${c.text}`}>{counts[key]}</div>
                        <div className={`text-xs ${c.text} flex items-center justify-center gap-1`}>
                          <Icon className="w-3 h-3" />
                          {detectedLang === 'zh' ? c.labelZh : c.label}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div
                  className={`${
                    counts.TRUE_HIT > 0 ? 'bg-red-600' : 'bg-green-600'
                  } rounded-lg p-3 text-white flex items-center justify-between`}
                >
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    <span className="font-bold text-sm">Overall Risk Assessment</span>
                    <span className="text-lg font-black">{counts.TRUE_HIT > 0 ? 'HIGH RISK' : 'LOW RISK'}</span>
                  </div>
                  <span className="text-xs opacity-80">
                    {counts.TRUE_HIT > 0
                      ? `${counts.TRUE_HIT} confirmed hits related to ML/TF/Sanctions`
                      : 'No ML/TF/Sanctions-related hits found'}
                  </span>
                </div>

                <div className="flex gap-1.5 flex-wrap">
                  {[
                    { k: 'ALL', l: `全部 (${results.length})` },
                    ...Object.entries(CLS_CONFIG).map(([k, c]) => ({
                      k,
                      l: `${detectedLang === 'zh' ? c.labelZh : c.label} (${counts[k]})`
                    }))
                  ].map(f => (
                    <button
                      key={f.k}
                      onClick={() => setFilterType(f.k)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                        filterType === f.k
                          ? 'bg-slate-700 text-white border-slate-700'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      {f.l}
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  {filteredResults.length === 0 ? (
                    <div className="text-center py-8 text-sm text-gray-400">無結果</div>
                  ) : (
                    filteredResults.map(r => <ResultCard key={r.rank} r={r} />)
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'arch' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border shadow-sm p-5">
              <h2 className="text-sm font-bold text-gray-800 mb-4">🔄 搜尋流程</h2>
              {[
                { n: 1, icon: '📝', t: '輸入實體名稱', d: '用戶輸入實體名稱（英文或中文）' },
                { n: 2, icon: '🤖', t: '自動檢測語言', d: '系統自動判斷名稱主要語言' },
                { n: 3, icon: '🔑', t: '選擇關鍵字', d: '根據檢測結果使用對應語言關鍵字' },
                { n: 4, icon: '🔍', t: 'Google Search API', d: '執行單一語言搜尋' },
                { n: 5, icon: '🧠', t: 'AI 分類（4 類）', d: 'Claude API 自動分類' },
                { n: 6, icon: '💾', t: '儲存結果', d: '結果保存至資料庫' },
                { n: 7, icon: '📊', t: '生成報告', d: '顯示分類結果和風險評估' }
              ].map(s => (
                <div key={s.n} className="flex items-start gap-3 pb-3 mb-3 border-b last:border-0">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700">
                    {s.n}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span>{s.icon}</span>
                      <span className="font-bold text-gray-800 text-sm">{s.t}</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5">{s.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'keywords' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border shadow-sm p-5">
              <h2 className="text-sm font-bold text-gray-800 mb-4">🔑 搜尋關鍵字</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-bold text-blue-700 mb-2">
                    🇬🇧 English Keywords ({EN_KEYWORDS.length})
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {EN_KEYWORDS.map((kw, i) => (
                      <span key={i} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 rounded-lg text-xs">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-red-700 mb-2">
                    🇨🇳 中文關鍵字 ({ZH_KEYWORDS.length})
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {ZH_KEYWORDS.map((kw, i) => (
                      <span key={i} className="bg-red-50 text-red-700 border border-red-200 px-2 py-1 rounded-lg text-xs">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
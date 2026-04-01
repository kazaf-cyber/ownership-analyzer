/* ========== ADVERSE MEDIA SCREENING MODULE (v2 - Entity Tab Edition) ========== */

function detectLanguage(text) {
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g);
  const chineseCount = chineseChars ? chineseChars.length : 0;
  const totalChars = text.replace(/[\s]/g, '').length;
  const chineseRatio = totalChars > 0 ? chineseCount / totalChars : 0;
  return chineseRatio > 0.3 ? 'zh' : 'en';
}

const AMS_EN_KEYWORDS = [
  'market abuse', 'regulatory breach', 'tax evasion', 'allegation', 'bribery',
  'corruption', 'criminal', 'fraud', 'illegal', 'indict', 'investigation',
  'laundering', 'lawsuit', 'penalty', 'prosecution', 'sanctions', 'terrorist',
  'trafficking', 'ML', 'AML'
];

const AMS_ZH_KEYWORDS = [
  '市場濫用', '監管違規', '逃稅', '指控', '賄賂',
  '腐敗', '刑事', '欺詐', '非法', '起訴', '調查',
  '洗錢', '訴訟', '處罰', '檢舉', '制裁', '恐怖分子',
  '販運', '洗錢', '反洗錢'
];

function buildAMSQueryAuto(entityName) {
  const detectedLang = detectLanguage(entityName);
  const keywords = detectedLang === 'zh' ? AMS_ZH_KEYWORDS : AMS_EN_KEYWORDS;
  const keywordString = keywords.map(k => `"${k}"`).join(' OR ');
  const query = `"${entityName}" (${keywordString})`;
  return { query, detectedLang, keywords };
}

const AMS_CLS_CONFIG = {
  'TRUE_HIT': {
    label: 'True Hit', labelZh: '真實命中',
    desc: 'Confirmed subject with ML/TF or sanctions related negative news',
    bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700',
    badge: 'bg-red-100 text-red-800 border-red-200', iconName: 'AlertTriangle'
  },
  'FALSE_HIT': {
    label: 'False Hit', labelZh: '誤報',
    desc: 'Name / gender / DOB / Age not match',
    bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700',
    badge: 'bg-amber-100 text-amber-800 border-amber-200', iconName: 'XCircle'
  },
  'IRRELEVANT_MLTF': {
    label: 'Irrelevant to ML/TF', labelZh: '無關 ML/TF',
    desc: 'No negative news related to ML/TF or sanctions',
    bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-600',
    badge: 'bg-slate-100 text-slate-700 border-slate-200', iconName: 'Info'
  },
  'NO_HIT': {
    label: 'No Hit', labelZh: '無命中',
    desc: 'No search keywords found or no result',
    bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700',
    badge: 'bg-green-100 text-green-800 border-green-200', iconName: 'CheckCircle'
  }
};

const AMS_MOCK_EN = [
  {
    rank: 1, source: 'South China Morning Post', date: '2026-02-15',
    title: 'Director Under Investigation for Money Laundering Scheme',
    snippet: 'Hong Kong authorities have launched a formal investigation for allegedly laundering approximately USD 50 million through shell companies...',
    matchedKeywords: ['laundering', 'investigation'], cls: 'TRUE_HIT', confidence: 0.94,
    reason: 'Article directly names the entity. Money laundering is a core ML/TF concern.', riskCat: 'Money Laundering'
  },
  {
    rank: 2, source: 'Reuters', date: '2026-01-20',
    title: 'Entity Faces Fraud Allegations Linked to Sanctions Evasion',
    snippet: 'The company is facing multiple fraud allegations after investigators discovered it may have facilitated transactions with sanctioned entities...',
    matchedKeywords: ['fraud', 'allegation', 'sanctions'], cls: 'TRUE_HIT', confidence: 0.92,
    reason: 'Exact entity name match. Fraud + sanctions evasion are directly related to ML/TF.', riskCat: 'Sanctions Evasion / Fraud'
  },
  {
    rank: 3, source: 'Financial Times', date: '2025-11-30',
    title: 'Entity Named in Terrorist Financing Probe',
    snippet: 'The entity has been named among several companies being investigated for potential terrorist financing activities...',
    matchedKeywords: ['terrorist', 'investigation'], cls: 'TRUE_HIT', confidence: 0.96,
    reason: 'Named in terrorist financing investigation—highest severity ML/TF category.', riskCat: 'Terrorist Financing'
  },
  {
    rank: 4, source: 'The Australian', date: '2026-01-10',
    title: 'Similar-Name Entity Recognised for Innovation',
    snippet: 'An Australian technology startup with a similar name has been awarded the 2025 Innovation Excellence Award...',
    matchedKeywords: [], cls: 'FALSE_HIT', confidence: 0.91,
    reason: 'Different entity: Australian tech startup. Different jurisdiction, industry, no adverse info.', riskCat: 'N/A'
  },
  {
    rank: 5, source: 'HK Economic Journal', date: '2026-02-01',
    title: 'Entity Sued for Breach of Commercial Contract',
    snippet: 'The company is facing a civil lawsuit over alleged breach of a commercial supply contract worth HKD 120 million...',
    matchedKeywords: ['lawsuit'], cls: 'IRRELEVANT_MLTF', confidence: 0.88,
    reason: 'Commercial contract dispute—not related to ML/TF.', riskCat: 'N/A (Commercial Dispute)'
  },
  {
    rank: 6, source: 'Bloomberg', date: '2026-03-01',
    title: 'Hong Kong Introduces New AML Framework in 2026',
    snippet: 'The Hong Kong government has unveiled a comprehensive new anti-money laundering framework...',
    matchedKeywords: ['AML'], cls: 'NO_HIT', confidence: 0.93,
    reason: 'General regulatory news. No direct mention of this entity.', riskCat: 'N/A'
  }
];

const AMS_MOCK_ZH = [
  {
    rank: 1, source: '南較早報', date: '2026-02-10',
    title: '公司涉嫌洗錢 廉署正式調查',
    snippet: '香港廉政公署對該公司及其董事展開正式調查，涉嫌透過多間空殼公司洗錢...',
    matchedKeywords: ['洗錢', '調查'], cls: 'TRUE_HIT', confidence: 0.96,
    reason: '文章直接點名該公司為廉署調查對象，涉及洗錢。', riskCat: '洗錢'
  },
  {
    rank: 2, source: '明報', date: '2026-01-25',
    title: '公司董事涉賄賂案 遭檢控',
    snippet: '律政司已正式檢控公司董事，指其涉嫌向內地官員行賄以取得工程合約...',
    matchedKeywords: ['賄賂', '檢舉'], cls: 'TRUE_HIT', confidence: 0.93,
    reason: '實體名稱完全吻合，董事遭檢控賄賂案。', riskCat: '賄賂'
  },
  {
    rank: 3, source: '香港經濟日報', date: '2026-01-30',
    title: '公司遭前合作夥伴起訴違約',
    snippet: '公司遭前合作夥伴入稟法院，指控其違反價值 1.2 億港元的商業合約...',
    matchedKeywords: ['訴訟'], cls: 'IRRELEVANT_MLTF', confidence: 0.86,
    reason: '實體名稱吻合但這是民事商業合約糾紛，與 ML/TF 無關。', riskCat: 'N/A'
  },
  {
    rank: 4, source: '信報財經新聞', date: '2026-03-10',
    title: '香港金管局公佈新反洗錢指引',
    snippet: '香港金融管理局今日公佈 2026 年反洗錢及恐怖融資新指引...',
    matchedKeywords: ['反洗錢'], cls: 'NO_HIT', confidence: 0.92,
    reason: '一般監管新聞。全文未提及該實體。', riskCat: 'N/A'
  }
];

function AdverseMediaScreening({ entityName = '' }) {
  const [searchEntity, setSearchEntity] = React.useState(entityName || '');
  const [isSearching, setIsSearching] = React.useState(false);
  const [searchComplete, setSearchComplete] = React.useState(false);
  const [results, setResults] = React.useState([]);
  const [expandedId, setExpandedId] = React.useState(null);
  const [filterType, setFilterType] = React.useState('ALL');
  const [progress, setProgress] = React.useState(0);
  const [stage, setStage] = React.useState('');
  const [showQuery, setShowQuery] = React.useState(false);

  React.useEffect(() => {
    if (entityName) {
      setSearchEntity(entityName);
      setResults([]);
      setSearchComplete(false);
      setExpandedId(null);
      setFilterType('ALL');
      setShowQuery(false);
    }
  }, [entityName]);

  const runSearch = React.useCallback(() => {
    if (!searchEntity.trim()) return;
    setIsSearching(true);
    setSearchComplete(false);
    setResults([]);
    setProgress(0);
    setFilterType('ALL');
    setExpandedId(null);
    const { detectedLang } = buildAMSQueryAuto(searchEntity);

    const stages = [
      { p: 15, s: '準備搜尋參數...', d: 500 },
      { p: 40, s: `執行 Google 搜尋 (${detectedLang === 'zh' ? '中文' : '英文'}關鍵字)...`, d: 1500 },
      { p: 70, s: 'AI 分析結果 1-10...', d: 2000 },
      { p: 95, s: '生成報告...', d: 600 },
      { p: 100, s: '完成', d: 300 }
    ];
    let total = 0;
    stages.forEach(({ p, s, d }) => {
      total += d;
      setTimeout(() => { setProgress(p); setStage(s); }, total);
    });
    setTimeout(() => {
      setIsSearching(false);
      setSearchComplete(true);
      setResults(detectedLang === 'zh' ? AMS_MOCK_ZH : AMS_MOCK_EN);
    }, total + 200);
  }, [searchEntity]);

  const counts = React.useMemo(() => {
    const c = { TRUE_HIT: 0, FALSE_HIT: 0, IRRELEVANT_MLTF: 0, NO_HIT: 0 };
    results.forEach(r => { if (c[r.cls] !== undefined) c[r.cls]++; });
    return c;
  }, [results]);

  const filteredResults = React.useMemo(() =>
    filterType === 'ALL' ? results : results.filter(r => r.cls === filterType),
    [results, filterType]
  );

  const ICON_MAP = { AlertTriangle, CheckCircle, XCircle, Info };

  const { query } = buildAMSQueryAuto(searchEntity);

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Search size={15} className="text-blue-600 shrink-0" />
          <span className="text-sm font-bold text-gray-700">不良媒體篩查 Adverse Media Screening</span>
          <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">
            <Brain size={12} className="text-purple-500" /> AI驅動
          </span>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm pr-8 focus:ring-1 focus:ring-blue-400 focus:outline-none"
              value={searchEntity}
              onChange={e => setSearchEntity(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !isSearching && runSearch()}
              placeholder="輸入實體名稱..."
            />
            <Globe size={12} className="absolute right-2.5 top-2.5 text-gray-400" />
          </div>
          <button
            onClick={runSearch}
            disabled={isSearching || !searchEntity.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {isSearching
              ? <Loader size={12} className="animate-spin" />
              : <Search size={12} />
            }
            {isSearching ? '搜尋中...' : '開始篩查'}
          </button>
        </div>
        <div className="mt-2">
          <button
            className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
            onClick={() => setShowQuery(!showQuery)}
          >
            <ChevronRight size={12} className={`transition-transform ${showQuery ? 'rotate-90' : ''}`} />
            查看自動構建的搜尋指令
          </button>
          {showQuery && (
            <div className="mt-2 bg-gray-900 rounded-lg p-3">
              <code className="text-xs text-green-400 break-all">{query}</code>
            </div>
          )}
        </div>
      </div>

      {/* Progress */}
      {isSearching && (
        <div className="bg-white rounded-xl border border-blue-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Loader size={14} className="text-blue-500 animate-spin" />
            <span className="text-xs text-blue-600 font-medium">{stage}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-right text-xs text-gray-400 mt-1">{progress}%</div>
        </div>
      )}

      {/* Results */}
      {searchComplete && (
        <>
          {/* Count Cards */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(counts).map(([cls, cnt]) => {
              const c = AMS_CLS_CONFIG[cls];
              const Icon = ICON_MAP[c.iconName];
              return (
                <button
                  key={cls}
                  onClick={() => setFilterType(filterType === cls ? 'ALL' : cls)}
                  className={`rounded-xl border p-2.5 text-left transition-all ${
                    filterType === cls
                      ? `${c.bg} ${c.border} shadow-sm`
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon size={13} className={c.text} />
                    <span className={`text-xs font-bold ${filterType === cls ? c.text : 'text-gray-600'}`}>{cnt}</span>
                  </div>
                  <div className="text-xs text-gray-500 leading-tight">{c.labelZh}</div>
                  <div className="text-xs text-gray-400">{c.label}</div>
                </button>
              );
            })}
          </div>

          {/* True Hit Alert */}
          {counts.TRUE_HIT > 0 && (
            <div className="bg-red-50 border border-red-300 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-red-700 mb-0.5">
                  發現 {counts.TRUE_HIT} 條 True Hit 需要旁注
                </div>
                <div className="text-xs text-red-600">
                  發現 ML/TF 相關不良媒體記錄，請常屬審查並更新風險評級。
                </div>
              </div>
            </div>
          )}

          {/* Filter indicator */}
          {filterType !== 'ALL' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">篩選：{AMS_CLS_CONFIG[filterType].labelZh}</span>
              <button onClick={() => setFilterType('ALL')} className="text-xs text-blue-500 hover:text-blue-700">清除</button>
            </div>
          )}

          {/* Result Cards */}
          <div>
            {filteredResults.map(r => {
              const c = AMS_CLS_CONFIG[r.cls];
              const Icon = ICON_MAP[c.iconName];
              const isOpen = expandedId === r.rank;
              return (
                <div key={r.rank} className={`rounded-xl border ${c.border} ${c.bg} overflow-hidden mb-3`}>
                  <div
                    className="p-3 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => setExpandedId(isOpen ? null : r.rank)}
                  >
                    <div className="flex items-start gap-2">
                      <Icon size={16} className={`${c.text} mt-0.5 shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${c.badge}`}>
                            {c.label} · {c.labelZh}
                          </span>
                          <span className="text-xs text-gray-400">{r.source} · {r.date}</span>
                          <span className="text-xs text-gray-500 ml-auto">
                            {Math.round(r.confidence * 100)}% conf.
                          </span>
                        </div>
                        <p className="text-xs font-medium text-gray-800 leading-snug">{r.title}</p>
                        {r.matchedKeywords.length > 0 && (
                          <div className="flex gap-1 flex-wrap mt-1">
                            {r.matchedKeywords.map(kw => (
                              <span key={kw} className="text-xs bg-red-50 text-red-700 border border-red-200 px-1.5 py-0.5 rounded">
                                {kw}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <ChevronDown
                        size={14}
                        className={`text-gray-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </div>
                  </div>
                  {isOpen && (
                    <div className="border-t border-gray-200 p-3 bg-white space-y-2">
                      <p className="text-xs text-gray-600 italic">"{r.snippet}"</p>
                      <div className="text-xs bg-gray-50 rounded p-2 border">
                        <span className="font-semibold text-gray-600">AI 分析：</span>
                        <span className="text-gray-700"> {r.reason}</span>
                      </div>
                      {r.riskCat && !r.riskCat.startsWith('N/A') && (
                        <div className="text-xs bg-red-50 border border-red-200 rounded p-2">
                          <span className="font-semibold text-red-700">風險類別：</span>
                          <span className="text-red-600"> {r.riskCat}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="text-center text-xs text-gray-400 py-2 border-t">
            <Shield size={11} className="inline mr-1" />
            自動語言檢測 | Google Search | AI 分類 | 僅供參考
          </div>
        </>
      )}

      {/* Empty state */}
      {!isSearching && !searchComplete && (
        <div className="text-center py-10 text-gray-400">
          <Search size={32} className="mx-auto mb-3 opacity-30" />
          <div className="text-sm">點擊「開始篩查」進行不良媒體篩查</div>
          <div className="text-xs mt-1">會自動根據實體名稱檢測語言並構建查詢</div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ */

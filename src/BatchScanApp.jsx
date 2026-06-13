import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Camera, Loader, X, Edit2, Check, ExternalLink,
  Trash2, Plus, Search, Image as ImageIcon, Eraser, Shield, Globe
} from 'lucide-react';

/* ════════════════════════════════════════════════════════════════
   ★ ADVERSE MEDIA KEYWORDS (3 languages — same as ScreeningModuleV2)
   ════════════════════════════════════════════════════════════════ */
const EN_KEYWORDS = [
  'market abuse', 'regulatory breach', 'tax evasion', 'allegation', 'bribery',
  'corruption', 'criminal', 'fraud', 'illegal', 'indict', 'investigation',
  'laundering', 'lawsuit', 'penalty', 'prosecution', 'sanctions',
  'terrorist', 'trafficking', 'ML', 'AML'
];
const ZH_KEYWORDS_TW = [
  '市場濫用', '監管違規', '逃稅', '指控', '賄賂', '腐敗', '刑事',
  '欺詐', '非法', '起訴', '調查', '洗錢', '訴訟', '處罰', '檢舉',
  '制裁', '恐怖分子', '販運', '洗錢', '反洗錢'
];
const ZH_KEYWORDS_CN = [
  '市场滥用', '监管违规', '逃税', '指控', '贿赂', '腐败', '刑事',
  '欺诈', '非法', '起诉', '调查', '洗钱', '诉讼', '处罚', '检举',
  '制裁', '恐怖分子', '贩运', '洗钱', '反洗钱'
];

/* ════════════════════════════════════════════════════════════════
   ★ SANCTION KEYWORDS — 3 Parts × 3 Languages (與 old app.jsx 完全一致)
   ════════════════════════════════════════════════════════════════ */
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

/* ════════════════════════════════════════════════════════════════
   LANGUAGE DETECTION (en / zh_tw / zh_cn)
   ════════════════════════════════════════════════════════════════ */
function detectLanguageDetail(text) {
  if (!text) return 'en';
  const chinese = text.match(/[\u4e00-\u9fa5]/g);
  const chineseCount = chinese ? chinese.length : 0;
  const totalChars = text.replace(/[\s\p{P}]/gu, '').length;
  if (totalChars === 0 || chineseCount / totalChars <= 0.3) return 'en';
  const simpOnly = '国会们说这对开时问过机经还总从关动应实际认让产业专严临义书买亿';
  let simpScore = 0;
  for (const ch of text) if (simpOnly.includes(ch)) simpScore++;
  return simpScore > 0 ? 'zh_cn' : 'zh_tw';
}

function getSanctionKeywordsByPart(lang) {
  const m = {
    en:    { part1: SANCTION_EN_PART1,    part2: SANCTION_EN_PART2,    part3: SANCTION_EN_PART3 },
    zh_tw: { part1: SANCTION_ZH_TW_PART1, part2: SANCTION_ZH_TW_PART2, part3: SANCTION_ZH_TW_PART3 },
    zh_cn: { part1: SANCTION_ZH_CN_PART1, part2: SANCTION_ZH_CN_PART2, part3: SANCTION_ZH_CN_PART3 },
  };
  return m[lang] || m.en;
}

/* ════════════════════════════════════════════════════════════════
   QUERY BUILDERS
   ════════════════════════════════════════════════════════════════ */
function buildAdverseQuery(entityName, extraKeyword) {
  const lang = detectLanguageDetail(entityName);
  const kws = lang === 'zh_cn' ? ZH_KEYWORDS_CN : lang === 'zh_tw' ? ZH_KEYWORDS_TW : EN_KEYWORDS;
  const kStr = kws.map(k => `"${k}"`).join(' OR ');
  const extra = (extraKeyword || '').trim();
  const base = `"${entityName}" ${kStr}`;
  return extra ? `${base} ${extra}` : base;
}

function buildSanctionPartQuery(entityName, part, extraKeyword) {
  const lang = detectLanguageDetail(entityName);
  const kws = getSanctionKeywordsByPart(lang)[part];
  const kStr = kws.map(k => `"${k}"`).join(' OR ');
  const extra = (extraKeyword || '').trim();
  const base = `"${entityName}" ${kStr}`;
  return extra ? `${base} ${extra}` : base;
}

/* ════════════════════════════════════════════════════════════════
   ORIGINAL HELPERS (unchanged)
   ════════════════════════════════════════════════════════════════ */
const gid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

async function preprocessImage(file, maxDim = 1600, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => {
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const r = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * r);
          height = Math.round(height * r);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const imgData = ctx.getImageData(0, 0, width, height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const v = gray < 128 ? Math.max(0, gray - 25) : Math.min(255, gray + 25);
          d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('圖片載入失敗'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('檔案讀取失敗'));
    reader.readAsDataURL(file);
  });
}

async function ocrWithTesseract(imagesB64, lang, onProgress) {
  if (!window.Tesseract) throw new Error('Tesseract.js 未載入,請喺 index.html 加 CDN script');
  const allLines = [];
  for (let i = 0; i < imagesB64.length; i++) {
    const { data } = await window.Tesseract.recognize(imagesB64[i], lang, {
      logger: m => {
        if (m.status && onProgress) {
          const pct = Math.round((m.progress || 0) * 100);
          onProgress(`[${i + 1}/${imagesB64.length}] ${m.status} ${pct}%`);
        }
      }
    });
    data.text.split('\n')
      .map(s => s.trim())
      .map(s => s.replace(/^[\-\*\•\·\▪\□\■\◆\►\>\d\.\)\(\s]+/, '').trim())
      .filter(s => s.length >= 2 && s.length <= 80)
      .forEach(s => allLines.push(s));
  }
  const seen = new Set();
  return allLines.filter(n => {
    const k = n.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════ */
export default function BatchScanApp({ lang = 'zh', darkMode = false }) {
  const T = lang === 'zh' ? {
    title: '拍照批量搜尋',
    sub: '離線 OCR + KYC 關鍵字',
    step1: '拍照 / 上傳圖片',
    step2: '識別文字',
    step3: 'KYC 搜尋模式',
    step4: '檢視 / 編輯名單',
    step5: '批量 Google 搜尋',
    cameraBtn: '📷 拍照',
    uploadBtn: '🖼️ 從相簿上傳',
    selectedImgs: '已選圖片',
    ocrLang: 'OCR 語言',
    extraKw: '額外關鍵字 (選填,加入每個搜尋)',
    extraPh: '例如:Hong Kong director',
    runOcr: '🔍 開始識別文字',
    ocring: 'OCR 進行中...',
    addManual: '+ 手動加入',
    selectAll: '全選',
    deselectAll: '全不選',
    clearAll: '清空名單',
    selected: '已選',
    totalResults: '個搜尋連結',
    copyAll: '📋 複製全部 URL',
    shareAll: '📤 系統分享',
    openAll: '🚀 全部開啟',
    emptyImg: '未上傳圖片',
    emptyName: '未有識別到名字,先上傳圖片再識別',
    tip: '💡 印刷字體 / Excel 截圖效果最好',
    modeAdverse: '🔎 不良媒體',
    modeAdverseDesc: 'fraud / bribery / 洗錢 ... (20 keywords)',
    modeSanction: '🛡️ 制裁名單',
    modeSanctionDesc: '分 3 Parts · 國家名',
    modeDesc: '揀邊組 KYC 關鍵字加入每個搜尋',
    sanctionPart: '選擇 Part',
    partAll: 'All 3 Parts',
    partAllDesc: '每個名生成 3 條 URL',
    queryPreview: '查詢字串預覽 (第一個名)',
    langDetect: '第一個名語言',
    eachName: '個名 ×',
    partLabel: 'Part',
    queries: '條查詢',
  } : {
    title: 'Batch Scan & Search',
    sub: 'Offline OCR + KYC keywords · No API Key',
    step1: 'Capture / Upload Images',
    step2: 'Extract Text',
    step3: 'KYC Search Mode',
    step4: 'Review / Edit Names',
    step5: 'Batch Google Search',
    cameraBtn: '📷 Take Photo',
    uploadBtn: '🖼️ Upload from Album',
    selectedImgs: 'Selected Images',
    ocrLang: 'OCR Language',
    extraKw: 'Extra keyword (optional)',
    extraPh: 'e.g. Hong Kong director',
    runOcr: '🔍 Run OCR',
    ocring: 'OCR running...',
    addManual: '+ Add Manually',
    selectAll: 'Select All',
    deselectAll: 'Deselect All',
    clearAll: 'Clear All',
    selected: 'selected',
    totalResults: 'search URLs',
    copyAll: '📋 Copy All URLs',
    shareAll: '📤 Share',
    openAll: '🚀 Open All',
    emptyImg: 'No image uploaded',
    emptyName: 'No names yet — upload images and run OCR',
    tip: '💡 Best with printed text',
    modeAdverse: '🔎 Adverse Media',
    modeAdverseDesc: 'fraud / bribery / laundering (20 keywords)',
    modeSanction: '🛡️ Sanction List',
    modeSanctionDesc: 'Split into 3 Parts · Country names',
    modeDesc: 'Pick which KYC keyword set to append',
    sanctionPart: 'Select Part',
    partAll: 'All 3 Parts',
    partAllDesc: '3 URLs per name',
    queryPreview: 'Query Preview (first name)',
    langDetect: 'First name lang',
    eachName: 'name ×',
    partLabel: 'Part',
    queries: 'queries',
  };

  const [images, setImages] = useState([]);
  const [names, setNames] = useState([]);
  const [ocrLang, setOcrLang] = useState('chi_tra+eng');
  const [extraKeyword, setExtraKeyword] = useState('');
  const [searchMode, setSearchMode] = useState('adverseMedia');
  const [sanctionPart, setSanctionPart] = useState('part1'); 
  const [isOcring, setIsOcring] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [toast, setToast] = useState('');
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2200); };

  /* ── Image upload ── */
  const handleFiles = async (fileList) => {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    setErrorMsg('');
    try {
      const newImgs = await Promise.all(files.map(async file => ({
        id: gid(), name: file.name, b64: await preprocessImage(file)
      })));
      setImages(prev => [...prev, ...newImgs]);
    } catch (err) { setErrorMsg(`圖片處理失敗: ${err.message}`); }
  };
  const removeImage = (id) => setImages(prev => prev.filter(i => i.id !== id));
  const clearImages = () => setImages([]);

  /* ── OCR ── */
  const runOcr = async () => {
    if (!images.length) { setErrorMsg('請先上傳或拍照'); return; }
    setIsOcring(true); setErrorMsg(''); setProgressMsg('正在初始化 Tesseract...');
    try {
      const extracted = await ocrWithTesseract(images.map(i => i.b64), ocrLang, msg => setProgressMsg(msg));
      const existing = new Set(names.map(n => n.name.toLowerCase()));
      const newOnes = extracted.filter(n => !existing.has(n.toLowerCase()))
        .map(n => ({ id: gid(), name: n, selected: true }));
      setNames(prev => [...prev, ...newOnes]);
      showToast(`✓ 識別到 ${extracted.length} 個 (新增 ${newOnes.length})`);
    } catch (err) {
      console.error(err); setErrorMsg(`OCR 失敗: ${err.message}`);
    } finally { setIsOcring(false); setProgressMsg(''); }
  };

  /* ── Name list actions ── */
  const toggleName = (id) => setNames(prev => prev.map(n => n.id === id ? { ...n, selected: !n.selected } : n));
  const toggleAll = () => {
    const all = names.every(n => n.selected);
    setNames(prev => prev.map(n => ({ ...n, selected: !all })));
  };
  const removeName = (id) => setNames(prev => prev.filter(n => n.id !== id));
  const startEdit = (n) => { setEditingId(n.id); setEditDraft(n.name); };
  const saveEdit = () => {
    if (editDraft.trim()) setNames(prev => prev.map(n => n.id === editingId ? { ...n, name: editDraft.trim() } : n));
    setEditingId(null); setEditDraft('');
  };
  const addManual = () => {
    const id = gid();
    setNames(prev => [...prev, { id, name: '', selected: true }]);
    setEditingId(id); setEditDraft('');
  };
  const clearAllNames = () => { if (window.confirm('確定清空所有名字?')) setNames([]); };

  /* ── Build single URL for given name (used in row Search icon) ── */
  const buildSingleQuery = (name) => {
  if (searchMode === 'adverseMedia') {
    return buildAdverseQuery(name, extraKeyword);
  }
  return buildSanctionPartQuery(name, sanctionPart, extraKeyword);
};

  const selectedNames = useMemo(() => names.filter(n => n.selected && n.name.trim()), [names]);

  /* ── Build full URL list based on mode ── */
  const urls = useMemo(() => {
    const out = [];
    selectedNames.forEach(n => {
      if (searchMode === 'adverseMedia') {
        const q = buildAdverseQuery(n.name, extraKeyword);
        out.push({
          name: n.name,
          label: n.name,
          query: q,
          url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
        });
      } else {
  // sanction mode — single part
  const q = buildSanctionPartQuery(n.name, sanctionPart, extraKeyword);
  const partNum = sanctionPart.replace('part', '');
  out.push({
    name: n.name,
    label: `${n.name} [Part ${partNum}]`,
    part: sanctionPart,
    query: q,
    url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  });
}
    });
    return out;
  }, [selectedNames, searchMode, sanctionPart, extraKeyword]);

  /* ── Batch actions ── */
  
  const tryOpenAll = () => {
    if (urls.length > 5 && !window.confirm(`將開啟 ${urls.length} 個分頁,手機可能封鎖,繼續?`)) return;
    let blocked = 0;
    urls.forEach((u, i) => {
      setTimeout(() => {
        const w = window.open(u.url, '_blank', 'noopener,noreferrer');
        if (!w) blocked++;
        if (i === urls.length - 1) {
          if (blocked > 0) showToast(`⚠️ ${blocked}/${urls.length} 被封鎖`);
          else showToast(`✓ 已開啟 ${urls.length} 個分頁`);
        }
      }, i * 150);
    });
  };

  /* ── Preview helpers ── */
  const previewName = selectedNames[0]?.name || (lang === 'zh' ? '範例名' : 'Sample Name');
  const previewLang = detectLanguageDetail(previewName);
  const langLabel = previewLang === 'zh_cn' ? '🇨🇳 簡體' : previewLang === 'zh_tw' ? '🇹🇼 繁體' : '🇬🇧 英文';

  // For sanction preview, build query for each part
  const previewQueries = useMemo(() => {
  if (searchMode === 'adverseMedia') {
    return [{ label: 'Adverse Media', q: buildAdverseQuery(previewName, extraKeyword) }];
  }
  return [{
    label: `Sanction Part ${sanctionPart.replace('part', '')}`,
    q: buildSanctionPartQuery(previewName, sanctionPart, extraKeyword),
  }];
}, [searchMode, sanctionPart, previewName, extraKeyword]);

  // Count for sanction parts
  const partCounts = useMemo(() => {
    const k = getSanctionKeywordsByPart(previewLang);
    return { part1: k.part1.length, part2: k.part2.length, part3: k.part3.length };
  }, [previewLang]);

  return (
    <div className={`min-h-full ${darkMode ? 'bg-slate-950' : 'bg-slate-50'}`}>
      {/* Header */}
      <div className="bg-gradient-to-br from-sky-600 via-blue-600 to-indigo-600 text-white px-5 py-5 relative overflow-hidden rounded-b-2xl">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/15 backdrop-blur shadow-lg flex items-center justify-center">
            <Camera className="w-5 h-5" strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">{T.title}</h1>
            <p className="text-[11px] mt-0.5 text-white/85">{T.sub}</p>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white px-4 py-2 rounded-xl shadow-xl text-sm font-semibold">
          {toast}
        </div>
      )}

      <div className="max-w-3xl mx-auto p-4 space-y-4">

        {/* ─── STEP 1: Upload ─── */}
        <div className={`rounded-2xl border shadow-sm p-5 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">1</div>
            <h2 className={`text-sm font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>{T.step1}</h2>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button onClick={() => cameraInputRef.current?.click()}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white text-sm font-bold shadow-md">{T.cameraBtn}</button>
            <button onClick={() => fileInputRef.current?.click()}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-bold ${darkMode ? 'border-slate-700 hover:bg-slate-800 text-slate-200' : 'border-slate-200 hover:bg-slate-50 text-slate-700'}`}>{T.uploadBtn}</button>
          </div>
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" multiple onChange={e => handleFiles(e.target.files)} className="hidden" />
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={e => handleFiles(e.target.files)} className="hidden" />
          {images.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-2 mt-3">
                <span className={`text-[11px] font-semibold ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>{T.selectedImgs} ({images.length})</span>
                <button onClick={clearImages} className="text-[11px] text-red-500 hover:text-red-700 font-semibold">✕ 全部移除</button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {images.map(img => (
                  <div key={img.id} className="relative group aspect-square rounded-lg overflow-hidden border border-slate-200">
                    <img src={img.b64} alt={img.name} className="w-full h-full object-cover" />
                    <button onClick={() => removeImage(img.id)} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500/90 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className={`text-center py-6 text-xs ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-40" />{T.emptyImg}
            </div>
          )}
        </div>

        {/* ─── STEP 2: OCR ─── */}
        <div className={`rounded-2xl border shadow-sm p-5 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">2</div>
            <h2 className={`text-sm font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>{T.step2}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={`text-[11px] font-semibold mb-1 block ${darkMode ? 'text-slate-400' : 'text-slate-600'}`}>{T.ocrLang}</label>
              <select value={ocrLang} onChange={e => setOcrLang(e.target.value)}
                className={`w-full text-xs rounded-lg border px-3 py-2 ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-200'}`}>
                <option value="chi_tra+eng">繁中 + English</option>
                <option value="chi_sim+eng">簡中 + English</option>
                <option value="eng">English only</option>
                <option value="chi_tra">繁中 only</option>
                <option value="chi_sim">簡中 only</option>
              </select>
            </div>
            <div>
              <label className={`text-[11px] font-semibold mb-1 block ${darkMode ? 'text-slate-400' : 'text-slate-600'}`}>{T.extraKw}</label>
              <input value={extraKeyword} onChange={e => setExtraKeyword(e.target.value)} placeholder={T.extraPh}
                className={`w-full text-xs rounded-lg border px-3 py-2 ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-200'}`} />
            </div>
          </div>
          {errorMsg && <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700">{errorMsg}</div>}
          <button onClick={runOcr} disabled={isOcring || !images.length}
            className="w-full py-3 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-md">
            {isOcring ? <><Loader className="w-4 h-4 animate-spin" />{T.ocring}</> : T.runOcr}
          </button>
          {isOcring && progressMsg && (
            <div className={`mt-3 text-[11px] font-mono px-3 py-2 rounded-lg ${darkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{progressMsg}</div>
          )}
          <div className={`mt-3 text-[11px] ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>{T.tip}</div>
        </div>

        {/* ★★★ STEP 3: KYC Search Mode (Mode + Part Selector) ★★★ */}
        <div className={`rounded-2xl border shadow-sm p-5 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">
              <Shield className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <h2 className={`text-sm font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>{T.step3}</h2>
              <p className={`text-[10px] mt-0.5 ${darkMode ? 'text-slate-500' : 'text-slate-500'}`}>{T.modeDesc}</p>
            </div>
          </div>

          {/* Mode selector */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button onClick={() => setSearchMode('adverseMedia')}
              className={`p-3 rounded-xl border-2 text-left transition ${
                searchMode === 'adverseMedia'
                  ? 'border-emerald-500 bg-emerald-50 shadow-md'
                  : darkMode ? 'border-slate-700 hover:border-slate-600 bg-slate-800/30' : 'border-slate-200 hover:border-emerald-300 bg-white'
              }`}>
              <div className={`text-sm font-bold mb-1 ${searchMode === 'adverseMedia' ? 'text-emerald-700' : darkMode ? 'text-slate-300' : 'text-slate-700'}`}>{T.modeAdverse}</div>
              <div className={`text-[10px] font-mono ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>{T.modeAdverseDesc}</div>
            </button>
            <button onClick={() => setSearchMode('sanction')}
              className={`p-3 rounded-xl border-2 text-left transition ${
                searchMode === 'sanction'
                  ? 'border-orange-500 bg-orange-50 shadow-md'
                  : darkMode ? 'border-slate-700 hover:border-slate-600 bg-slate-800/30' : 'border-slate-200 hover:border-orange-300 bg-white'
              }`}>
              <div className={`text-sm font-bold mb-1 ${searchMode === 'sanction' ? 'text-orange-700' : darkMode ? 'text-slate-300' : 'text-slate-700'}`}>{T.modeSanction}</div>
              <div className={`text-[10px] font-mono ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>{T.modeSanctionDesc}</div>
            </button>
          </div>

          {/* ★ Part Selector — only show when Sanction mode */}
          {searchMode === 'sanction' && (
            <div className="mb-3 p-3 rounded-xl bg-orange-50/50 border border-orange-200">
              <div className="text-[11px] font-bold text-orange-700 mb-2 flex items-center gap-1.5">
                <span>🛡️</span>{T.sanctionPart}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { v: 'part1', label: 'Part 1', count: partCounts.part1,
                    activeCls: 'border-red-500 bg-red-100 text-red-700 shadow' },
                  { v: 'part2', label: 'Part 2', count: partCounts.part2,
                    activeCls: 'border-orange-500 bg-orange-100 text-orange-700 shadow' },
                  { v: 'part3', label: 'Part 3', count: partCounts.part3,
                    activeCls: 'border-amber-500 bg-amber-100 text-amber-700 shadow' },
                ].map(p => {
                  const active = sanctionPart === p.v;
                  return (
                    <button key={p.v} onClick={() => setSanctionPart(p.v)}
                      className={`p-2 rounded-lg border-2 text-xs font-bold transition ${
                        active ? p.activeCls : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}>
                      <div>{p.label}</div>
                      <div className="text-[9px] font-mono opacity-70">({p.count} kw)</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Language detection */}
          {selectedNames.length > 0 && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-2 ${darkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-50 text-slate-600'}`}>
              <Globe className="w-3.5 h-3.5" />
              <span>{T.langDetect}: <b>{langLabel}</b></span>
            </div>
          )}

          {/* Query preview */}
          <details className="mt-2">
            <summary className={`text-[11px] cursor-pointer font-bold ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
              ▶ {T.queryPreview}
            </summary>
            <div className="mt-2 bg-gray-900 rounded-lg p-3 overflow-x-auto space-y-2">
              {previewQueries.map((pq, i) => (
                <div key={i}>
                  <div className="text-[10px] text-orange-400 mb-0.5 font-bold">{pq.label}</div>
                  <code className="text-[10px] text-green-400 break-all whitespace-pre-wrap block">{pq.q}</code>
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* ─── STEP 4: Name List ─── */}
        <div className={`rounded-2xl border shadow-sm p-5 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">4</div>
            <h2 className={`text-sm font-bold flex-1 ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>{T.step4}</h2>
            <span className={`text-[11px] font-bold px-2 py-1 rounded-md ${darkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
              {selectedNames.length}/{names.length} {T.selected}
            </span>
          </div>

          {names.length > 0 ? (
            <>
              <div className="flex gap-1.5 mb-3 flex-wrap">
                <button onClick={toggleAll} className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold">
                  {names.every(n => n.selected) ? T.deselectAll : T.selectAll}
                </button>
                <button onClick={addManual} className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-semibold">{T.addManual}</button>
                <button onClick={clearAllNames} className="text-[11px] px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-semibold ml-auto">
                  <Eraser className="w-3 h-3 inline" /> {T.clearAll}
                </button>
              </div>
              <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                {names.map(n => (
                  <div key={n.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition ${
                    n.selected
                      ? darkMode ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'
                      : darkMode ? 'bg-slate-800/50 border-slate-800' : 'bg-slate-50 border-slate-100'
                  }`}>
                    <input type="checkbox" checked={n.selected} onChange={() => toggleName(n.id)} className="rounded text-blue-600 focus:ring-blue-500" />
                    {editingId === n.id ? (
                      <>
                        <input value={editDraft} onChange={e => setEditDraft(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') { setEditingId(null); setEditDraft(''); } }}
                          autoFocus className="flex-1 text-xs border border-blue-400 rounded px-2 py-1 bg-white text-slate-800" />
                        <button onClick={saveEdit} className="text-emerald-600 hover:text-emerald-700"><Check className="w-4 h-4" /></button>
                      </>
                    ) : (
                      <>
                        <span className={`flex-1 text-xs font-medium truncate ${darkMode ? 'text-slate-200' : 'text-slate-800'}`}>
                          {n.name || <em className="text-slate-400">(空白)</em>}
                        </span>
                        <a href={`https://www.google.com/search?q=${encodeURIComponent(buildSingleQuery(n.name))}`}
                           target="_blank" rel="noopener noreferrer"
                           onClick={e => { if (!n.name.trim()) e.preventDefault(); }}
                           className="text-blue-500 hover:text-blue-700" title="單獨搜尋"><Search className="w-3.5 h-3.5" /></a>
                        <button onClick={() => startEdit(n)} className="text-slate-400 hover:text-slate-600"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => removeName(n.id)} className="text-red-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className={`text-center py-6 text-xs ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              {T.emptyName}
              <div className="mt-3">
                <button onClick={addManual} className="text-[11px] px-3 py-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-semibold">{T.addManual}</button>
              </div>
            </div>
          )}
        </div>

        {/* ─── STEP 5: Batch Search ─── */}
        {selectedNames.length > 0 && (
          <div className={`rounded-2xl border shadow-sm p-5 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">5</div>
              <h2 className={`text-sm font-bold flex-1 ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>{T.step5}</h2>
              <span className="text-[11px] font-bold text-orange-600">{urls.length} {T.totalResults}</span>
            </div>

            {/* Mode summary banner */}
            <div className={`mb-3 p-2.5 rounded-lg text-[11px] border ${
              searchMode === 'sanction'
                ? 'bg-orange-50 border-orange-200 text-orange-800'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}>
             {searchMode === 'sanction' ? (
                <>🛡️ <b>Sanction</b> · Part {sanctionPart.replace('part','')} ({selectedNames.length} URLs)</>
              ) : (
                <>🔎 <b>Adverse Media</b> · {selectedNames.length} URLs</>
              )}
            </div>

            <div>
              <button onClick={tryOpenAll} className="w-full py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white shadow">{T.openAll}</button>
            </div>

            <details className="mt-3">
              <summary className={`text-[11px] cursor-pointer font-semibold ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>預覽 URLs</summary>
              <pre className={`mt-2 text-[10px] font-mono p-2 rounded-lg overflow-auto max-h-60 ${darkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-50 text-slate-600'}`}>
                {urls.map(u => `${u.label}\n  ${u.url}`).join('\n\n')}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

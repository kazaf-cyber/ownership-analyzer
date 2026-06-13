import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Camera, Loader, X, Edit2, Check, ExternalLink, Copy, Share2,
  Trash2, Plus, Search, Image as ImageIcon, Eraser
} from 'lucide-react';

/* ════════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════════ */
const gid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/** 壓縮 + 簡單 preprocess(灰階 + 提高對比),提升 Tesseract 準確度 */
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

        // 灰階 + 對比強化(threshold 偏向白底黑字)
        const imgData = ctx.getImageData(0, 0, width, height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          // 簡單線性對比(中性灰拉開)
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

/** Tesseract OCR — 一張圖一張圖跑,有 progress callback */
async function ocrWithTesseract(imagesB64, lang, onProgress) {
  if (!window.Tesseract) {
    throw new Error('Tesseract.js 未載入,請喺 index.html 加 CDN script');
  }
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
      .map(s => s.replace(/^[\-\*\•\·\▪\□\■\◆\►\>\d\.\)\(\s]+/, '').trim()) // 砍 bullet / 序號
      .filter(s => s.length >= 2 && s.length <= 80)
      .forEach(s => allLines.push(s));
  }
  // 去重(保留出現順序)
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
    sub: '離線 OCR (Tesseract.js) · 完全冇 API Key',
    step1: '拍照 / 上傳圖片',
    step2: '識別文字',
    step3: '檢視 / 編輯名單',
    step4: '批量 Google 搜尋',
    cameraBtn: '📷 拍照',
    uploadBtn: '🖼️ 從相簿上傳',
    selectedImgs: '已選圖片',
    ocrLang: 'OCR 語言',
    extraKw: '額外關鍵字 (選填,加入每個搜尋)',
    extraPh: '例如:Hong Kong director',
    runOcr: '🔍 開始識別文字',
    ocring: 'OCR 進行中...',
    nameList: '識別到嘅名單',
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
    tip: '💡 印刷字體 / Excel 截圖效果最好;手寫字、低光、角度歪 → 識別差',
  } : {
    title: 'Batch Scan & Search',
    sub: 'Offline OCR (Tesseract.js) · No API Key needed',
    step1: 'Capture / Upload Images',
    step2: 'Extract Text',
    step3: 'Review / Edit Names',
    step4: 'Batch Google Search',
    cameraBtn: '📷 Take Photo',
    uploadBtn: '🖼️ Upload from Album',
    selectedImgs: 'Selected Images',
    ocrLang: 'OCR Language',
    extraKw: 'Extra keyword (optional, appended to each search)',
    extraPh: 'e.g. Hong Kong director',
    runOcr: '🔍 Run OCR',
    ocring: 'OCR running...',
    nameList: 'Extracted Names',
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
    tip: '💡 Best with printed text / Excel screenshots. Handwritten / low-light / skewed images may fail.',
  };

  const [images, setImages] = useState([]);
  const [names, setNames] = useState([]);
  const [ocrLang, setOcrLang] = useState('chi_tra+eng');
  const [extraKeyword, setExtraKeyword] = useState('');
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
        id: gid(),
        name: file.name,
        b64: await preprocessImage(file)
      })));
      setImages(prev => [...prev, ...newImgs]);
    } catch (err) {
      setErrorMsg(`圖片處理失敗: ${err.message}`);
    }
  };

  const removeImage = (id) => setImages(prev => prev.filter(i => i.id !== id));
  const clearImages = () => setImages([]);

  /* ── OCR ── */
  const runOcr = async () => {
    if (!images.length) { setErrorMsg('請先上傳或拍照'); return; }
    setIsOcring(true); setErrorMsg(''); setProgressMsg('正在初始化 Tesseract...');
    try {
      const extracted = await ocrWithTesseract(
        images.map(i => i.b64),
        ocrLang,
        msg => setProgressMsg(msg)
      );
      const existing = new Set(names.map(n => n.name.toLowerCase()));
      const newOnes = extracted
        .filter(n => !existing.has(n.toLowerCase()))
        .map(n => ({ id: gid(), name: n, selected: true }));
      setNames(prev => [...prev, ...newOnes]);
      showToast(`✓ 識別到 ${extracted.length} 個 (新增 ${newOnes.length})`);
    } catch (err) {
      console.error(err);
      setErrorMsg(`OCR 失敗: ${err.message}`);
    } finally {
      setIsOcring(false);
      setProgressMsg('');
    }
  };

  /* ── Name list actions ── */
  const toggleName = (id) =>
    setNames(prev => prev.map(n => n.id === id ? { ...n, selected: !n.selected } : n));
  const toggleAll = () => {
    const all = names.every(n => n.selected);
    setNames(prev => prev.map(n => ({ ...n, selected: !all })));
  };
  const removeName = (id) => setNames(prev => prev.filter(n => n.id !== id));
  const startEdit = (n) => { setEditingId(n.id); setEditDraft(n.name); };
  const saveEdit = () => {
    if (editDraft.trim()) {
      setNames(prev => prev.map(n => n.id === editingId ? { ...n, name: editDraft.trim() } : n));
    }
    setEditingId(null); setEditDraft('');
  };
  const addManual = () => {
    const id = gid();
    setNames(prev => [...prev, { id, name: '', selected: true }]);
    setEditingId(id); setEditDraft('');
  };
  const clearAllNames = () => {
    if (window.confirm('確定清空所有名字?')) setNames([]);
  };

  /* ── Build queries ── */
  const buildQuery = (name) => {
    const extra = extraKeyword.trim();
    return extra ? `"${name}" ${extra}` : `"${name}"`;
  };

  const selectedNames = useMemo(
    () => names.filter(n => n.selected && n.name.trim()),
    [names]
  );
  const urls = useMemo(() => selectedNames.map(n => ({
    name: n.name,
    url: `https://www.google.com/search?q=${encodeURIComponent(buildQuery(n.name))}`
  })), [selectedNames, extraKeyword]);

  /* ── Batch actions ── */
  const copyAllUrls = async () => {
    const text = urls.map(u => `${u.name}\n${u.url}`).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast(`✓ 已複製 ${urls.length} 個 URL`);
    } catch {
      showToast('⚠️ 複製失敗');
    }
  };

  const shareUrls = async () => {
    if (!navigator.share) return showToast('⚠️ 此瀏覽器不支援系統分享');
    const text = urls.map(u => `${u.name}: ${u.url}`).join('\n\n');
    try {
      await navigator.share({ title: `Google 搜尋連結 (${urls.length})`, text });
    } catch (e) {
      if (e.name !== 'AbortError') showToast(`分享失敗: ${e.message}`);
    }
  };

  const tryOpenAll = () => {
    if (urls.length > 5 && !window.confirm(
      `將開啟 ${urls.length} 個分頁,手機瀏覽器可能封鎖大部分彈窗,繼續?`
    )) return;
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

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */
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

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white px-4 py-2 rounded-xl shadow-xl text-sm font-semibold">
          {toast}
        </div>
      )}

      <div className="max-w-3xl mx-auto p-4 space-y-4">

        {/* ─────── STEP 1: Upload ─────── */}
        <div className={`rounded-2xl border shadow-sm p-5 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">1</div>
            <h2 className={`text-sm font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>{T.step1}</h2>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white text-sm font-bold shadow-md hover:shadow-lg transition"
            >
              {T.cameraBtn}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-bold transition ${
                darkMode
                  ? 'border-slate-700 hover:bg-slate-800 text-slate-200'
                  : 'border-slate-200 hover:bg-slate-50 text-slate-700'
              }`}
            >
              {T.uploadBtn}
            </button>
          </div>
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" multiple
            onChange={e => handleFiles(e.target.files)} className="hidden" />
          <input ref={fileInputRef} type="file" accept="image/*" multiple
            onChange={e => handleFiles(e.target.files)} className="hidden" />

          {images.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-2 mt-3">
                <span className={`text-[11px] font-semibold ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  {T.selectedImgs} ({images.length})
                </span>
                <button onClick={clearImages} className="text-[11px] text-red-500 hover:text-red-700 font-semibold">
                  ✕ 全部移除
                </button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {images.map(img => (
                  <div key={img.id} className="relative group aspect-square rounded-lg overflow-hidden border border-slate-200">
                    <img src={img.b64} alt={img.name} className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeImage(img.id)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500/90 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className={`text-center py-6 text-xs ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-40" />
              {T.emptyImg}
            </div>
          )}
        </div>

        {/* ─────── STEP 2: OCR ─────── */}
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

          {errorMsg && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700">
              {errorMsg}
            </div>
          )}

          <button
            onClick={runOcr}
            disabled={isOcring || !images.length}
            className="w-full py-3 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-md hover:shadow-lg transition"
          >
            {isOcring ? <><Loader className="w-4 h-4 animate-spin" />{T.ocring}</> : T.runOcr}
          </button>

          {isOcring && progressMsg && (
            <div className={`mt-3 text-[11px] font-mono px-3 py-2 rounded-lg ${darkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
              {progressMsg}
            </div>
          )}

          <div className={`mt-3 text-[11px] ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>
            {T.tip}
          </div>
        </div>

        {/* ─────── STEP 3: Name List ─────── */}
        <div className={`rounded-2xl border shadow-sm p-5 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">3</div>
            <h2 className={`text-sm font-bold flex-1 ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>{T.step3}</h2>
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
                <button onClick={addManual} className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-semibold">
                  {T.addManual}
                </button>
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
                    <input type="checkbox" checked={n.selected} onChange={() => toggleName(n.id)}
                      className="rounded text-blue-600 focus:ring-blue-500" />
                    {editingId === n.id ? (
                      <>
                        <input
                          value={editDraft}
                          onChange={e => setEditDraft(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') { setEditingId(null); setEditDraft(''); } }}
                          autoFocus
                          className="flex-1 text-xs border border-blue-400 rounded px-2 py-1 bg-white text-slate-800"
                        />
                        <button onClick={saveEdit} className="text-emerald-600 hover:text-emerald-700">
                          <Check className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className={`flex-1 text-xs font-medium truncate ${darkMode ? 'text-slate-200' : 'text-slate-800'}`}>{n.name || <em className="text-slate-400">(空白,點 ✏️ 修改)</em>}</span>
                        <a
                          href={`https://www.google.com/search?q=${encodeURIComponent(buildQuery(n.name))}`}
                          target="_blank" rel="noopener noreferrer"
                          onClick={e => { if (!n.name.trim()) e.preventDefault(); }}
                          className="text-blue-500 hover:text-blue-700"
                          title="單獨搜尋"
                        >
                          <Search className="w-3.5 h-3.5" />
                        </a>
                        <button onClick={() => startEdit(n)} className="text-slate-400 hover:text-slate-600">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => removeName(n.id)} className="text-red-400 hover:text-red-600">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
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
                <button onClick={addManual} className="text-[11px] px-3 py-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-semibold">
                  {T.addManual}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ─────── STEP 4: Batch Search ─────── */}
        {selectedNames.length > 0 && (
          <div className={`rounded-2xl border shadow-sm p-5 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">4</div>
              <h2 className={`text-sm font-bold flex-1 ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>{T.step4}</h2>
              <span className="text-[11px] font-bold text-orange-600">{urls.length} {T.totalResults}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button onClick={copyAllUrls} className="py-2.5 rounded-xl text-xs font-bold bg-slate-700 hover:bg-slate-800 text-white shadow">
                {T.copyAll}
              </button>
              <button onClick={shareUrls} className="py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow">
                {T.shareAll}
              </button>
              <button onClick={tryOpenAll} className="py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white shadow">
                {T.openAll}
              </button>
            </div>

            <details className="mt-3">
              <summary className={`text-[11px] cursor-pointer font-semibold ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                預覽 URLs
              </summary>
              <pre className={`mt-2 text-[10px] font-mono p-2 rounded-lg overflow-auto max-h-40 ${darkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-50 text-slate-600'}`}>
                {urls.map(u => `${u.name}\n  ${u.url}`).join('\n\n')}
              </pre>
            </details>
          </div>
        )}

      </div>
    </div>
  );
}

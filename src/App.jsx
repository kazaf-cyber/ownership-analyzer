import React, { useState, useMemo, useRef, useCallback } from 'react';

const NW = 220, NH = 62, GX = 50, GY = 95, PAD = 60;

function calcEff(from, to, edges, memo = {}, d = 0) {
  if (d > 30) return 0;
  if (from === to) return 1;
  const k = from + '→' + to;
  if (k in memo) return memo[k];
  let s = 0;
  for (const e of edges) if (e.from === from) s += (e.pct / 100) * calcEff(e.to, to, edges, memo, d + 1);
  return (memo[k] = s);
}

function getPaths(from, to, edges, vis = new Set()) {
  if (from === to) return [[]];
  if (vis.has(from)) return [];
  vis.add(from);
  const res = [];
  for (const e of edges)
    if (e.from === from)
      for (const sub of getPaths(e.to, to, edges, new Set(vis))) {
        res.push([e, ...sub]);
        if (res.length >= 200) return res;
      }
  return res;
}

function buildLayout(nodes, edges) {
  if (!nodes.length) return { pos: {}, w: 500, h: 200 };
  const out = {}, deg = {};
  nodes.forEach(n => { out[n.id] = []; deg[n.id] = 0; });
  edges.forEach(e => { if (out[e.from]) out[e.from].push(e.to); if (deg[e.to] !== undefined) deg[e.to]++; });
  const lay = {}, q = [], rem = { ...deg };
  nodes.forEach(n => { if (!rem[n.id]) { q.push(n.id); lay[n.id] = 0; } });
  const done = new Set(); let sf = 0;
  while (q.length && sf++ < 9999) {
    const c = q.shift(); if (done.has(c)) continue; done.add(c);
    for (const ch of out[c]) { lay[ch] = Math.max(lay[ch] || 0, (lay[c] || 0) + 1); if (--rem[ch] <= 0 && !done.has(ch)) q.push(ch); }
  }
  nodes.forEach(n => { if (lay[n.id] == null) lay[n.id] = 0; });
  const grp = {}; let mxL = 0;
  nodes.forEach(n => { const l = lay[n.id]; (grp[l] = grp[l] || []).push(n.id); mxL = Math.max(mxL, l); });
  let mxW = 0;
  for (let l = 0; l <= mxL; l++) { const g = grp[l] || []; mxW = Math.max(mxW, g.length * NW + Math.max(0, g.length - 1) * GX); }
  const pos = {};
  for (let l = 0; l <= mxL; l++) {
    const ids = grp[l] || [], rw = ids.length * NW + Math.max(0, ids.length - 1) * GX, sx = (mxW - rw) / 2 + PAD;
    ids.forEach((id, i) => { pos[id] = { x: sx + i * (NW + GX), y: PAD + l * (NH + GY) }; });
  }
  return { pos, w: Math.max(mxW + PAD * 2, 500), h: Math.max(PAD * 2 + (mxL + 1) * NH + mxL * GY, 250) };
}

function wouldCycle(from, to, edges) {
  const vis = new Set(), q = [to];
  while (q.length) { const c = q.shift(); if (c === from) return true; if (vis.has(c)) continue; vis.add(c); for (const e of edges) if (e.from === c) q.push(e.to); }
  return false;
}

export default function App() {
  const uid = useRef(1);
  const gid = (p) => `${p}${uid.current++}`;

  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [tab, setTab] = useState('build');
  const [lang, setLang] = useState('zh');

  const [nName, setNName] = useState('');
  const [nType, setNType] = useState('company');
  const [eFrom, setEFrom] = useState('');
  const [eTo, setETo] = useState('');
  const [ePct, setEPct] = useState('');

  const [target, setTarget] = useState('');
  const [threshold, setThreshold] = useState(25);
  const [expRows, setExpRows] = useState({});
  const [toast, setToast] = useState('');
  const [zoom, setZoom] = useState(1);

  const [confirmDel, setConfirmDel] = useState(null);
  const [editEdge, setEditEdge] = useState(null);
  const [editNode, setEditNode] = useState(null);

  const i = lang === 'zh' ? 0 : 1;
  const T = (zh, en) => [zh, en][i];

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2400); };
  const nn = useCallback((id) => nodes.find(n => n.id === id)?.name || id, [nodes]);
  const togRow = (id) => setExpRows(p => ({ ...p, [id]: !p[id] }));

  const askDeleteNode = (id) => {
    const name = nn(id);
    const relCount = edges.filter(e => e.from === id || e.to === id).length;
    setConfirmDel({ type: 'node', id, name, relCount });
  };
  const askDeleteEdge = (id) => {
    const e = edges.find(x => x.id === id);
    if (!e) return;
    setConfirmDel({ type: 'edge', id, name: `${nn(e.from)} → ${e.pct}% → ${nn(e.to)}` });
  };
  const execDelete = () => {
    if (!confirmDel) return;
    if (confirmDel.type === 'node') {
      setNodes(p => p.filter(n => n.id !== confirmDel.id));
      setEdges(p => p.filter(e => e.from !== confirmDel.id && e.to !== confirmDel.id));
      if (target === confirmDel.id) setTarget('');
    } else {
      setEdges(p => p.filter(e => e.id !== confirmDel.id));
    }
    setConfirmDel(null);
    flash(T('✅ 已刪除', '✅ Deleted'));
  };

  const openEditEdge = (e) => setEditEdge({ id: e.id, pct: String(e.pct) });
  const saveEditEdge = () => {
    if (!editEdge) return;
    const pct = parseFloat(editEdge.pct);
    if (isNaN(pct) || pct <= 0 || pct > 100) return flash(T('⚠️ 比例須 0~100', '⚠️ Must be 0~100'));
    const edge = edges.find(e => e.id === editEdge.id);
    const tot = edges.filter(e => e.to === edge.to && e.id !== editEdge.id).reduce((s, e) => s + e.pct, 0);
    if (tot + pct > 100.01) return flash(T('⚠️ 超過 100%', '⚠️ Exceeds 100%'));
    setEdges(p => p.map(e => e.id === editEdge.id ? { ...e, pct } : e));
    setEditEdge(null);
    flash(T('✅ 已儲存', '✅ Saved'));
  };

  const openEditNode = (n) => setEditNode({ id: n.id, name: n.name, type: n.type });
  const saveEditNode = () => {
    if (!editNode || !editNode.name.trim()) return flash(T('⚠️ 請輸入名稱', '⚠️ Enter a name'));
    setNodes(p => p.map(n => n.id === editNode.id ? { ...n, name: editNode.name.trim(), type: editNode.type } : n));
    setEditNode(null);
    flash(T('✅ 已儲存', '✅ Saved'));
  };

  const addNode = () => {
    const name = nName.trim();
    if (!name) return flash(T('⚠️ 請輸入名稱', '⚠️ Enter a name'));
    setNodes(p => [...p, { id: gid('n'), name, type: nType }]);
    setNName(''); flash(T('✅ 已新增實體', '✅ Entity added'));
  };
  const addEdge = () => {
    const pct = parseFloat(ePct);
    if (!eFrom || !eTo) return flash(T('⚠️ 請選擇兩端', '⚠️ Select both sides'));
    if (eFrom === eTo) return flash(T('⚠️ 不能自我持股', '⚠️ Cannot own self'));
    if (isNaN(pct) || pct <= 0 || pct > 100) return flash(T('⚠️ 比例須 0~100', '⚠️ Must be 0~100'));
    if (edges.some(e => e.from === eFrom && e.to === eTo)) return flash(T('⚠️ 此關係已存在', '⚠️ Already exists'));
    const tot = edges.filter(e => e.to === eTo).reduce((s, e) => s + e.pct, 0);
    if (tot + pct > 100.01) return flash(T('⚠️ 超過 100%', '⚠️ Exceeds 100%'));
    if (wouldCycle(eFrom, eTo, edges)) return flash(T('⚠️ 會產生循環', '⚠️ Would create cycle'));
    setEdges(p => [...p, { id: gid('e'), from: eFrom, to: eTo, pct }]);
    setEPct(''); flash(T('✅ 已新增關係', '✅ Relation added'));
  };

  const lay = useMemo(() => buildLayout(nodes, edges), [nodes, edges]);

  const analysis = useMemo(() => {
    if (!target) return [];
    const memo = {};
    return nodes.filter(n => n.id !== target)
      .map(n => ({ node: n, eff: calcEff(n.id, target, edges, memo) * 100 }))
      .filter(r => r.eff > 0.00005)
      .map(r => ({ ...r, paths: getPaths(r.node.id, target, edges).map(p => ({ edges: p, pct: p.reduce((a, e) => a * e.pct / 100, 1) * 100 })) }))
      .sort((a, b) => b.eff - a.eff);
  }, [nodes, edges, target]);

  const roots = useMemo(() => analysis.filter(r => !edges.some(e => e.to === r.node.id)), [analysis, edges]);
  const ubos = useMemo(() => roots.filter(r => r.eff >= threshold), [roots, threshold]);

  const loadDemo = () => {
    setNodes([
      { id: 'xsp', name: 'Chan Tai Man', type: 'person' },
      { id: 'a', name: 'A', type: 'company' },
      { id: 'b', name: 'B', type: 'company' },
      { id: 'c', name: 'C', type: 'company' },
      { id: 'd', name: 'D', type: 'company' },
      { id: 'e', name: 'E', type: 'company' },
      { id: 'f', name: 'F', type: 'company' },
      { id: 'g', name: 'G', type: 'company' },
      { id: 'h', name: 'H', type: 'company' },
    ]);
    setEdges([
      { id: 'e1', from: 'xsp', to: 'a', pct: 100 },
      { id: 'e2', from: 'xsp', to: 'b', pct: 91.67 },
      { id: 'e3', from: 'xsp', to: 'c', pct: 99.55 },
      { id: 'e4', from: 'a', to: 'd', pct: 60 },
      { id: 'e5', from: 'b', to: 'c', pct: 0.45 },
      { id: 'e6', from: 'd', to: 'e', pct: 4.4405 },
      { id: 'e7', from: 'b', to: 'e', pct: 29.0973 },
      { id: 'e8', from: 'c', to: 'e', pct: 14.6022 },
      { id: 'e9', from: 'xsp', to: 'f', pct: 6.1437 },
      { id: 'e10', from: 'e', to: 'g', pct: 83.5014 },
      { id: 'e11', from: 'f', to: 'g', pct: 16.4986 },
      { id: 'e12', from: 'g', to: 'h', pct: 100 },
    ]);
    setTarget('h'); setTab('analyze'); setExpRows({}); uid.current = 100;
    flash(T('✅ 已載入範例', '✅ Demo loaded'));
  };
  const reset = () => {
    setNodes([]); setEdges([]); setTarget(''); setNName(''); setEFrom(''); setETo(''); setEPct('');
    setExpRows({}); uid.current = 1; setTab('build'); setZoom(1);
    setEditEdge(null); setEditNode(null); setConfirmDel(null);
  };

  const curve = (x1, y1, x2, y2) => {
    if (Math.abs(x1 - x2) < 5) return `M${x1},${y1} L${x2},${y2}`;
    const dy = y2 - y1;
    return `M${x1},${y1} C${x1},${y1 + dy * 0.4} ${x2},${y2 - dy * 0.4} ${x2},${y2}`;
  };

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50 overflow-hidden text-gray-800">

      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-6 py-2.5 rounded-xl shadow-2xl font-medium">{toast}</div>}

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmDel(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-96 max-w-sm mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-red-600 text-white px-5 py-3 flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              <span className="font-bold text-sm">{T('確認刪除', 'Confirm Delete')}</span>
            </div>
            <div className="p-5">
              <p className="text-sm text-gray-600 mb-3">{T('確定要刪除以下項目嗎？', 'Are you sure you want to delete:')}</p>
              <div className="bg-red-50 border-2 border-red-200 rounded-xl p-3 mb-3">
                <p className="text-sm font-bold text-red-700 break-all">
                  {confirmDel.type === 'node' ? '🏢 ' : '🔗 '}{confirmDel.name}
                </p>
              </div>
              {confirmDel.type === 'node' && confirmDel.relCount > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-2.5 mb-3">
                  <p className="text-xs text-orange-700 font-medium">
                    ⚠️ {T(`將同時刪除 ${confirmDel.relCount} 條相關持股關係`, `${confirmDel.relCount} related relation(s) will also be removed`)}
                  </p>
                </div>
              )}
              <div className="flex gap-3 mt-4">
                <button onClick={() => setConfirmDel(null)} className="flex-1 py-2.5 border-2 border-gray-300 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-100 transition">
                  {T('取消', 'Cancel')}
                </button>
                <button onClick={execDelete} className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition">
                  {T('🗑️ 確認刪除', '🗑️ Delete')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editEdge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditEdge(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-96 max-w-sm mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-blue-600 text-white px-5 py-3 font-bold text-sm">✏️ {T('編輯持股關係', 'Edit Ownership')}</div>
            <div className="p-5">
              {(() => { const ed = edges.find(e => e.id === editEdge.id); return ed ? (
                <div className="bg-gray-50 rounded-xl p-3 mb-4 text-sm">
                  <span className="font-bold">{nn(ed.from)}</span>
                  <span className="text-blue-600 font-bold"> → </span>
                  <span className="font-bold">{nn(ed.to)}</span>
                </div>
              ) : null; })()}
              <label className="text-xs font-bold text-gray-600 block mb-1">{T('持股比例 %', 'Ownership %')}</label>
              <input type="number" className="w-full border-2 border-blue-300 rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-400 outline-none mb-4" value={editEdge.pct} onChange={e => setEditEdge(p => ({ ...p, pct: e.target.value }))} min="0.0001" max="100" step="0.0001" />
              <div className="flex gap-3">
                <button onClick={() => setEditEdge(null)} className="flex-1 py-2.5 border-2 border-gray-300 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-100 transition">{T('取消', 'Cancel')}</button>
                <button onClick={saveEditEdge} className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition">{T('💾 儲存', '💾 Save')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditNode(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-96 max-w-sm mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-green-600 text-white px-5 py-3 font-bold text-sm">✏️ {T('編輯實體', 'Edit Entity')}</div>
            <div className="p-5">
              <label className="text-xs font-bold text-gray-600 block mb-1">{T('名稱', 'Name')}</label>
              <input className="w-full border-2 border-green-300 rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-green-400 outline-none mb-3" value={editNode.name} onChange={e => setEditNode(p => ({ ...p, name: e.target.value }))} />
              <label className="text-xs font-bold text-gray-600 block mb-1">{T('類型', 'Type')}</label>
              <select className="w-full border-2 border-green-300 rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-green-400 outline-none mb-4" value={editNode.type} onChange={e => setEditNode(p => ({ ...p, type: e.target.value }))}>
                <option value="company">{T('🏢 公司', '🏢 Company')}</option>
                <option value="person">{T('👤 個人', '👤 Person')}</option>
              </select>
              <div className="flex gap-3">
                <button onClick={() => setEditNode(null)} className="flex-1 py-2.5 border-2 border-gray-300 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-100 transition">{T('取消', 'Cancel')}</button>
                <button onClick={saveEditNode} className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition">{T('💾 儲存', '💾 Save')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border-b shadow-sm px-4 py-2.5 flex flex-wrap items-center gap-3 flex-shrink-0">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#2563eb" strokeWidth="2"><path d="M6 3v12"/><path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M18 9v3a3 3 0 0 1-3 3H9"/></svg>
        <h1 className="text-lg font-bold text-gray-800">{T('多層股權穿透分析工具', 'Multi-Layer Ownership Analyzer')}</h1>
        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{T('DAG 穿透', 'DAG Analysis')}</span>
        <div className="flex-1" />
        <button onClick={() => setLang(l => l === 'zh' ? 'en' : 'zh')} className="px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg text-xs hover:bg-indigo-200 transition font-bold border border-indigo-200">🌐 {lang === 'zh' ? 'EN' : '中文'}</button>
        <button onClick={loadDemo} className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg text-xs hover:bg-purple-200 transition font-medium border border-purple-200">{T('📊 載入範例', '📊 Load Demo')}</button>
        <button onClick={reset} className="px-3 py-1.5 bg-red-100 text-red-600 rounded-lg text-xs hover:bg-red-200 transition font-medium border border-red-200">{T('↺ 重置', '↺ Reset')}</button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 2xl:w-96 flex-shrink-0 bg-white border-r flex flex-col overflow-hidden">
          <div className="flex gap-1 p-2 bg-gray-50 border-b">
            {[['build', T('🏗️ 建構', '🏗️ Build')], ['manage', T('📋 管理', '📋 Manage')], ['analyze', T('🔍 分析', '🔍 Analyze')]].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${tab === k ? 'bg-white shadow text-blue-700 border' : 'text-gray-500 hover:bg-gray-100'}`}>{label}</button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
            {tab === 'build' && (<>
              <div className="border rounded-xl p-3 bg-white shadow-sm">
                <h3 className="text-xs font-bold text-gray-700 mb-2">{T('➕ 新增實體', '➕ Add Entity')}</h3>
                <input className="w-full border rounded-lg px-3 py-2 text-sm mb-2 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none" placeholder={T('輸入名稱', 'Enter name')} value={nName} onChange={e => setNName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addNode()} />
                <div className="flex gap-2">
                  <select className="flex-1 border rounded-lg px-2 py-2 text-sm" value={nType} onChange={e => setNType(e.target.value)}>
                    <option value="company">{T('🏢 公司', '🏢 Company')}</option>
                    <option value="person">{T('👤 個人', '👤 Person')}</option>
                  </select>
                  <button onClick={addNode} className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition">{T('新增', 'Add')}</button>
                </div>
              </div>
              <div className="border rounded-xl p-3 bg-white shadow-sm">
                <h3 className="text-xs font-bold text-gray-700 mb-2">{T('🔗 新增持股關係', '🔗 Add Ownership')}</h3>
                <label className="text-xs text-gray-500 font-medium">{T('股東（持有方）', 'Shareholder:')}</label>
                <select className="w-full border rounded-lg px-2 py-2 text-sm mb-1.5" value={eFrom} onChange={e => setEFrom(e.target.value)}>
                  <option value="">{T('-- 選擇 --', '-- Select --')}</option>
                  {nodes.map(n => <option key={n.id} value={n.id}>{n.type === 'person' ? '👤' : '🏢'} {n.name}</option>)}
                </select>
                <label className="text-xs text-gray-500 font-medium">{T('被投資方', 'Investee:')}</label>
                <select className="w-full border rounded-lg px-2 py-2 text-sm mb-1.5" value={eTo} onChange={e => setETo(e.target.value)}>
                  <option value="">{T('-- 選擇 --', '-- Select --')}</option>
                  {nodes.filter(n => n.id !== eFrom).map(n => <option key={n.id} value={n.id}>{n.type === 'person' ? '👤' : '🏢'} {n.name}</option>)}
                </select>
                <label className="text-xs text-gray-500 font-medium">{T('持股 %', 'Ownership %:')}</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm mb-2 focus:ring-1 focus:ring-green-300 outline-none" type="number" placeholder="e.g. 60" min="0.0001" max="100" step="0.0001" value={ePct} onChange={e => setEPct(e.target.value)} onKeyDown={e => e.key === 'Enter' && addEdge()} />
                <button onClick={addEdge} className="w-full py-2.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 transition">{T('＋ 新增持股關係', '＋ Add Ownership')}</button>
              </div>
            </>)}

            {tab === 'manage' && (<>
              <div className="border-2 border-blue-200 rounded-xl bg-white shadow-sm overflow-hidden">
                <div className="bg-blue-50 px-3 py-2 border-b border-blue-200 flex items-center gap-2">
                  <span className="text-sm">🏢</span>
                  <span className="text-xs font-bold text-blue-800">{T('實體管理', 'Entity Management')}</span>
                  <span className="ml-auto bg-blue-200 text-blue-800 text-xs font-bold px-2 py-0.5 rounded-full">{nodes.length}</span>
                </div>
                {nodes.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-6">{T('尚無實體', 'No entities yet')}</p>
                ) : (
                  <div className="divide-y max-h-60 overflow-y-auto">
                    {nodes.map(n => (
                      <div key={n.id} className="flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 transition">
                        <span className="text-base flex-shrink-0">{n.type === 'person' ? '👤' : '🏢'}</span>
                        <span className="text-xs font-semibold flex-1 truncate text-gray-800">{n.name}</span>
                        <button onClick={() => openEditNode(n)} className="flex-shrink-0 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg px-2.5 py-1.5 text-xs font-bold transition">✏️ {T('編輯', 'Edit')}</button>
                        <button onClick={() => askDeleteNode(n.id)} className="flex-shrink-0 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg px-2.5 py-1.5 text-xs font-bold transition">🗑️ {T('刪除', 'Del')}</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="border-2 border-green-200 rounded-xl bg-white shadow-sm overflow-hidden">
                <div className="bg-green-50 px-3 py-2 border-b border-green-200 flex items-center gap-2">
                  <span className="text-sm">🔗</span>
                  <span className="text-xs font-bold text-green-800">{T('持股關係管理', 'Relation Management')}</span>
                  <span className="ml-auto bg-green-200 text-green-800 text-xs font-bold px-2 py-0.5 rounded-full">{edges.length}</span>
                </div>
                {edges.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-6">{T('尚無關係', 'No relations yet')}</p>
                ) : (
                  <div className="divide-y max-h-72 overflow-y-auto">
                    {edges.map(e => (
                      <div key={e.id} className="px-3 py-2.5 hover:bg-gray-50 transition">
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-gray-800 truncate">{nn(e.from)}</div>
                            <div className="flex items-center gap-1 my-0.5">
                              <span className="text-blue-600 font-black text-xs">↓ {e.pct}%</span>
                            </div>
                            <div className="text-xs font-semibold text-gray-800 truncate">{nn(e.to)}</div>
                          </div>
                          <div className="flex flex-col gap-1.5 flex-shrink-0 pt-1">
                            <button onClick={() => openEditEdge(e)} className="bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg px-2.5 py-1.5 text-xs font-bold transition whitespace-nowrap">✏️ {T('編輯', 'Edit')}</button>
                            <button onClick={() => askDeleteEdge(e.id)} className="bg-red-100 hover:bg-red-200 text-red-700 rounded-lg px-2.5 py-1.5 text-xs font-bold transition whitespace-nowrap">🗑️ {T('刪除', 'Del')}</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>)}

            {tab === 'analyze' && (<>
              <div className="border rounded-xl p-3 bg-white shadow-sm">
                <h3 className="text-xs font-bold text-gray-700 mb-2">{T('🎯 分析目標', '🎯 Analysis Target')}</h3>
                <select className="w-full border-2 border-blue-200 rounded-lg px-3 py-2 text-sm bg-blue-50 font-medium" value={target} onChange={e => { setTarget(e.target.value); setExpRows({}); }}>
                  <option value="">{T('-- 選擇目標 --', '-- Select Target --')}</option>
                  {nodes.map(n => <option key={n.id} value={n.id}>{n.type === 'person' ? '👤' : '🏢'} {n.name}</option>)}
                </select>
                <p className="text-xs text-gray-400 mt-1.5">{T('💡 也可在圖中點擊節點設為目標', '💡 Click a node in the chart to set target')}</p>
                <div className="flex items-center gap-2 mt-2 pt-2 border-t">
                  <span className="text-xs text-gray-500 font-medium">{T('UBO 門檻', 'UBO Threshold:')}</span>
                  <input type="number" className="border rounded px-2 py-1 text-sm w-16 text-center font-bold" value={threshold} onChange={e => setThreshold(parseFloat(e.target.value) || 25)} min="1" max="100" />
                  <span className="text-xs text-gray-500">%</span>
                </div>
              </div>
              <div className="border rounded-xl p-3 bg-white shadow-sm">
                <h3 className="text-xs font-bold text-gray-700 mb-2">{T('⚠️ UBO 最終受益人', '⚠️ Ultimate Beneficial Owner')}</h3>
                {ubos.length > 0 ? ubos.map((u, i) => (
                  <div key={i} className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold truncate">{u.node.type === 'person' ? '👤' : '🏢'} {u.node.name}</span>
                      <span className="text-base font-black text-red-600 flex-shrink-0">{u.eff.toFixed(4)}%</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{u.paths.length} {T('條持股路徑', 'path(s)')}</div>
                  </div>
                )) : <p className="text-xs text-gray-400 text-center py-3">{target ? `${T('未發現 UBO ≥', 'No UBO ≥')} ${threshold}%` : T('請先選擇目標', 'Select a target')}</p>}
              </div>
              {target && analysis.length > 0 && (
                <div className="border rounded-xl p-3 bg-white shadow-sm">
                  <h3 className="text-xs font-bold text-gray-700 mb-2">{T('📊 統計摘要', '📊 Statistics')}</h3>
                  <div className="grid grid-cols-2 gap-2 text-center">
                    {[
                      [analysis.length, T('全部股東', 'All SH'), 'bg-blue-50', 'text-blue-600'],
                      [ubos.length, 'UBO', 'bg-red-50', 'text-red-600'],
                      [roots.length, T('最終股東', 'Ultimate SH'), 'bg-green-50', 'text-green-600'],
                      [Math.max(0, ...analysis.flatMap(r => r.paths.map(p => p.edges.length))), T('最深層數', 'Max Depth'), 'bg-purple-50', 'text-purple-600'],
                    ].map(([v, l, bg, tc], i) => (
                      <div key={i} className={`${bg} rounded-lg p-2`}>
                        <div className={`text-xl font-black ${tc}`}>{v}</div>
                        <div className="text-xs text-gray-500">{l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>)}
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto relative bg-gray-50" style={{ backgroundImage: 'radial-gradient(#e5e7eb 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
            <div className="sticky top-2 left-2 z-10 inline-flex items-center gap-1 bg-white/90 backdrop-blur rounded-lg shadow border px-2 py-1 ml-2 mt-2">
              <button onClick={() => setZoom(z => Math.max(0.2, +(z - 0.1).toFixed(1)))} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 font-bold text-sm">−</button>
              <span className="text-xs w-10 text-center font-medium">{(zoom * 100).toFixed(0)}%</span>
              <button onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(1)))} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 font-bold text-sm">+</button>
              <div className="w-px h-4 bg-gray-200 mx-0.5" />
              <button onClick={() => setZoom(1)} className="text-xs text-blue-600 font-medium hover:underline px-1">1:1</button>
            </div>

            {nodes.length > 0 ? (
              <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: lay.w, height: lay.h, minWidth: lay.w }}>
                <svg width={lay.w} height={lay.h}>
                  <defs>
                    <marker id="arw" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0,10 3.5,0 7" fill="#94a3b8" /></marker>
                  </defs>
                  {edges.map(e => {
                    const fp = lay.pos[e.from], tp = lay.pos[e.to];
                    if (!fp || !tp) return null;
                    const x1 = fp.x + NW / 2, y1 = fp.y + NH, x2 = tp.x + NW / 2, y2 = tp.y;
                    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
                    const lbl = `${e.pct}%`, lw = Math.max(50, lbl.length * 7.5 + 14);
                    return (
                      <g key={e.id}>
                        <path d={curve(x1, y1, x2, y2)} fill="none" stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#arw)" />
                        <rect x={mx - lw / 2} y={my - 11} width={lw} height="22" rx="11" fill="white" stroke="#cbd5e1" strokeWidth="1" />
                        <text x={mx} y={my + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="#334155">{lbl}</text>
                      </g>
                    );
                  })}
                  {nodes.map(n => {
                    const p = lay.pos[n.id]; if (!p) return null;
                    const isPerson = n.type === 'person';
                    const isTgt = n.id === target;
                    const isRoot = !edges.some(e => e.to === n.id);
                    return (
                      <g key={n.id} className="cursor-pointer" onClick={() => { setTarget(n.id); setExpRows({}); if (tab !== 'analyze') setTab('analyze'); }}>
                        {isTgt && <rect x={p.x - 4} y={p.y - 4} width={NW + 8} height={NH + 8} rx="14" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="6 3" />}
                        <rect x={p.x} y={p.y} width={NW} height={NH} rx="10"
                          fill={isTgt ? '#fef9c3' : isPerson ? '#dcfce7' : '#eff6ff'}
                          stroke={isTgt ? '#eab308' : isPerson ? '#22c55e' : '#3b82f6'}
                          strokeWidth={isTgt ? 2 : 1.5} />
                        <foreignObject x={p.x} y={p.y} width={NW} height={NH}>
                          <div style={{ width: NW, height: NH, display: 'flex', alignItems: 'center', padding: '0 10px', gap: 6, overflow: 'hidden' }}>
                            <span style={{ fontSize: 17, flexShrink: 0, lineHeight: 1 }}>{isPerson ? '👤' : '🏢'}</span>
                            <span style={{ fontSize: 10.5, lineHeight: '13px', fontWeight: 600, color: '#1e293b', overflow: 'hidden', wordBreak: 'break-all', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{n.name}</span>
                          </div>
                        </foreignObject>
                        {isTgt && <text x={p.x + NW / 2} y={p.y - 10} textAnchor="middle" fontSize="10" fill="#b45309" fontWeight="bold">🎯 {T('分析目標', 'Target')}</text>}
                        {isRoot && !isTgt && <circle cx={p.x + NW - 6} cy={p.y + 6} r="5" fill="#22c55e" stroke="white" strokeWidth="1.5" />}
                      </g>
                    );
                  })}
                </svg>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="8" y="14" width="7" height="7" rx="1"/><path d="M6 10v2a2 2 0 0 0 2 2h1M17 10v2a2 2 0 0 1-2 2h-1"/></svg>
                <p className="text-sm">{T('請先新增實體和關係，或點擊「載入範例」', 'Add entities & relations, or click "Load Demo"')}</p>
              </div>
            )}
          </div>

          {tab === 'analyze' && target && analysis.length > 0 && (
            <div className="border-t bg-white overflow-auto flex-shrink-0" style={{ maxHeight: '38vh' }}>
              <div className="p-3 pb-1 flex items-center gap-2 border-b bg-gray-50 sticky top-0 z-10">
                <span className="text-xs font-bold text-gray-700">{T('🔍 穿透持股明細', '🔍 Ownership Detail')}</span>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">{nn(target)}</span>
                <div className="flex-1" />
                <span className="text-xs text-gray-400">{analysis.length} {T('個股東', 'shareholder(s)')}</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left border-b text-xs text-gray-500 font-bold">
                    <th className="py-1.5 px-3 w-7"></th>
                    <th className="py-1.5 px-3">{T('股東', 'Shareholder')}</th>
                    <th className="py-1.5 px-3">{T('層級', 'Level')}</th>
                    <th className="py-1.5 px-3 text-right">{T('實際持股', 'Effective %')}</th>
                    <th className="py-1.5 px-3 text-center">{T('路徑', 'Paths')}</th>
                    <th className="py-1.5 px-3 text-center">UBO</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.map((r, i) => {
                    const isRt = !edges.some(e => e.to === r.node.id);
                    const isU = isRt && r.eff >= threshold;
                    const isE = expRows[r.node.id];
                    return (
                      <React.Fragment key={i}>
                        <tr className={`border-b cursor-pointer transition-colors ${isU ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}`} onClick={() => togRow(r.node.id)}>
                          <td className="py-1.5 px-3 text-gray-400 text-xs">{r.paths.length > 0 ? (isE ? '▼' : '▶') : ''}</td>
                          <td className="py-1.5 px-3 font-medium text-xs">{r.node.type === 'person' ? '👤' : '🏢'} {r.node.name}</td>
                          <td className="py-1.5 px-3"><span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${isRt ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{isRt ? T('最終', 'Ultimate') : T('中間', 'Middle')}</span></td>
                          <td className={`py-1.5 px-3 text-right font-black ${isU ? 'text-red-600' : 'text-blue-600'}`}>{r.eff.toFixed(4)}%</td>
                          <td className="py-1.5 px-3 text-center text-xs text-gray-400">{r.paths.length}</td>
                          <td className="py-1.5 px-3 text-center">{isU && <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full font-bold">⚠ UBO</span>}</td>
                        </tr>
                        {isE && r.paths.map((p, j) => (
                          <tr key={`${i}-${j}`} className="bg-blue-50/50 border-b">
                            <td></td>
                            <td colSpan={4} className="py-1.5 px-3">
                              <div className="flex items-center gap-1 flex-wrap text-xs">
                                <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold flex-shrink-0">{T('路徑', 'Path')} {j + 1}</span>
                                <span className="font-semibold text-gray-700">{r.node.name}</span>
                                {p.edges.map((pe, k) => (
                                  <React.Fragment key={k}>
                                    <span className="text-blue-500 font-bold">—[{pe.pct}%]→</span>
                                    <span className="font-semibold text-gray-700">{nn(pe.to)}</span>
                                  </React.Fragment>
                                ))}
                              </div>
                            </td>
                            <td className="py-1.5 px-3 text-right text-xs font-black text-purple-600 whitespace-nowrap">{p.pct.toFixed(4)}%</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border-t px-4 py-1.5 text-center text-xs text-gray-400 flex-shrink-0">{T('多層 DAG 穿透分析 ｜ 支持多父節點 ｜ 所有路徑加總 ｜ 點擊節點分析', 'Multi-Layer DAG ｜ Multiple Parents ｜ Sum All Paths ｜ Click Node to Analyze')}</div>
    </div>
  );
}


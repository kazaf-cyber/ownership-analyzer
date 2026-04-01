#!/usr/bin/env node
/**
 * integrate.js
 * 使用方法: node integrate.js App.jsx > App.jsx
 * 或: node integrate.js App.jsx
 *     (自動寫出 App.jsx，原檔備份為 App.jsx.bak)
 */

const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('用法: node integrate.js <App.jsx路徑>');
  process.exit(1);
}

let src = fs.readFileSync(inputFile, 'utf8');

// ── 1. 加入 lucide-react import ──────────────────────────────────────────────
const RECHARTS_IMPORT = `import { PieChart, Pie, Cell, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer } from 'recharts';`;
const LUCIDE_IMPORT = `import { Search, Brain, AlertTriangle, CheckCircle, XCircle, Info, ChevronDown, ChevronRight, Globe, ExternalLink, Loader, Shield } from 'lucide-react';`;

if (!src.includes(LUCIDE_IMPORT)) {
  src = src.replace(RECHARTS_IMPORT, RECHARTS_IMPORT + '\n' + LUCIDE_IMPORT);
  console.error('✅ 步驟1: lucide-react import 已加入');
} else {
  console.error('ℹ️  步驟1: lucide-react import 已存在，跳過');
}

// ── 2. i18n EN: uboTab 後加 adverseMediaTab ──────────────────────────────────
if (!src.includes("adverseMediaTab: 'Adverse Media'")) {
  src = src.replace(
    "uboTab: 'UBO',",
    "uboTab: 'UBO', adverseMediaTab: 'Adverse Media',"
  );
  console.error('✅ 步驟2a: EN adverseMediaTab 已加入');
}

// ── 3. i18n ZH: 第二個 uboTab 後加中文 ──────────────────────────────────────
if (!src.includes("adverseMediaTab: '不良媒體篩查'")) {
  // 找到第二處 uboTab: 'UBO', (即 zh section)
  const firstIdx = src.indexOf("uboTab: 'UBO',");
  const secondIdx = src.indexOf("uboTab: 'UBO',", firstIdx + 1);
  if (secondIdx !== -1) {
    src = src.slice(0, secondIdx) +
      "uboTab: 'UBO', adverseMediaTab: '不良媒體篩查'," +
      src.slice(secondIdx + "uboTab: 'UBO',".length);
    console.error('✅ 步驟2b: ZH adverseMediaTab 已加入');
  }
}

// ── 4. 移除舊的頂層獨立導航（若存在）─────────────────────────────────────────
if (src.includes("{ id: 'adverseMedia', icon: '🔎', label: t.adverseMedia }")) {
  src = src.replace(/\n\s*\{\s*id:\s*'adverseMedia',\s*icon:\s*'🔎',\s*label:\s*t\.adverseMedia\s*\},?/g, '');
  src = src.replace(/{view === 'adverseMedia' && <AdverseMediaScreening \/>}/g, '');
  // 移除頂層 i18n 鍵
  src = src.replace(/adverseMedia:\s*'Adverse Media',\s*\n/g, '');
  src = src.replace(/adverseMedia:\s*'不良媒體篩查',\s*\n/g, '');
  console.error('✅ 步驟3: 舊頂層導航已移除');
}

// ── 5. 實體詳情 tabs 加入 adverseMedia（UBO 旁）──────────────────────────────
if (!src.includes("id: 'adverseMedia'")) {
  src = src.replace(
    "{ id: 'ubo', label: t.uboTab }, { id: 'documents'",
    "{ id: 'ubo', label: t.uboTab }, { id: 'adverseMedia', label: '🔎 ' + (t.adverseMediaTab || 'Media') }, { id: 'documents'"
  );
  console.error('✅ 步驟4: adverseMedia 分頁已加入 tabs 陣列');
} else {
  console.error('ℹ️  步驟4: adverseMedia tab 已存在，跳過');
}

// ── 6. 插入 adverseMedia 渲染區塊（documents 前）───────────────────────────
const AMS_RENDER = `{detailTab === 'adverseMedia' && (
          <div className="pb-2">
            <AdverseMediaScreening entityName={ent.name} />
          </div>
        )}
        `;

if (!src.includes("detailTab === 'adverseMedia'")) {
  src = src.replace(
    "{detailTab === 'documents' && (<div>",
    AMS_RENDER + "{detailTab === 'documents' && (<div>"
  );
  console.error('✅ 步驟5: adverseMedia 渲染區塊已插入');
} else {
  console.error('ℹ️  步驟5: adverseMedia 渲染已存在，跳過');
}

// ── 7. 插入 AMS 模組代碼（在主組件前）─────────────────────────────────────
const MARKER = '/* =============== MAIN COMPONENT =============== */';
const AMS_MODULE = fs.readFileSync(
  path.join(path.dirname(inputFile), 'ams_module.js'),
  'utf8'
);

if (src.includes(MARKER) && !src.includes('function AdverseMediaScreening')) {
  src = src.replace(MARKER, AMS_MODULE + '\n' + MARKER);
  console.error('✅ 步驟6: AMS 模組已插入');
} else if (src.includes('function AdverseMediaScreening')) {
  // Already has AMS, replace it with new version
  const amsStart = src.indexOf('/* ========== ADVERSE MEDIA SCREENING MODULE');
  const amsEnd = src.indexOf(MARKER);
  if (amsStart !== -1 && amsEnd !== -1) {
    src = src.slice(0, amsStart) + AMS_MODULE + '\n' + src.slice(amsEnd);
    console.error('✅ 步驟6: AMS 模組已更新（替換舊版本）');
  }
} else {
  console.error('⚠️  步驟6: 找不到 MAIN COMPONENT 標記，AMS 模組插入可能失敗');
}

// ── 寫出結果 ─────────────────────────────────────────────────────────────────
if (process.stdout.isTTY) {
  // 直接覆蓋原檔（先備份）
  const bakFile = inputFile + '.bak';
  fs.copyFileSync(inputFile, bakFile);
  fs.writeFileSync(inputFile, src, 'utf8');
  console.error(`✅ 完成！原檔已備份為 ${bakFile}`);
  console.error(`✅ ${inputFile} 已更新`);
} else {
  // 輸出到 stdout（用於 > 重定向）
  process.stdout.write(src);
  console.error('✅ 完成！輸出到 stdout');
}

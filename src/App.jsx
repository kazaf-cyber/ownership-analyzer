import React, { useState, useCallback } from 'react'

// 預設範例資料
const defaultData = [
  { parent: 'A公司', child: 'B公司', percent: 80 },
  { parent: 'A公司', child: 'C公司', percent: 60 },
  { parent: 'B公司', child: 'D公司', percent: 70 },
  { parent: 'C公司', child: 'D公司', percent: 30 },
  { parent: 'D公司', child: 'E公司', percent: 50 },
]

function App() {
  const [rows, setRows] = useState(defaultData)
  const [target, setTarget] = useState('')
  const [results, setResults] = useState(null)

  // 新增一列
  const addRow = () => {
    setRows([...rows, { parent: '', child: '', percent: 0 }])
  }

  // 刪除一列
  const removeRow = (index) => {
    setRows(rows.filter((_, i) => i !== index))
  }

  // 修改一列
  const updateRow = (index, field, value) => {
    const newRows = [...rows]
    newRows[index] = { ...newRows[index], [field]: field === 'percent' ? Number(value) : value }
    setRows(newRows)
  }

  // 計算穿透持股
  const calculate = useCallback(() => {
    if (!target) return

    // 建立鄰接表
    const edges = {}
    rows.forEach(({ parent, child, percent }) => {
      if (!parent || !child) return
      if (!edges[parent]) edges[parent] = []
      edges[parent].push({ to: child, pct: percent / 100 })
    })

    // 找出所有公司
    const allCompanies = new Set()
    rows.forEach(({ parent, child }) => {
      if (parent) allCompanies.add(parent)
      if (child) allCompanies.add(child)
    })

    // BFS/DFS 找出所有從各公司到 target 的路徑及穿透比例
    const pathResults = []

    const findPaths = (start, current, visited, pathPct, path) => {
      if (current === target && start !== target) {
        pathResults.push({
          from: start,
          path: [...path],
          percentage: pathPct,
        })
        return
      }
      if (!edges[current]) return
      for (const edge of edges[current]) {
        if (visited.has(edge.to)) continue
        visited.add(edge.to)
        path.push(edge.to)
        findPaths(start, edge.to, visited, pathPct * edge.pct, path)
        path.pop()
        visited.delete(edge.to)
      }
    }

    // 從每個公司出發找路徑
    allCompanies.forEach((company) => {
      if (company === target) return
      const visited = new Set([company])
      findPaths(company, company, visited, 1, [company])
    })

    // 按持股方彙總
    const summaryMap = {}
    pathResults.forEach(({ from, path, percentage }) => {
      if (!summaryMap[from]) summaryMap[from] = { total: 0, paths: [] }
      summaryMap[from].total += percentage
      summaryMap[from].paths.push({ route: path.join(' → '), pct: percentage })
    })

    setResults({ target, summary: summaryMap, paths: pathResults })
  }, [rows, target])

  // 重置
  const reset = () => {
    setRows(defaultData)
    setTarget('')
    setResults(null)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
      {/* 頂部標題 */}
      <header className="bg-white shadow-sm border-b border-slate-200 px-4 py-3">
        <h1 className="text-xl font-bold text-slate-800 text-center">
          📊 多層股權穿透分析工具
        </h1>
        <p className="text-xs text-slate-500 text-center mt-1">
          輸入股權關係，計算任一公司的穿透持股比例
        </p>
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-4 pb-20">
        {/* 股權關係輸入區 */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">📝 股權關係表</h2>
            <button
              onClick={addRow}
              className="text-xs bg-blue-500 text-white px-3 py-1 rounded-full hover:bg-blue-600 active:bg-blue-700 transition"
            >
              + 新增一列
            </button>
          </div>

          {/* 表頭 */}
          <div className="grid grid-cols-7 gap-2 text-xs font-medium text-slate-500 mb-2 px-1">
            <div className="col-span-2">持股方</div>
            <div className="col-span-2">被持股方</div>
            <div className="col-span-2">持股比例 (%)</div>
            <div className="col-span-1"></div>
          </div>

          {/* 表身 */}
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-7 gap-2 items-center">
                <input
                  className="col-span-2 border border-slate-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="例：A公司"
                  value={row.parent}
                  onChange={(e) => updateRow(i, 'parent', e.target.value)}
                />
                <input
                  className="col-span-2 border border-slate-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="例：B公司"
                  value={row.child}
                  onChange={(e) => updateRow(i, 'child', e.target.value)}
                />
                <input
                  className="col-span-2 border border-slate-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  type="number"
                  min="0"
                  max="100"
                  value={row.percent}
                  onChange={(e) => updateRow(i, 'percent', e.target.value)}
                />
                <button
                  onClick={() => removeRow(i)}
                  className="col-span-1 text-red-400 hover:text-red-600 text-lg text-center"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* 查詢區 */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">🔍 穿透查詢</h2>
          <div className="flex gap-2">
            <input
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="輸入目標公司名稱（例：D公司）"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
            <button
              onClick={calculate}
              className="bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-600 active:bg-emerald-700 transition"
            >
              計算
            </button>
            <button
              onClick={reset}
              className="bg-slate-200 text-slate-600 px-3 py-2 rounded-lg text-sm hover:bg-slate-300 active:bg-slate-400 transition"
            >
              重置
            </button>
          </div>
        </section>

        {/* 結果區 */}
        {results && (
          <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">
              📈 對「{results.target}」的穿透持股結果
            </h2>

            {Object.keys(results.summary).length === 0 ? (
              <p className="text-sm text-slate-500">找不到任何公司持有「{results.target}」的股權路徑。</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(results.summary)
                  .sort((a, b) => b[1].total - a[1].total)
                  .map(([company, data]) => (
                    <div key={company} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-slate-800">{company}</span>
                        <span className="text-sm font-bold text-emerald-600">
                          穿透合計：{(data.total * 100).toFixed(2)}%
                        </span>
                      </div>
                      <div className="space-y-1">
                        {data.paths.map((p, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs text-slate-500">
                            <span>路徑：{p.route} → {results.target}</span>
                            <span className="font-medium text-slate-600">{(p.pct * 100).toFixed(2)}%</span>
                          </div>
                        ))}
                      </div>
                      {/* 簡易進度條 */}
                      <div className="mt-2 w-full bg-slate-200 rounded-full h-2">
                        <div
                          className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(data.total * 100, 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </section>
        )}
      </main>

      {/* 底部 */}
      <footer className="bg-white border-t border-slate-200 px-4 py-2 text-center">
        <p className="text-xs text-slate-400">Ownership Analyzer © 2024</p>
      </footer>
    </div>
  )
}

export default App


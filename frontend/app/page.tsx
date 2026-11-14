"use client";

import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

const API = (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");
type Dataset = { id: string; connection_id: string; name: string; filename: string; size_bytes: number; uploaded_at: string; tables: { table: string; columns: { name: string; type?: string }[]; row_count: number }[]; preview: Record<string, unknown>[]; duplicate_rows: number; total_rows?: number };
type Question = { id: string; question: string; options: string[] };
type Result = { status: string; message?: string; questions?: Question[]; sql?: string; columns?: string[]; rows?: Record<string, unknown>[]; explanation?: string; dataset_name?: string; validation_status?: string };
type View = "dashboard" | "workspace" | "sources" | "explorer" | "history" | "analytics" | "settings";

async function request(path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${API}${path}`, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => ({ detail: "The server returned an invalid response." }));
    if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail));
    return body;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Request timed out. Check the database connection.");
    throw error instanceof Error ? error : new Error("Request failed.");
  } finally { window.clearTimeout(timeout); }
}

export default function Home() {
  const [view, setView] = useState<View>("workspace");
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [active, setActive] = useState<Dataset | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("querymind-theme");
    if (savedTheme === "dark") setDark(true);
    request("/datasets").then((items: Dataset[]) => { setDatasets(items); setActive(items[0] ?? null); }).catch((loadError) => setError(loadError.message));
    request("/dashboard").then(setStats).catch(() => undefined);
  }, []);

  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; window.localStorage.setItem("querymind-theme", dark ? "dark" : "light"); }, [dark]);

  async function upload(file: File) {
    const allowed = [".csv", ".xlsx", ".xls", ".json", ".db", ".sqlite", ".sqlite3"];
    setError("");
    if (!allowed.some((extension) => file.name.toLowerCase().endsWith(extension))) { setError("Use CSV, XLSX, XLS, JSON, or SQLite files."); return; }
    if (file.size > 4 * 1024 * 1024) { setError("Files must be 4 MB or smaller on Vercel."); return; }
    setUploading(true);
    try {
      const form = new FormData(); form.append("file", file);
      const dataset = await request("/datasets/upload", { method: "POST", body: form });
      setDatasets((current) => [dataset, ...current.filter((item) => item.id !== dataset.id)]);
      setActive(dataset); setConversationId(""); setResult(null); setView("workspace");
      setStats((current) => ({ ...current, datasets: (current.datasets ?? 0) + 1, records: (current.records ?? 0) + (dataset.total_rows ?? 0) }));
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "Dataset processing failed."); }
    finally { setUploading(false); }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void upload(file); }

  async function activate(dataset: Dataset) {
    try { const selected = await request(`/datasets/${dataset.id}/activate`, { method: "POST" }); setActive(selected); setConversationId(""); setResult(null); setView("workspace"); }
    catch (activationError) { setError(activationError instanceof Error ? activationError.message : "Could not activate dataset."); }
  }

  async function runAnalysis(event: FormEvent) {
    event.preventDefault();
    if (!active) { setError("Select a dataset before running analysis."); return; }
    setBusy(true); setError("");
    try {
      let id = conversationId;
      if (!id) { const conversation = await request(`/conversations?connection_id=${active.connection_id}`, { method: "POST" }); id = conversation.id; setConversationId(id); }
      const response = await request(`/conversations/${id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: prompt }) });
      setResult(response); setStats((current) => ({ ...current, queries: (current.queries ?? 0) + (response.status === "completed" ? 1 : 0) }));
    } catch (runError) { setError(runError instanceof Error ? runError.message : "Analysis failed."); }
    finally { setBusy(false); }
  }

  async function answer(questionId: string, value: string) {
    if (!conversationId) return;
    setBusy(true); setError("");
    try { setResult(await request(`/conversations/${conversationId}/clarifications`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ [questionId]: value }) })); }
    catch (answerError) { setError(answerError instanceof Error ? answerError.message : "Could not apply clarification."); }
    finally { setBusy(false); }
  }

  async function showHistory() { setView("history"); try { setHistory(await request("/queries/history")); } catch (historyError) { setError(historyError instanceof Error ? historyError.message : "History unavailable."); } }

  return <div className={`app-shell ${collapsed ? "collapsed" : ""}`}>
    <aside className="sidebar">
      <div className="logo-row"><div className="logo-mark">Q</div>{!collapsed && <><strong>QueryMind</strong><span className="beta">BETA</span></>}</div>
      <button className="new-workspace" onClick={() => { setView("workspace"); setResult(null); setPrompt(""); }}><span>＋</span>{!collapsed && "New workspace"}</button>
      <nav className="nav-list">
        <NavItem icon="◈" label="Dashboard" active={view === "dashboard"} collapsed={collapsed} onClick={() => setView("dashboard")} />
        <NavItem icon="✦" label="AI Workspace" active={view === "workspace"} collapsed={collapsed} onClick={() => setView("workspace")} />
        <NavItem icon="▣" label="Data Sources" active={view === "sources"} collapsed={collapsed} onClick={() => setView("sources")} />
        <NavItem icon="⌘" label="Database Explorer" active={view === "explorer"} collapsed={collapsed} onClick={() => setView("explorer")} />
        <NavItem icon="◷" label="Query History" active={view === "history"} collapsed={collapsed} onClick={() => void showHistory()} />
        <NavItem icon="▥" label="Analytics" active={view === "analytics"} collapsed={collapsed} onClick={() => setView("analytics")} />
      </nav>
      {!collapsed && <div className="sidebar-section"><div className="section-label">DATA SOURCES <span>{datasets.length}</span></div>{datasets.slice(0, 4).map((dataset) => <button className={`mini-dataset ${active?.id === dataset.id ? "active" : ""}`} key={dataset.id} onClick={() => void activate(dataset)}><i />{dataset.name}<small>{dataset.total_rows ?? dataset.tables.reduce((sum, table) => sum + table.row_count, 0)} rows</small></button>)}{!datasets.length && <span className="muted">No datasets yet</span>}</div>}
      <div className="sidebar-bottom"><NavItem icon="⚙" label="Settings" active={view === "settings"} collapsed={collapsed} onClick={() => setView("settings")} /><button className="profile"><span className="avatar">U</span>{!collapsed && <span><b>Workspace owner</b><small>Personal workspace</small></span>}</button><button className="theme-toggle" onClick={() => setDark((value) => !value)}>{dark ? "☼" : "☾"}{!collapsed && (dark ? "Light mode" : "Dark mode")}</button></div>
      <button className="collapse" onClick={() => setCollapsed((value) => !value)}>{collapsed ? "»" : "«"}</button>
    </aside>
    <main className="content">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{view === "workspace" ? "AI Workspace" : view[0].toUpperCase() + view.slice(1)}</strong></div><div className="top-actions"><span className="connection-dot"><i /> Backend connected</span><select value={active?.id ?? ""} onChange={(event) => { const selected = datasets.find((item) => item.id === event.target.value); if (selected) void activate(selected); }}><option value="">Select dataset</option>{datasets.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}</option>)}</select><button className="icon-btn">⌁</button></div></header>
      {error && <div className="alert error"><b>Something needs attention</b><span>{error}</span><button onClick={() => setError("")}>×</button></div>}
      {view === "dashboard" && <Dashboard stats={stats} datasets={datasets} setView={setView} />}
      {view === "workspace" && <Workspace active={active} prompt={prompt} setPrompt={setPrompt} result={result} busy={busy} runAnalysis={runAnalysis} answer={answer} setView={setView} fileInput={fileInput} />}
      {view === "sources" && <Sources datasets={datasets} active={active} activate={activate} uploading={uploading} fileInput={fileInput} onFile={onFile} onDrop={onDrop} />}
      {view === "explorer" && <Explorer datasets={datasets} active={active} />}
      {view === "history" && <History rows={history} />}
      {view === "analytics" && <Analytics stats={stats} datasets={datasets} />}
      {view === "settings" && <Settings dark={dark} setDark={setDark} />}
    </main>
  </div>;
}

function NavItem({ icon, label, active, collapsed, onClick }: { icon: string; label: string; active: boolean; collapsed: boolean; onClick: () => void }) { return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}><span>{icon}</span>{!collapsed && label}</button>; }

function Workspace({ active, prompt, setPrompt, result, busy, runAnalysis, answer, setView, fileInput }: { active: Dataset | null; prompt: string; setPrompt: (value: string) => void; result: Result | null; busy: boolean; runAnalysis: (event: FormEvent) => void; answer: (id: string, value: string) => void; setView: (view: View) => void; fileInput: React.RefObject<HTMLInputElement | null> }) {
  return <div className="workspace-view"><div className="page-heading"><div><span className="eyebrow">INTELLIGENCE WORKSPACE</span><h1>Ask your data.</h1><p>Turn questions into trusted analysis with schema-aware SQL.</p></div><button className="secondary-btn" onClick={() => setView("sources")}>＋ Add data source</button></div>
    {!active ? <div className="empty-state panel"><div className="empty-icon">◈</div><h2>Bring your data to life</h2><p>Upload a CSV, Excel, JSON, or SQLite file to start asking questions.</p><button className="primary-btn" onClick={() => { setView("sources"); fileInput.current?.click(); }}>Upload your first dataset</button></div> : <><div className="dataset-context panel"><div className="dataset-symbol">▣</div><div><span className="eyebrow">QUERYING ACTIVE DATASET</span><strong>{active.name}</strong><small>{active.tables.length} table{active.tables.length === 1 ? "" : "s"} · {active.total_rows ?? active.tables.reduce((sum, table) => sum + table.row_count, 0)} records · {active.filename.split(".").pop()?.toUpperCase()}</small></div><span className="live-pill"><i /> Ready</span></div><div className="query-layout"><div className="query-card panel"><div className="card-title"><span><span className="sparkle">✦</span> Natural language query</span><kbd>⌘ ↵</kbd></div><form onSubmit={runAnalysis}><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask a question about your data..." /><div className="prompt-footer"><span>Gemini · Schema-aware analysis</span><button className="primary-btn" disabled={busy || !prompt.trim()}>{busy ? "Analyzing..." : "Run analysis  →"}</button></div></form><div className="suggestions"><span>Try asking</span><button onClick={() => setPrompt("Show the top five customers by revenue")}>Top customers by revenue</button><button onClick={() => setPrompt("Show monthly revenue")}>Monthly revenue</button><button onClick={() => setPrompt("Which city has the most bookings?")}>Bookings by city</button></div></div><SchemaCard dataset={active} /></div></>}
    {result && <ResultPanel result={result} answer={answer} />}
  </div>;
}

function SchemaCard({ dataset }: { dataset: Dataset }) { return <div className="schema-card panel"><div className="card-title"><span>Schema context</span><span className="muted">{dataset.tables.length} tables</span></div>{dataset.tables.map((table) => <div className="schema-table" key={table.table}><b>▤ {table.table}</b><span>{table.row_count.toLocaleString()} rows</span>{table.columns.slice(0, 5).map((column) => <div className="schema-column" key={column.name}><span>◇ {column.name}</span><small>{column.type ?? "text"}</small></div>)}</div>)}</div>; }

function ResultPanel({ result, answer }: { result: Result; answer: (id: string, value: string) => void }) { const columns = result.columns ?? (result.rows?.[0] ? Object.keys(result.rows[0]) : []); const [search, setSearch] = useState(""); const [page, setPage] = useState(0); const filtered = useMemo(() => (result.rows ?? []).filter((row) => JSON.stringify(row).toLowerCase().includes(search.toLowerCase())), [result.rows, search]); const visible = filtered.slice(page * 10, page * 10 + 10); function exportCsv() { const csv = [columns.join(","), ...filtered.map((row) => columns.map((column) => JSON.stringify(row[column] ?? "")).join(","))].join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = "querymind-results.csv"; link.click(); } return <div className="result-panel panel"><div className="result-title"><div><span className="eyebrow">ANALYSIS RESULT</span><h2>{result.message}</h2></div>{result.rows && <button className="secondary-btn" onClick={exportCsv}>↓ Export CSV</button>}</div>{result.questions?.map((question) => <div className="clarification" key={question.id}><b>{question.question}</b><div>{question.options.map((option) => <button key={option} onClick={() => answer(question.id, option)}>{option}</button>)}</div></div>)}{result.sql && <><div className="sql-heading"><span>Generated SQL <em>Validated</em></span><button onClick={() => void navigator.clipboard.writeText(result.sql ?? "")}>Copy</button></div><pre className="sql-block">{result.sql}</pre><div className="result-meta"><span>✓ {result.dataset_name}</span><span>✓ {result.validation_status}</span><span>{filtered.length} rows returned</span></div><p className="explanation">{result.explanation}</p>{columns.length > 0 && <><div className="table-toolbar"><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search results..." /><span>{filtered.length} result{filtered.length === 1 ? "" : "s"}</span></div><div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{visible.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{String(row[column] ?? "—")}</td>)}</tr>)}</tbody></table></div><div className="pagination"><span>Showing {visible.length ? page * 10 + 1 : 0}–{Math.min((page + 1) * 10, filtered.length)} of {filtered.length}</span><div><button disabled={page === 0} onClick={() => setPage((value) => value - 1)}>←</button><button disabled={(page + 1) * 10 >= filtered.length} onClick={() => setPage((value) => value + 1)}>→</button></div></div></>}</>}</div>; }

function Dashboard({ stats, datasets, setView }: { stats: Record<string, number>; datasets: Dataset[]; setView: (view: View) => void }) { return <div className="page-view"><div className="page-heading"><div><span className="eyebrow">OVERVIEW</span><h1>Good morning.</h1><p>Here is what is happening across your workspace.</p></div><button className="primary-btn" onClick={() => setView("workspace")}>Open workspace →</button></div><div className="metric-grid"><Metric label="Datasets" value={stats.datasets ?? datasets.length} icon="▣" /><Metric label="Records indexed" value={stats.records ?? datasets.reduce((sum, dataset) => sum + (dataset.total_rows ?? 0), 0)} icon="◫" /><Metric label="Queries executed" value={stats.queries ?? 0} icon="✦" /><Metric label="Success rate" value={stats.queries ? `${Math.round(((stats.successfulQueries ?? 0) / stats.queries) * 100)}%` : "—"} icon="↗" /></div><div className="dashboard-grid"><div className="panel activity-card"><div className="card-title"><span>Query activity</span><span className="muted">Live database metrics</span></div><div className="empty-chart"><div className="chart-line" /><span>{stats.queries ? `${stats.queries} queries recorded` : "Run a query to see activity"}</span></div></div><div className="panel activity-card"><div className="card-title"><span>Recent datasets</span><button className="text-btn" onClick={() => setView("sources")}>View all</button></div>{datasets.slice(0, 4).map((dataset) => <div className="recent-row" key={dataset.id}><span className="file-icon">▤</span><span><b>{dataset.name}</b><small>{dataset.tables.length} tables · {dataset.total_rows ?? 0} records</small></span><i className="ready-dot" /></div>)}{!datasets.length && <div className="empty-mini">Upload a dataset to populate your workspace.</div>}</div></div></div>; }

function Metric({ label, value, icon }: { label: string; value: number | string; icon: string }) { return <div className="metric-card panel"><span className="metric-icon">{icon}</span><small>{label}</small><strong>{typeof value === "number" ? value.toLocaleString() : value}</strong></div>; }
function Sources({ datasets, active, activate, uploading, fileInput, onFile, onDrop }: { datasets: Dataset[]; active: Dataset | null; activate: (dataset: Dataset) => Promise<void>; uploading: boolean; fileInput: React.RefObject<HTMLInputElement | null>; onFile: (event: ChangeEvent<HTMLInputElement>) => void; onDrop: (event: DragEvent<HTMLDivElement>) => void }) { return <div className="page-view"><div className="page-heading"><div><span className="eyebrow">DATA MANAGEMENT</span><h1>Data sources</h1><p>Connect the datasets that power your analysis.</p></div></div><div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onClick={() => fileInput.current?.click()}><input ref={fileInput} hidden type="file" accept=".csv,.xlsx,.xls,.json,.db,.sqlite,.sqlite3" onChange={onFile} /><div className="upload-icon">↑</div><b>{uploading ? "Processing dataset..." : "Drop a file here, or browse"}</b><span>CSV, Excel, JSON, or SQLite · Up to 4 MB</span></div><div className="source-grid">{datasets.map((dataset) => <button className={`source-card panel ${active?.id === dataset.id ? "selected" : ""}`} key={dataset.id} onClick={() => void activate(dataset)}><div className="source-card-top"><span className="file-icon">▤</span><span className="live-pill"><i /> {active?.id === dataset.id ? "Active" : "Ready"}</span></div><b>{dataset.name}</b><small>{dataset.filename} · {(dataset.size_bytes / 1024).toFixed(1)} KB</small><div className="source-stats"><span>{dataset.tables.length} tables</span><span>{dataset.total_rows ?? 0} records</span></div></button>)}</div></div>; }
function Explorer({ datasets, active }: { datasets: Dataset[]; active: Dataset | null }) { return <div className="page-view"><div className="page-heading"><div><span className="eyebrow">SCHEMA INTELLIGENCE</span><h1>Database explorer</h1><p>Inspect the real tables and columns available to QueryMind.</p></div></div>{active ? <div className="explorer-grid">{active.tables.map((table) => <div className="panel explorer-table" key={table.table}><div className="card-title"><b>▤ {table.table}</b><span>{table.row_count} rows</span></div>{table.columns.map((column) => <div className="column-row" key={column.name}><span>{column.name}</span><code>{column.type ?? "text"}</code></div>)}</div>)}</div> : <div className="empty-state panel"><h2>No active dataset</h2><p>Upload or select a data source first.</p></div>}</div>; }
function History({ rows }: { rows: Record<string, unknown>[] }) { return <div className="page-view"><div className="page-heading"><div><span className="eyebrow">WORKSPACE ACTIVITY</span><h1>Query history</h1><p>Every query run in this workspace, with its generated SQL.</p></div></div><div className="panel history-table"><table><thead><tr><th>Question</th><th>Status</th><th>SQL</th><th>Created</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{String(row.request)}</td><td><span className="status-tag">{String(row.status)}</span></td><td><code>{String(row.generated_sql)}</code></td><td>{new Date(String(row.created_at)).toLocaleString()}</td></tr>)}</tbody></table>{!rows.length && <div className="empty-mini">No queries have been executed yet.</div>}</div></div>; }
function Analytics({ stats, datasets }: { stats: Record<string, number>; datasets: Dataset[] }) { return <div className="page-view"><div className="page-heading"><div><span className="eyebrow">INSIGHTS</span><h1>Analytics</h1><p>Real usage and data-quality signals from your workspace.</p></div></div><div className="metric-grid"><Metric label="Successful queries" value={stats.successfulQueries ?? 0} icon="✓" /><Metric label="Failed queries" value={stats.failedQueries ?? 0} icon="!" /><Metric label="Tables indexed" value={datasets.reduce((sum, dataset) => sum + dataset.tables.length, 0)} icon="▤" /><Metric label="Avg. dataset size" value={datasets.length ? `${Math.round(datasets.reduce((sum, dataset) => sum + dataset.size_bytes, 0) / datasets.length / 1024)} KB` : "—"} icon="◌" /></div></div>; }
function Settings({ dark, setDark }: { dark: boolean; setDark: (value: boolean) => void }) { return <div className="page-view"><div className="page-heading"><div><span className="eyebrow">PREFERENCES</span><h1>Settings</h1><p>Configure the QueryMind workspace experience.</p></div></div><div className="settings-list panel"><div><b>Appearance</b><span>Choose a comfortable theme for your workspace.</span></div><button className="secondary-btn" onClick={() => setDark(!dark)}>{dark ? "Use light theme" : "Use dark theme"}</button><div><b>AI provider</b><span>Gemini runs server-side. Your API key is never sent to the browser.</span></div><span className="connection-dot"><i /> Gemini integration configured on the server</span><div><b>Data privacy</b><span>Uploaded tables and query history are persisted in the configured PostgreSQL database.</span></div></div></div>; }

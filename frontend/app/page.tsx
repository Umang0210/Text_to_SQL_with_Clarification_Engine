"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
type Dataset = { id: string; connection_id: string; name: string; filename: string; size_bytes: number; tables: { table: string; columns: { name: string }[]; row_count: number }[]; preview: Record<string, unknown>[]; duplicate_rows: number };
type Question = { id: string; question: string; options: string[] };
type Result = { status: string; message?: string; questions?: Question[]; sql?: string; columns?: string[]; rows?: Record<string, unknown>[]; explanation?: string; dataset_name?: string; validation_status?: string };

async function request(path: string, init?: RequestInit) {
  if (!API) throw new Error("Backend API is not configured. Set NEXT_PUBLIC_API_URL in the Vercel project.");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Backend request timed out: ${API}${path}`);
    }
    throw new Error(`Backend unavailable at ${API}. Check the API URL, backend health, and CORS configuration.`);
  } finally {
    window.clearTimeout(timeout);
  }
  const body = await response.json().catch(() => ({ detail: "The server returned an invalid response." }));
  if (!response.ok) {
    const detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    throw new Error(`Backend returned ${response.status}: ${detail}`);
  }
  return body;
}

export default function Home() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [active, setActive] = useState<Dataset | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    request("/datasets").then((items: Dataset[]) => { setDatasets(items); setActive(items[0] ?? null); }).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Could not connect to the backend.");
    });
  }, []);

  async function upload(file: File) {
    setError("");
    const allowed = [".csv", ".xlsx", ".xls", ".json", ".db", ".sqlite", ".sqlite3"];
    if (!allowed.some((extension) => file.name.toLowerCase().endsWith(extension))) { setError("Choose a CSV, Excel, JSON, or SQLite file."); return; }
    if (file.size > 50 * 1024 * 1024) { setError("Files must be 50 MB or smaller."); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const dataset = await request("/datasets/upload", { method: "POST", body: form });
      setDatasets((current) => [dataset, ...current.filter((item) => item.id !== dataset.id)]);
      setActive(dataset);
      setConversationId("");
      setResult(null);
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "Upload failed."); }
    finally { setUploading(false); }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void upload(file);
    event.target.value = "";
  }

  async function activate(dataset: Dataset) {
    try { const selected = await request(`/datasets/${dataset.id}/activate`, { method: "POST" }); setActive(selected); setConversationId(""); setResult(null); }
    catch (activationError) { setError(activationError instanceof Error ? activationError.message : "Could not activate dataset."); }
  }

  async function runAnalysis(event: FormEvent) {
    event.preventDefault();
    if (!active) { setError("Upload or select a dataset before running analysis."); return; }
    setBusy(true); setError("");
    try {
      let id = conversationId;
      if (!id) { const conversation = await request(`/conversations?connection_id=${active.connection_id}`, { method: "POST" }); id = conversation.id; setConversationId(id); }
      setResult(await request(`/conversations/${id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: prompt }) }));
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

  return <main>
    <aside>
      <div className="brand">QueryMind</div><p>Conversational database intelligence</p>
      <button onClick={() => { setConversationId(""); setResult(null); setPrompt(""); }}>+ New Workspace</button>
      <nav><b>AI Workspace</b><span>Data Sources</span><span>Database Explorer</span><span>Query History</span><span>Analytics Dashboard</span><span>Settings</span></nav>
      <div className="sources"><div className="source-heading"><b>Data Sources</b><span>{datasets.length}</span></div>
        <button className="upload" onClick={() => fileInput.current?.click()}>{uploading ? "Uploading..." : "Upload dataset"}</button>
        <input ref={fileInput} hidden type="file" accept=".csv,.xlsx,.xls,.json,.db,.sqlite,.sqlite3" onChange={onFile} />
        {datasets.map((dataset) => <button className={`dataset ${active?.id === dataset.id ? "selected" : ""}`} key={dataset.id} onClick={() => void activate(dataset)}><strong>{dataset.name}</strong><small>{(dataset.size_bytes / 1024).toFixed(1)} KB · {dataset.tables.length} table(s)</small></button>)}
      </div>
    </aside>
    <section>
      <header><div><small>AI WORKSPACE</small><h1>Ask your data</h1></div><div className="status">{active ? `● ${active.name}` : "○ No dataset"}</div></header>
      {!active && <div className="empty panel"><h2>Start with a data source</h2><p>Upload a CSV, Excel, JSON, or SQLite dataset from the sidebar, then ask a question in natural language.</p><button onClick={() => fileInput.current?.click()}>Choose dataset</button></div>}
      {active && <><div className="active-dataset panel"><div><small>ACTIVE DATASET</small><strong>{active.name}</strong><span>{active.tables.map((table) => `${table.table} (${table.row_count} rows)`).join(" · ")}</span></div><button onClick={() => fileInput.current?.click()}>Add another</button></div>
        <div className="panel"><div className="intro">Querying <b>{active.name}</b>. Ask for counts, rankings, trends, averages, or filtered records.</div><form onSubmit={runAnalysis}><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Show the top five customers by number of bookings..." /><button disabled={busy || !prompt.trim()}>{busy ? "Running..." : "Run Analysis"}</button></form></div></>}
      {error && <div className="error">{error}</div>}
      {result && <ResultPanel result={result} answer={answer} />}
    </section>
  </main>;
}

function ResultPanel({ result, answer }: { result: Result; answer: (id: string, value: string) => void }) {
  const columns = result.columns ?? (result.rows?.[0] ? Object.keys(result.rows[0]) : []);
  return <div className="panel result"><h2>{result.message}</h2>
    {result.questions?.map((question) => <div className="question" key={question.id}><strong>{question.question}</strong><div>{question.options.map((option) => <button key={option} onClick={() => answer(question.id, option)}>{option}</button>)}</div></div>)}
    {result.sql && <><div className="result-heading"><h3>Generated SQL</h3><button onClick={() => void navigator.clipboard.writeText(result.sql ?? "")}>Copy SQL</button></div><pre>{result.sql}</pre><div className="execution"><span>{result.dataset_name}</span><span>Validation: {result.validation_status}</span><span>{result.rows?.length ?? 0} rows</span></div><p>{result.explanation}</p><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{result.rows?.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}</tr>)}</tbody></table></>}
  </div>;
}

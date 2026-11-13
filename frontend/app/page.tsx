"use client";

import { FormEvent, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Result = { status: string; message: string; questions?: { id: string; question: string; options: string[] }[]; sql?: string; rows?: Record<string, unknown>[]; explanation?: string; conversation_id?: string };

export default function Home() {
  const [connectionId, setConnectionId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    const connection = await fetch(`${API}/connections`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Demo SQLite", url: "sqlite:///querymind.db" }) }).then((response) => response.json());
    setConnectionId(connection.id);
    const conversation = await fetch(`${API}/conversations?connection_id=${connection.id}`, { method: "POST" }).then((response) => response.json());
    setConversationId(conversation.id);
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!conversationId) await start();
    setBusy(true);
    const id = conversationId || (await fetch(`${API}/connections`).then((response) => response.json()))[0]?.id;
    if (!id) { setBusy(false); return; }
    const conversations = conversationId ? conversationId : await fetch(`${API}/conversations?connection_id=${id}`, { method: "POST" }).then((response) => response.json()).then((value) => value.id);
    setConversationId(conversations);
    const response = await fetch(`${API}/conversations/${conversations}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: prompt }) });
    setResult(await response.json());
    setBusy(false);
  }

  async function answer(id: string, value: string) {
    const response = await fetch(`${API}/conversations/${conversationId}/clarifications`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ [id]: value }) });
    setResult(await response.json());
  }

  return <main><aside><div className="brand">QueryMind</div><p>Conversational database intelligence</p><button onClick={start}>New workspace</button><span>{connectionId ? "Demo connection ready" : "No connection selected"}</span></aside><section><header><div><small>AI WORKSPACE</small><h1>Ask your database</h1></div><div className="status">● Local engine</div></header><div className="panel"><div className="intro">Describe the analysis you need. QueryMind will ask only for information that materially changes the result.</div><form onSubmit={ask}><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Show me the top customers..." /><button disabled={busy || !prompt}>{busy ? "Working..." : "Run analysis"}</button></form></div>{result && <div className="panel"><h2>{result.message}</h2>{result.questions?.map((question) => <div className="question" key={question.id}><strong>{question.question}</strong><div>{question.options.map((option) => <button key={option} onClick={() => answer(question.id, option)}>{option}</button>)}</div></div>)}{result.sql && <><h3>Generated SQL</h3><pre>{result.sql}</pre><p>{result.explanation}</p><table><tbody>{result.rows?.map((row, index) => <tr key={index}>{Object.values(row).map((value, cell) => <td key={cell}>{String(value)}</td>)}</tr>)}</tbody></table></>}</div>}</section></main>;
}

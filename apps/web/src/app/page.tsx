"use client";
import { useEffect, useState } from "react";
import { fetchRuns, startRun } from "@/lib/api";
import Link from "next/link";

interface Run {
  id: string;
  strategy: string;
  model: string;
  status: string;
  avgF1: number | null;
  totalCostUsd: number | null;
  completedCases: number;
  totalCases: number;
  totalCacheReadTokens: number;
  promptHash: string;
  createdAt: string;
}

export default function Home() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [strategy, setStrategy] = useState("zero_shot");
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");

  async function load() {
    const data = await fetchRuns();
    setRuns(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleStart() {
    setStarting(true);
    await startRun(strategy, "claude-haiku-4-5-20251001");
    await load();
    setStarting(false);
  }

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">🏥 HEALOSBench</h1>
      <p className="text-gray-500 mb-6">Clinical extraction eval harness</p>

      {/* Start new run */}
      <div className="border rounded p-4 mb-8 flex gap-4 items-end">
        <div>
          <label className="block text-sm font-medium mb-1">Strategy</label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            className="border rounded px-3 py-2"
          >
            <option value="zero_shot">Zero Shot</option>
            <option value="few_shot">Few Shot</option>
            <option value="cot">Chain of Thought</option>
          </select>
        </div>
        <button
          onClick={handleStart}
          disabled={starting}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {starting ? "Starting..." : "Start Run"}
        </button>
        <button
          onClick={load}
          className="border px-4 py-2 rounded hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {/* Compare picker */}
      {runs.length >= 2 && (
        <div className="border rounded p-4 mb-8 flex gap-4 items-end">
          <div>
            <label className="block text-sm font-medium mb-1">
              Compare Run A
            </label>
            <select
              value={compareA}
              onChange={(e) => setCompareA(e.target.value)}
              className="border rounded px-3 py-2"
            >
              <option value="">Select...</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.strategy} — {r.id.slice(0, 8)} — F1:{" "}
                  {r.avgF1 ? (r.avgF1 * 100).toFixed(1) + "%" : "pending"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Compare Run B
            </label>
            <select
              value={compareB}
              onChange={(e) => setCompareB(e.target.value)}
              className="border rounded px-3 py-2"
            >
              <option value="">Select...</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.strategy} — {r.id.slice(0, 8)} — F1:{" "}
                  {r.avgF1 ? (r.avgF1 * 100).toFixed(1) + "%" : "pending"}
                </option>
              ))}
            </select>
          </div>
          {compareA && compareB && compareA !== compareB && (
            <Link
              href={`/compare?a=${compareA}&b=${compareB}`}
              className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
            >
              Compare →
            </Link>
          )}
        </div>
      )}

      {/* Runs table */}
      {loading ? (
        <p>Loading...</p>
      ) : (
        <table className="w-full border-collapse border text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="border px-3 py-2 text-left">Run ID</th>
              <th className="border px-3 py-2 text-left">Strategy</th>
              <th className="border px-3 py-2 text-left">Status</th>
              <th className="border px-3 py-2 text-right">Overall F1</th>
              <th className="border px-3 py-2 text-right">Cases</th>
              <th className="border px-3 py-2 text-right">Cost</th>
              <th className="border px-3 py-2 text-right">Cache Reads</th>
              <th className="border px-3 py-2 text-left">Prompt Hash</th>
              <th className="border px-3 py-2 text-left">Detail</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="border px-3 py-2 font-mono text-xs">
                  {r.id.slice(0, 8)}
                </td>
                <td className="border px-3 py-2">{r.strategy}</td>
                <td className="border px-3 py-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      r.status === "completed"
                        ? "bg-green-100 text-green-800"
                        : r.status === "running"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-red-100 text-red-800"
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="border px-3 py-2 text-right font-mono">
                  {r.avgF1 ? (r.avgF1 * 100).toFixed(1) + "%" : "—"}
                </td>
                <td className="border px-3 py-2 text-right">
                  {r.completedCases}/{r.totalCases}
                </td>
                <td className="border px-3 py-2 text-right font-mono">
                  ${r.totalCostUsd?.toFixed(4) ?? "—"}
                </td>
                <td className="border px-3 py-2 text-right">
                  {r.totalCacheReadTokens.toLocaleString()}
                </td>
                <td className="border px-3 py-2 font-mono text-xs">
                  {r.promptHash.slice(0, 8)}
                </td>
                <td className="border px-3 py-2">
                  <Link
                    href={`/runs/${r.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

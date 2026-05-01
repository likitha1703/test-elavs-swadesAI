"use client";
import { useEffect, useState } from "react";
import { fetchRun } from "@/lib/api";
import { use } from "react";

const FIELDS = [
  "chief_complaint",
  "vitals",
  "medications",
  "diagnoses",
  "plan",
  "follow_up",
];

function scoreColor(score: number | null) {
  if (score === null) return "text-gray-400";
  if (score >= 0.75) return "text-emerald-600 font-semibold";
  if (score >= 0.5) return "text-amber-600";
  return "text-red-500";
}

function scoreBg(score: number | null) {
  if (score === null) return "";
  if (score >= 0.75) return "bg-emerald-50";
  if (score >= 0.5) return "bg-amber-50";
  return "bg-red-50";
}

function ScoreBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.75 ? "#10b981" : value >= 0.5 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className={`text-xs font-mono w-8 text-right ${scoreColor(value)}`}>
        {pct}%
      </span>
    </div>
  );
}

function JsonBlock({
  label,
  data,
  accent,
}: {
  label: string;
  data: unknown;
  accent: string;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div
        className={`text-[10px] font-bold uppercase tracking-widest mb-1.5 ${accent}`}
      >
        {label}
      </div>
      <pre
        className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono overflow-auto"
        style={{ maxHeight: 320 }}
      >
        {data ? JSON.stringify(data, null, 2) : "—"}
      </pre>
    </div>
  );
}

type CaseRow = Record<string, unknown>;

export default function RunDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<{
    run: Record<string, unknown>;
    cases: CaseRow[];
  } | null>(null);
  const [selected, setSelected] = useState<CaseRow | null>(null);
  const [activeTab, setActiveTab] = useState<"diff" | "trace">("diff");

  useEffect(() => {
    fetchRun(id).then(setData);
  }, [id]);

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">
        Loading…
      </div>
    );
  }

  const { run, cases } = data;
  const avgF1 = run.avgF1 ? ((run.avgF1 as number) * 100).toFixed(1) : null;

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <a
          href="/"
          className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 mb-2"
        >
          ← Back to runs
        </a>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 font-mono">
              {(run.id as string).slice(0, 8)}
              <span className="text-gray-400 font-sans font-normal text-base ml-2">
                / {run.strategy as string}
              </span>
            </h1>
            <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
              <span>
                Prompt{" "}
                <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">
                  {run.promptHash as string}
                </code>
              </span>
              <span>Cost ${(run.totalCostUsd as number)?.toFixed(4)}</span>
              <span>
                Cache reads{" "}
                {(run.totalCacheReadTokens as number)?.toLocaleString() ?? 0}
              </span>
            </div>
          </div>
          {avgF1 && (
            <div className="text-right">
              <div className="text-3xl font-bold font-mono text-gray-900">
                {avgF1}%
              </div>
              <div className="text-xs text-gray-400 mt-0.5">Overall F1</div>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div
        className="relative flex overflow-hidden"
        style={{ height: "calc(100vh - 105px)" }}
      >
        {/* Table */}
        <div className="flex-1 overflow-auto p-6">
          <table className="w-full text-sm border-collapse bg-white rounded-xl shadow-sm overflow-hidden">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Case
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  F1
                </th>
                {FIELDS.map((f) => (
                  <th
                    key={f}
                    className="px-3 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap"
                  >
                    {f.replace("_", " ")}
                  </th>
                ))}
                <th className="px-3 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Halluc.
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Tries
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cases.map((c) => {
                const scores = c.fieldScores as Record<string, number> | null;
                const isSelected = selected?.id === c.id;
                const f1 = c.overallF1 as number | null;
                return (
                  <tr
                    key={c.id as string}
                    onClick={() => {
                      setSelected(isSelected ? null : c);
                      setActiveTab("diff");
                    }}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-blue-50 ring-1 ring-inset ring-blue-200"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-700 font-medium">
                      {c.caseId as string}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          c.status === "completed"
                            ? "bg-emerald-100 text-emerald-700"
                            : c.status === "schema_invalid"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-red-100 text-red-700"
                        }`}
                      >
                        {c.status as string}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-mono text-sm ${scoreBg(f1)} ${scoreColor(f1)}`}
                    >
                      {f1 ? Math.round(f1 * 100) + "%" : "—"}
                    </td>
                    {FIELDS.map((f) => {
                      const v = scores ? scores[f] : null;
                      return (
                        <td
                          key={f}
                          className={`px-3 py-2.5 text-right font-mono text-xs ${scoreColor(v)}`}
                        >
                          {v !== null && v !== undefined
                            ? Math.round(v * 100) + "%"
                            : "—"}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-right text-xs text-gray-500">
                      {(c.hallucinations as string[])?.length > 0 ? (
                        <span className="text-amber-600 font-medium">
                          {(c.hallucinations as string[]).length}
                        </span>
                      ) : (
                        <span className="text-gray-300">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-gray-400">
                      {c.attempts as number}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Detail Drawer — fixed overlay from right */}
        {selected && (
          <div className="fixed top-0 right-0 h-full w-[680px] max-w-[90vw] border-l border-gray-200 bg-white flex flex-col overflow-hidden shadow-2xl z-50">
            {/* Drawer header */}
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <div>
                <span className="font-mono font-semibold text-gray-900">
                  {selected.caseId as string}
                </span>
                <span className="ml-3 text-xs text-gray-400">
                  {selected.attempts as number} attempt
                  {(selected.attempts as number) !== 1 ? "s" : ""}
                </span>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none p-1"
              >
                ✕
              </button>
            </div>

            {/* Score bars */}
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex-shrink-0">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {FIELDS.map((f) => {
                  const scores = selected.fieldScores as Record<
                    string,
                    number
                  > | null;
                  const v = scores?.[f] ?? null;
                  return (
                    <div key={f}>
                      <div className="text-[10px] text-gray-400 mb-0.5">
                        {f.replace("_", " ")}
                      </div>
                      {v !== null ? (
                        <ScoreBar value={v} />
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 flex-shrink-0">
              {(["diff", "trace"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-5 py-2.5 text-xs font-medium transition-colors ${
                    activeTab === tab
                      ? "border-b-2 border-blue-500 text-blue-600"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {tab === "diff" ? "Gold vs Predicted" : "LLM Trace"}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-auto p-5">
              {activeTab === "diff" && (
                <div className="space-y-4">
                  {/* Hallucinations */}
                  {(selected.hallucinations as string[])?.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-amber-600 mb-2">
                        ⚠ Hallucinated fields
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(selected.hallucinations as string[]).map((h, i) => (
                          <span
                            key={i}
                            className="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full"
                          >
                            {h}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Side-by-side JSON */}
                  <div className="flex gap-3">
                    <JsonBlock
                      label="Gold"
                      data={selected.gold}
                      accent="text-emerald-600"
                    />
                    <JsonBlock
                      label="Predicted"
                      data={selected.prediction}
                      accent="text-blue-600"
                    />
                  </div>
                </div>
              )}

              {activeTab === "trace" && (
                <div className="space-y-3">
                  {(selected.llmTrace as Record<string, unknown>[])?.map(
                    (t, i) => {
                      const errors = t.validationErrors as string[];
                      return (
                        <div
                          key={i}
                          className="border border-gray-200 rounded-lg overflow-hidden"
                        >
                          <div
                            className={`px-4 py-2.5 flex items-center justify-between text-xs font-medium ${
                              errors?.length > 0
                                ? "bg-red-50 text-red-700 border-b border-red-100"
                                : "bg-gray-50 text-gray-600 border-b border-gray-100"
                            }`}
                          >
                            <span>Attempt {t.attempt as number}</span>
                            <span className="text-gray-400 font-normal">
                              cache {t.cacheReadTokens as number} tokens
                            </span>
                          </div>
                          {errors?.length > 0 && (
                            <div className="px-4 py-2 text-xs text-red-600 bg-red-50 font-mono">
                              {errors.join(" · ")}
                            </div>
                          )}
                          {t.rawResponse && (
                            <pre
                              className="px-4 py-3 text-xs font-mono text-gray-600 overflow-auto bg-white"
                              style={{ maxHeight: 200 }}
                            >
                              {JSON.stringify(t.rawResponse, null, 2)}
                            </pre>
                          )}
                        </div>
                      );
                    },
                  )}
                  {!(selected.llmTrace as unknown[])?.length && (
                    <div className="text-xs text-gray-400 text-center py-8">
                      No trace data
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

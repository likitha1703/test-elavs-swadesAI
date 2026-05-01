"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { fetchCompare } from "@/lib/api";

const FIELDS = [
  "chief_complaint",
  "vitals",
  "medications",
  "diagnoses",
  "plan",
  "follow_up",
];

function CompareContent() {
  const params = useSearchParams();
  const a = params.get("a")!;
  const b = params.get("b")!;
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetchCompare(a, b).then(setData);
  }, [a, b]);

  if (!data) return <div className="p-8">Loading comparison...</div>;

  const { runA, runB, casesA, casesB } = data as {
    runA: Record<string, unknown>;
    runB: Record<string, unknown>;
    casesA: Record<string, unknown>[];
    casesB: Record<string, unknown>[];
  };

  // Per-field averages for both runs
  function fieldAvg(cases: Record<string, unknown>[], field: string) {
    const scores = cases
      .map((c) => (c.fieldScores as Record<string, number>)?.[field])
      .filter((s) => s !== undefined && s !== null);
    return scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;
  }

  const fieldData = FIELDS.map((f) => {
    const scoreA = fieldAvg(casesA, f);
    const scoreB = fieldAvg(casesB, f);
    const delta = scoreB - scoreA;
    return { field: f, scoreA, scoreB, delta };
  });

  const overallA = (runA.avgF1 as number) ?? 0;
  const overallB = (runB.avgF1 as number) ?? 0;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <a href="/" className="text-blue-600 hover:underline text-sm">
        ← Back
      </a>
      <h1 className="text-2xl font-bold mt-2 mb-6">Compare Runs</h1>

      {/* Run summaries */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        {[
          { run: runA, label: "A" },
          { run: runB, label: "B" },
        ].map(({ run, label }) => (
          <div key={label} className="border rounded p-4">
            <div className="text-xs text-gray-500 mb-1">Run {label}</div>
            <div className="font-bold text-lg">{run.strategy as string}</div>
            <div className="text-sm text-gray-600">
              {(run.id as string).slice(0, 8)}
            </div>
            <div className="mt-2 text-2xl font-mono">
              {(((run.avgF1 as number) ?? 0) * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Cost: ${(run.totalCostUsd as number)?.toFixed(4)} | Cache reads:{" "}
              {(run.totalCacheReadTokens as number)?.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* Overall winner */}
      <div
        className={`border-2 rounded p-3 mb-8 text-center font-medium ${
          overallB > overallA
            ? "border-green-400 bg-green-50"
            : overallA > overallB
              ? "border-blue-400 bg-blue-50"
              : "border-gray-300"
        }`}
      >
        {overallA === overallB
          ? "Tie overall"
          : `Run ${overallB > overallA ? "B" : "A"} wins overall by ${Math.abs((overallB - overallA) * 100).toFixed(1)}pp`}
      </div>

      {/* Per-field comparison — THE IMPORTANT SCREEN */}
      <h2 className="font-bold text-lg mb-4">Per-Field Breakdown</h2>
      <table className="w-full border-collapse border text-sm mb-8">
        <thead className="bg-gray-50">
          <tr>
            <th className="border px-4 py-2 text-left">Field</th>
            <th className="border px-4 py-2 text-right">
              Run A ({runA.strategy as string})
            </th>
            <th className="border px-4 py-2 text-right">
              Run B ({runB.strategy as string})
            </th>
            <th className="border px-4 py-2 text-right">Delta (B−A)</th>
            <th className="border px-4 py-2 text-center">Winner</th>
            <th className="border px-4 py-2 text-left w-48">Visual</th>
          </tr>
        </thead>
        <tbody>
          {fieldData.map(({ field, scoreA, scoreB, delta }) => (
            <tr key={field} className="hover:bg-gray-50">
              <td className="border px-4 py-2 font-medium">
                {field.replace(/_/g, " ")}
              </td>
              <td className="border px-4 py-2 text-right font-mono">
                {(scoreA * 100).toFixed(1)}%
              </td>
              <td className="border px-4 py-2 text-right font-mono">
                {(scoreB * 100).toFixed(1)}%
              </td>
              <td
                className={`border px-4 py-2 text-right font-mono font-bold ${
                  delta > 0.01
                    ? "text-green-600"
                    : delta < -0.01
                      ? "text-red-600"
                      : "text-gray-500"
                }`}
              >
                {delta > 0 ? "+" : ""}
                {(delta * 100).toFixed(1)}pp
              </td>
              <td className="border px-4 py-2 text-center">
                {Math.abs(delta) < 0.01 ? "—" : delta > 0 ? "🅱️ B" : "🅰️ A"}
              </td>
              <td className="border px-4 py-2">
                <div className="flex gap-1 items-center">
                  <div
                    className="h-3 bg-blue-400 rounded"
                    style={{ width: `${scoreA * 80}px` }}
                  />
                  <div
                    className="h-3 bg-purple-400 rounded"
                    style={{ width: `${scoreB * 80}px` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50 font-bold">
          <tr>
            <td className="border px-4 py-2">OVERALL F1</td>
            <td className="border px-4 py-2 text-right font-mono">
              {(overallA * 100).toFixed(1)}%
            </td>
            <td className="border px-4 py-2 text-right font-mono">
              {(overallB * 100).toFixed(1)}%
            </td>
            <td
              className={`border px-4 py-2 text-right font-mono ${
                overallB > overallA
                  ? "text-green-600"
                  : overallA > overallB
                    ? "text-red-600"
                    : "text-gray-500"
              }`}
            >
              {overallB > overallA ? "+" : ""}
              {((overallB - overallA) * 100).toFixed(1)}pp
            </td>
            <td className="border px-4 py-2 text-center">
              {overallA === overallB
                ? "—"
                : overallB > overallA
                  ? "🅱️ B"
                  : "🅰️ A"}
            </td>
            <td className="border px-4 py-2" />
          </tr>
        </tfoot>
      </table>

      {/* Per-case delta table */}
      <h2 className="font-bold text-lg mb-4">Per-Case Deltas</h2>
      <table className="w-full border-collapse border text-xs">
        <thead className="bg-gray-50">
          <tr>
            <th className="border px-2 py-1 text-left">Case</th>
            <th className="border px-2 py-1 text-right">F1 A</th>
            <th className="border px-2 py-1 text-right">F1 B</th>
            <th className="border px-2 py-1 text-right">Delta</th>
          </tr>
        </thead>
        <tbody>
          {casesA.map((cA) => {
            const cB = casesB.find((c) => c.caseId === cA.caseId);
            const f1A = (cA.overallF1 as number) ?? 0;
            const f1B = (cB?.overallF1 as number) ?? 0;
            const delta = f1B - f1A;
            return (
              <tr
                key={cA.caseId as string}
                className={
                  delta > 0.05
                    ? "bg-green-50"
                    : delta < -0.05
                      ? "bg-red-50"
                      : ""
                }
              >
                <td className="border px-2 py-1 font-mono">
                  {cA.caseId as string}
                </td>
                <td className="border px-2 py-1 text-right">
                  {(f1A * 100).toFixed(1)}%
                </td>
                <td className="border px-2 py-1 text-right">
                  {(f1B * 100).toFixed(1)}%
                </td>
                <td
                  className={`border px-2 py-1 text-right font-bold ${delta > 0 ? "text-green-700" : delta < 0 ? "text-red-700" : "text-gray-500"}`}
                >
                  {delta > 0 ? "+" : ""}
                  {(delta * 100).toFixed(1)}pp
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <CompareContent />
    </Suspense>
  );
}

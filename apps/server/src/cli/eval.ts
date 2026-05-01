import { startRun } from "../services/runner.service.ts";
import { db } from "@test-evals/db";
import { runs, caseResults } from "@test-evals/db/schema";
import { eq } from "drizzle-orm";
import type { Strategy } from "@test-evals/shared";

// Parse CLI args: --strategy=cot --model=claude-haiku-4-5-20251001
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => a.slice(2).split("=") as [string, string]),
);

const strategy = (args.strategy ?? "zero_shot") as Strategy;
const model = args.model ?? "claude-haiku-4-5-20251001";
const filter = args.filter;

console.log(`\n🏥 HEALOSBench Eval`);
console.log(`Strategy: ${strategy} | Model: ${model}`);
console.log("─".repeat(60));

const runId = await startRun(strategy, model, filter);

// Poll until complete
async function waitForRun() {
  while (true) {
    const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
    if (!run) break;
    if (run.status === "completed" || run.status === "failed") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

await waitForRun();

// Print results table
const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
const cases = await db
  .select()
  .from(caseResults)
  .where(eq(caseResults.runId, runId));

if (!run) {
  console.error("Run not found");
  process.exit(1);
}

// Per-field aggregates
const completed = cases.filter((c) => c.fieldScores !== null);
const fields = [
  "chief_complaint",
  "vitals",
  "medications",
  "diagnoses",
  "plan",
  "follow_up",
] as const;

const fieldAvgs = fields.reduce(
  (acc, f) => {
    const scores = completed.map(
      (c) => (c.fieldScores as Record<string, number>)?.[f] ?? 0,
    );
    acc[f] =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return acc;
  },
  {} as Record<string, number>,
);

console.log(`\n📊 Results — Run ${runId.slice(0, 8)}`);
console.log("─".repeat(60));
console.log(`${"Field".padEnd(20)} ${"Score".padStart(8)}`);
console.log("─".repeat(60));
for (const f of fields) {
  const bar = "█".repeat(Math.round(fieldAvgs[f] * 20)).padEnd(20);
  console.log(
    `${f.padEnd(20)} ${(fieldAvgs[f] * 100).toFixed(1).padStart(6)}%  ${bar}`,
  );
}
console.log("─".repeat(60));
console.log(
  `${"OVERALL F1".padEnd(20)} ${((run.avgF1 ?? 0) * 100).toFixed(1).padStart(6)}%`,
);
console.log(`\n💰 Cost:          $${run.totalCostUsd?.toFixed(5)}`);
console.log(`📥 Input tokens:  ${run.totalInputTokens.toLocaleString()}`);
console.log(`📤 Output tokens: ${run.totalOutputTokens.toLocaleString()}`);
console.log(`⚡ Cache reads:   ${run.totalCacheReadTokens.toLocaleString()}`);
console.log(`✍️  Cache writes:  ${run.totalCacheWriteTokens.toLocaleString()}`);
console.log(`🔑 Prompt hash:   ${run.promptHash}`);

const schemaFailed = cases.filter((c) => c.status === "schema_invalid").length;
const hallCount = cases.reduce(
  (s, c) => s + ((c.hallucinations as string[])?.length ?? 0),
  0,
);
console.log(`❌ Schema failures: ${schemaFailed}/${cases.length}`);
console.log(`👻 Hallucinations:  ${hallCount}`);
console.log("─".repeat(60));

process.exit(0);

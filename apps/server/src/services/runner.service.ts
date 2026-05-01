import { db } from "@test-evals/db";
import { runs, caseResults } from "@test-evals/db/schema";
import { extractFromTranscript } from "@test-evals/llm";
import { evaluatePrediction } from "./evaluate.service.ts";
import { eq, and } from "drizzle-orm";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { Strategy, RunSummary } from "@test-evals/shared";
import { randomUUID } from "crypto";

const DATA_DIR = join(process.cwd(), "../../data");
const CONCURRENCY = 5;
// Haiku pricing (per million tokens)
const COST_PER_M_INPUT = 0.8;
const COST_PER_M_OUTPUT = 4.0;
const COST_PER_M_CACHE_READ = 0.08;
const COST_PER_M_CACHE_WRITE = 1.0;

function calcCost(
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
) {
  return (
    (input / 1_000_000) * COST_PER_M_INPUT +
    (output / 1_000_000) * COST_PER_M_OUTPUT +
    (cacheRead / 1_000_000) * COST_PER_M_CACHE_READ +
    (cacheWrite / 1_000_000) * COST_PER_M_CACHE_WRITE
  );
}

function loadTranscript(caseId: string): string {
  return readFileSync(join(DATA_DIR, "transcripts", `${caseId}.txt`), "utf-8");
}

function loadGold(caseId: string) {
  return JSON.parse(
    readFileSync(join(DATA_DIR, "gold", `${caseId}.json`), "utf-8"),
  );
}

function getAllCaseIds(filter?: string): string[] {
  const files = readdirSync(join(DATA_DIR, "transcripts"));
  return files
    .filter((f) => f.endsWith(".txt") && (!filter || f.includes(filter)))
    .map((f) => f.replace(".txt", ""))
    .sort();
}

// Simple semaphore for concurrency control
class Semaphore {
  private queue: (() => void)[] = [];
  private running = 0;
  constructor(private limit: number) {}
  async acquire() {
    if (this.running < this.limit) {
      this.running++;
      return;
    }
    await new Promise<void>((r) => this.queue.push(r));
    this.running++;
  }
  release() {
    this.running--;
    this.queue.shift()?.();
  }
}

// SSE broadcast map — runId → set of response writers
const sseClients = new Map<string, Set<(data: string) => void>>();

export function subscribeToRun(runId: string, send: (data: string) => void) {
  if (!sseClients.has(runId)) sseClients.set(runId, new Set());
  sseClients.get(runId)!.add(send);
  return () => sseClients.get(runId)?.delete(send);
}

function broadcast(runId: string, event: object) {
  const clients = sseClients.get(runId);
  if (!clients) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const send of clients) send(data);
}

export async function startRun(
  strategy: Strategy,
  model: string,
  datasetFilter?: string,
): Promise<string> {
  const caseIds = getAllCaseIds(datasetFilter);

  // Get prompt hash from a test extraction (no API call needed — just hash)
  const { extractFromTranscript: _, ...rest } = await import("@test-evals/llm");
  const promptHash = await getPromptHash(strategy);

  const runId = randomUUID();
  await db.insert(runs).values({
    id: runId,
    strategy,
    model,
    status: "running",
    totalCases: caseIds.length,
    promptHash,
    datasetFilter: datasetFilter ?? null,
  });

  // Pre-insert pending case rows (enables resumability)
  await db.insert(caseResults).values(
    caseIds.map((caseId) => ({
      id: randomUUID(),
      runId,
      caseId,
      status: "pending" as const,
    })),
  );

  // Run async without awaiting — caller gets runId immediately
  runCases(runId, strategy, model, caseIds).catch(console.error);

  return runId;
}

export async function resumeRun(runId: string) {
  const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
  if (!run) throw new Error("Run not found");

  // Find pending cases
  const pending = await db.query.caseResults.findMany({
    where: and(eq(caseResults.runId, runId), eq(caseResults.status, "pending")),
  });

  const caseIds = pending.map((r) => r.caseId);
  await db.update(runs).set({ status: "running" }).where(eq(runs.id, runId));
  runCases(runId, run.strategy as Strategy, run.model, caseIds).catch(
    console.error,
  );
}

async function runCases(
  runId: string,
  strategy: Strategy,
  model: string,
  caseIds: string[],
) {
  const sem = new Semaphore(CONCURRENCY);

  await Promise.all(
    caseIds.map(async (caseId) => {
      await sem.acquire();
      try {
        await processCase(runId, strategy, model, caseId);
      } finally {
        sem.release();
      }
    }),
  );

  // Compute final aggregates
  const results = await db.query.caseResults.findMany({
    where: eq(caseResults.runId, runId),
  });

  const completed = results.filter((r) => r.overallF1 !== null);
  const avgF1 =
    completed.length > 0
      ? completed.reduce((s, r) => s + (r.overallF1 ?? 0), 0) / completed.length
      : null;

  const totals = results.reduce(
    (acc, r) => ({
      input: acc.input + r.inputTokens,
      output: acc.output + r.outputTokens,
      cacheRead: acc.cacheRead + r.cacheReadTokens,
      cacheWrite: acc.cacheWrite + r.cacheWriteTokens,
      cost: acc.cost + r.costUsd,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  );

  await db
    .update(runs)
    .set({
      status: "completed",
      completedCases: completed.length,
      avgF1,
      totalCostUsd: totals.cost,
      totalInputTokens: totals.input,
      totalOutputTokens: totals.output,
      totalCacheReadTokens: totals.cacheRead,
      totalCacheWriteTokens: totals.cacheWrite,
      completedAt: new Date(),
    })
    .where(eq(runs.id, runId));

  broadcast(runId, { type: "run_complete", runId });
}

async function processCase(
  runId: string,
  strategy: Strategy,
  model: string,
  caseId: string,
) {
  // Idempotency check — if already completed, skip
  const existing = await db.query.caseResults.findFirst({
    where: and(eq(caseResults.runId, runId), eq(caseResults.caseId, caseId)),
  });
  if (existing?.status === "completed") return;

  const transcript = loadTranscript(caseId);
  const gold = loadGold(caseId);
  const start = Date.now();

  let retries = 0;
  const result = await (async () => {
    while (retries < 3) {
      try {
        return await extractFromTranscript(transcript, strategy, model);
      } catch (err: unknown) {
        // Rate limit backoff
        if ((err as { status?: number }).status === 429) {
          const wait = Math.pow(2, retries) * 1000;
          console.log(`Rate limited on ${caseId}, waiting ${wait}ms`);
          await new Promise((r) => setTimeout(r, wait));
          retries++;
        } else throw err;
      }
    }
    throw new Error("Max retries exceeded");
  })();

  const durationMs = Date.now() - start;
  const costUsd = calcCost(
    result.inputTokens,
    result.outputTokens,
    result.cacheReadTokens,
    result.cacheWriteTokens,
  );

  let fieldScores = null,
    overallF1 = null,
    hallucinations: string[] = [];
  let status: "completed" | "failed" | "schema_invalid" = "completed";

  if (result.extraction) {
    const eval_ = evaluatePrediction(result.extraction, gold, transcript);
    fieldScores = eval_.fieldScores;
    overallF1 = eval_.overallF1;
    hallucinations = eval_.hallucinations;
  } else {
    status = result.schemaErrors.length > 0 ? "schema_invalid" : "failed";
  }

  await db
    .update(caseResults)
    .set({
      status,
      prediction: result.extraction,
      gold,
      fieldScores,
      overallF1,
      hallucinations,
      schemaErrors: result.schemaErrors,
      attempts: result.attempts.length,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens,
      cacheWriteTokens: result.cacheWriteTokens,
      costUsd,
      durationMs,
      llmTrace: result.attempts,
    })
    .where(and(eq(caseResults.runId, runId), eq(caseResults.caseId, caseId)));

  await db
    .update(runs)
    .set({
      completedCases: db.$count(
        caseResults,
        and(eq(caseResults.runId, runId), eq(caseResults.status, "completed")),
      ) as unknown as number,
    })
    .where(eq(runs.id, runId));

  broadcast(runId, { type: "case_complete", caseId, overallF1, status });
  console.log(
    `✓ ${caseId} — F1: ${overallF1?.toFixed(3)} — cost: $${costUsd.toFixed(5)}`,
  );
}

async function getPromptHash(strategy: Strategy): Promise<string> {
  const { createHash } = await import("crypto");
  const systems: Record<Strategy, string> = {
    zero_shot: `You are a clinical documentation assistant. 
Extract structured data from doctor-patient transcripts using the extract_clinical_data tool.
Be precise — only extract information explicitly stated in the transcript.
If a value is not mentioned, use null.`,
    few_shot: `You are a clinical documentation assistant.
Extract structured data from doctor-patient transcripts using the extract_clinical_data tool.`,
    cot: `You are a clinical documentation assistant.
Extract structured data from doctor-patient transcripts using the extract_clinical_data tool.

Think step by step before calling the tool:
1. CHIEF COMPLAINT — What did the patient say brought them in? Use their words.
2. VITALS — Scan the header or any measurements mentioned. Note exact values.
3. MEDICATIONS — List every drug with dose, frequency, and route. Normalize: BID=twice daily, QD=once daily, TID=three times daily, PRN=as needed.
4. DIAGNOSES — What did the doctor diagnose? Include ICD-10 if you know it.
5. PLAN — Break the plan into discrete action items (one per array element).
6. FOLLOW UP — Is there a specific timeframe? A reason stated?

After your reasoning, call extract_clinical_data with your final answer.`,
  };
  return createHash("sha256")
    .update(systems[strategy])
    .digest("hex")
    .slice(0, 16);
}

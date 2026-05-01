import { Hono } from "hono";
import { db } from "@test-evals/db";
import { runs, caseResults } from "@test-evals/db/schema";
import {
  startRun,
  resumeRun,
  subscribeToRun,
} from "../services/runner.service.ts";
import { eq } from "drizzle-orm";
import { streamSSE } from "hono/streaming";

export const runsRouter = new Hono();

// POST /api/v1/runs — start a new run
runsRouter.post("/", async (c) => {
  const { strategy, model, dataset_filter } = await c.req.json();
  const runId = await startRun(
    strategy,
    model ?? "claude-haiku-4-5-20251001",
    dataset_filter,
  );
  return c.json({ runId });
});

// POST /api/v1/runs/:id/resume
runsRouter.post("/:id/resume", async (c) => {
  await resumeRun(c.req.param("id"));
  return c.json({ ok: true });
});

// GET /api/v1/runs — list all runs
runsRouter.get("/", async (c) => {
  const allRuns = await db.select().from(runs).orderBy(runs.createdAt);
  return c.json(allRuns);
});

// GET /api/v1/runs/compare?a=runId1&b=runId2
runsRouter.get("/compare", async (c) => {
  const { a, b } = c.req.query();
  const [runA, runB] = await Promise.all([
    db.query.runs.findFirst({ where: eq(runs.id, a) }),
    db.query.runs.findFirst({ where: eq(runs.id, b) }),
  ]);
  const [casesA, casesB] = await Promise.all([
    db.select().from(caseResults).where(eq(caseResults.runId, a)),
    db.select().from(caseResults).where(eq(caseResults.runId, b)),
  ]);
  return c.json({ runA, runB, casesA, casesB });
});

// GET /api/v1/runs/:id — run detail with cases
runsRouter.get("/:id", async (c) => {
  const run = await db.query.runs.findFirst({
    where: eq(runs.id, c.req.param("id")),
  });
  if (!run) return c.json({ error: "Not found" }, 404);
  const cases = await db
    .select()
    .from(caseResults)
    .where(eq(caseResults.runId, run.id));
  return c.json({ run, cases });
});

// GET /api/v1/runs/:id/stream — SSE progress
runsRouter.get("/:id/stream", async (c) => {
  const runId = c.req.param("id");
  return streamSSE(c, async (stream) => {
    const unsub = subscribeToRun(runId, (data) => stream.write(data));
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5 * 60 * 1000); // max 5 min stream
    });
    unsub();
  });
});

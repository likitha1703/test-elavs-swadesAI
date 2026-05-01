import { auth } from "@test-evals/auth";
import { env } from "@test-evals/env/server";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { runsRouter } from "./routes/runs.ts";
import { resumeRun } from "./services/runner.service.ts";
import { db } from "@test-evals/db";
import { runs } from "@test-evals/db/schema";
import { eq } from "drizzle-orm";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);
app.route("/api/v1/runs", runsRouter);

app.get("/health", (c) => c.json({ ok: true }));
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Resume any runs interrupted by a previous server crash/restart
async function resumeInterruptedRuns() {
  const interrupted = await db.query.runs.findMany({
    where: eq(runs.status, "running"),
  });
  if (interrupted.length > 0) {
    console.log(`↺ Resuming ${interrupted.length} interrupted run(s)...`);
    for (const run of interrupted) {
      console.log(`  → ${run.id.slice(0, 8)} (${run.strategy})`);
      resumeRun(run.id).catch(console.error);
    }
  }
}

resumeInterruptedRuns();

serve({ fetch: app.fetch, port: 8787 }, () => {
  console.log("Server running on http://localhost:8787");
});

app.get("/", (c) => c.text("OK"));

export default app;

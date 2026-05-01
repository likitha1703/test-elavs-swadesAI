import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  strategy: text("strategy").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull().default("pending"),
  totalCases: integer("total_cases").notNull().default(50),
  completedCases: integer("completed_cases").notNull().default(0),
  avgF1: real("avg_f1"),
  totalCostUsd: real("total_cost_usd").notNull().default(0),
  totalInputTokens: integer("total_input_tokens").notNull().default(0),
  totalOutputTokens: integer("total_output_tokens").notNull().default(0),
  totalCacheReadTokens: integer("total_cache_read_tokens").notNull().default(0),
  totalCacheWriteTokens: integer("total_cache_write_tokens")
    .notNull()
    .default(0),
  promptHash: text("prompt_hash").notNull(),
  datasetFilter: text("dataset_filter"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const caseResults = pgTable("case_results", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  caseId: text("case_id").notNull(),
  status: text("status").notNull().default("pending"),
  prediction: jsonb("prediction"),
  gold: jsonb("gold"),
  fieldScores: jsonb("field_scores"),
  overallF1: real("overall_f1"),
  hallucinations: jsonb("hallucinations").notNull().default([]),
  schemaErrors: jsonb("schema_errors").notNull().default([]),
  attempts: integer("attempts").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  llmTrace: jsonb("llm_trace").notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

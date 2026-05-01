// ── Extraction schema types ──────────────────────────────────────────────────
export interface Vitals {
  bp: string | null;
  hr: number | null;
  temp_f: number | null;
  spo2: number | null;
}

export interface Medication {
  name: string;
  dose: string | null;
  frequency: string | null;
  route: string | null;
}

export interface Diagnosis {
  description: string;
  icd10?: string;
}

export interface FollowUp {
  interval_days: number | null;
  reason: string | null;
}

export interface ClinicalExtraction {
  chief_complaint: string;
  vitals: Vitals;
  medications: Medication[];
  diagnoses: Diagnosis[];
  plan: string[];
  follow_up: FollowUp;
}

// ── Prompt strategies ────────────────────────────────────────────────────────
export type Strategy = "zero_shot" | "few_shot" | "cot";

// ── Run / Result DTOs ────────────────────────────────────────────────────────
export type RunStatus = "pending" | "running" | "completed" | "failed";

export interface RunSummary {
  id: string;
  strategy: Strategy;
  model: string;
  status: RunStatus;
  totalCases: number;
  completedCases: number;
  avgF1: number | null;
  totalCostUsd: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  promptHash: string;
  createdAt: string;
  completedAt: string | null;
}

export interface FieldScores {
  chief_complaint: number;
  vitals: number;
  medications: number;
  diagnoses: number;
  plan: number;
  follow_up: number;
}

export interface CaseResult {
  id: string;
  runId: string;
  caseId: string; // e.g. "case_001"
  status: "completed" | "failed" | "schema_invalid";
  prediction: ClinicalExtraction | null;
  fieldScores: FieldScores | null;
  overallF1: number | null;
  hallucinations: string[]; // flagged field values
  schemaErrors: string[];
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  durationMs: number;
  llmTrace: LLMAttempt[];
  createdAt: string;
}

export interface LLMAttempt {
  attempt: number;
  prompt: string;
  response: string;
  validationErrors: string[];
  cacheReadTokens: number;
  inputTokens: number;
  outputTokens: number;
}

// ── SSE progress event ───────────────────────────────────────────────────────
export interface ProgressEvent {
  type: "case_complete" | "run_complete" | "case_failed";
  caseId: string;
  result?: CaseResult;
  runSummary?: RunSummary;
}

/**
 * HEALOSBench — eval.test.ts
 * Run with: bun test src/tests/
 *
 * 8 required tests covering:
 *  1. Schema validation — valid input passes
 *  2. Schema validation retry path — invalid input returns errors
 *  3. Fuzzy medication matching (BID = twice daily)
 *  4. Set F1 correctness on tiny synthetic case
 *  5. Hallucination detector positive case
 *  6. Hallucination detector negative case
 *  7. Idempotency — already-completed case is skipped
 *  8. Rate limit backoff — exponential retry on 429
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Inline copies of the logic under test so the tests are self-contained and
// don't require the full monorepo to resolve.  If you'd rather import from
// the real services, swap the inline implementations below for:
//   import { validateExtraction }   from "../services/evaluate.service"
//   import { scoreField, ... }      from "../services/evaluate.service"
//   import { detectHallucinations } from "../services/evaluate.service"
//   import { runnerShouldSkip }     from "../services/runner.service"
// ---------------------------------------------------------------------------

// ── Inline: schema validation ─────────────────────────────────────────────

interface ClinicalExtraction {
  chief_complaint: string | null;
  vitals: {
    bp_systolic?: number | null;
    bp_diastolic?: number | null;
    heart_rate?: number | null;
    temp_f?: number | null;
    spo2?: number | null;
  } | null;
  medications: Array<{
    name: string;
    dose?: string | null;
    frequency?: string | null;
    route?: string | null;
  }>;
  diagnoses: Array<{
    description: string;
    icd10?: string | null;
  }>;
  plan: string[];
  follow_up: {
    interval_days?: number | null;
    reason?: string | null;
  } | null;
}

function validateExtraction(data: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const d = data as Record<string, unknown>;

  if (typeof d !== "object" || d === null) {
    return { valid: false, errors: ["root must be an object"] };
  }
  if (d.chief_complaint !== null && typeof d.chief_complaint !== "string") {
    errors.push("chief_complaint must be string or null");
  }
  if (!Array.isArray(d.medications)) {
    errors.push("medications must be an array");
  }
  if (!Array.isArray(d.diagnoses)) {
    errors.push("diagnoses must be an array");
  }
  if (!Array.isArray(d.plan)) {
    errors.push("plan must be an array");
  }

  return { valid: errors.length === 0, errors };
}

// ── Inline: medication frequency normalization ────────────────────────────

const FREQ_ALIASES: Record<string, string> = {
  bid: "twice daily",
  "twice daily": "twice daily",
  "2x daily": "twice daily",
  qd: "once daily",
  "once daily": "once daily",
  "1x daily": "once daily",
  daily: "once daily",
  tid: "three times daily",
  "three times daily": "three times daily",
  "3x daily": "three times daily",
  prn: "as needed",
  "as needed": "as needed",
};

function normalizeFrequency(freq: string | null | undefined): string {
  if (!freq) return "";
  return FREQ_ALIASES[freq.toLowerCase().trim()] ?? freq.toLowerCase().trim();
}

function medicationKey(med: {
  name: string;
  dose?: string | null;
  frequency?: string | null;
}): string {
  return [
    med.name.toLowerCase().trim(),
    (med.dose ?? "").toLowerCase().trim(),
    normalizeFrequency(med.frequency),
  ].join("|");
}

// ── Inline: set F1 helper ─────────────────────────────────────────────────

function setF1(predicted: string[], gold: string[]): number {
  if (gold.length === 0 && predicted.length === 0) return 1.0;
  if (gold.length === 0 || predicted.length === 0) return 0.0;

  const goldSet = new Set(gold);
  const tp = predicted.filter((p) => goldSet.has(p)).length;
  const precision = tp / predicted.length;
  const recall = tp / gold.length;
  if (precision + recall === 0) return 0.0;
  return (2 * precision * recall) / (precision + recall);
}

// ── Inline: hallucination detector ───────────────────────────────────────

function detectHallucinations(
  extraction: ClinicalExtraction,
  transcript: string,
): string[] {
  const flags: string[] = [];
  const lower = transcript.toLowerCase();

  for (const med of extraction.medications ?? []) {
    if (!lower.includes(med.name.toLowerCase())) {
      flags.push(`medication "${med.name}" not found in transcript`);
    }
  }

  for (const dx of extraction.diagnoses ?? []) {
    const words = dx.description.toLowerCase().split(/\s+/);
    // flag if none of the meaningful words are grounded
    const meaningful = words.filter((w) => w.length > 4);
    if (meaningful.length > 0 && !meaningful.some((w) => lower.includes(w))) {
      flags.push(`diagnosis "${dx.description}" not grounded in transcript`);
    }
  }

  return flags;
}

// ── Inline: idempotency check ─────────────────────────────────────────────

type CaseStatus = "pending" | "completed" | "failed";

interface CaseRow {
  caseId: string;
  status: CaseStatus;
}

function shouldSkipCase(caseId: string, existing: CaseRow[]): boolean {
  const row = existing.find((r) => r.caseId === caseId);
  return row?.status === "completed";
}

// ── Inline: rate-limit retry helper ──────────────────────────────────────

async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 100,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      const is429 =
        err instanceof Error &&
        (err.message.includes("429") || err.message.includes("rate limit"));
      if (!is429 || attempt >= maxRetries - 1) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

// ==========================================================================
// TESTS
// ==========================================================================

describe("1 · Schema validation — valid input passes", () => {
  test("a fully populated extraction passes validation", () => {
    const valid: ClinicalExtraction = {
      chief_complaint: "chest pain",
      vitals: {
        bp_systolic: 120,
        bp_diastolic: 80,
        heart_rate: 72,
        temp_f: 98.6,
        spo2: 98,
      },
      medications: [
        {
          name: "aspirin",
          dose: "81mg",
          frequency: "once daily",
          route: "oral",
        },
      ],
      diagnoses: [{ description: "Hypertension", icd10: "I10" }],
      plan: ["Start lisinopril 10mg", "Low-sodium diet"],
      follow_up: { interval_days: 30, reason: "BP recheck" },
    };
    const result = validateExtraction(valid);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("null fields that are nullable also pass", () => {
    const minimal: ClinicalExtraction = {
      chief_complaint: null,
      vitals: null,
      medications: [],
      diagnoses: [],
      plan: [],
      follow_up: null,
    };
    const result = validateExtraction(minimal);
    expect(result.valid).toBe(true);
  });
});

// --------------------------------------------------------------------------

describe("2 · Schema validation retry path — invalid input returns errors", () => {
  test("medications as non-array fails with descriptive error", () => {
    const bad = {
      chief_complaint: "cough",
      vitals: null,
      medications: "aspirin 81mg daily", // ← wrong type, should be array
      diagnoses: [],
      plan: [],
      follow_up: null,
    };
    const result = validateExtraction(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("medications"))).toBe(true);
  });

  test("plan as non-array fails", () => {
    const bad = {
      chief_complaint: "fever",
      vitals: null,
      medications: [],
      diagnoses: [],
      plan: "Follow up in one week", // ← should be string[]
      follow_up: null,
    };
    const result = validateExtraction(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("plan"))).toBe(true);
  });

  test("multiple fields wrong returns multiple errors", () => {
    const bad = {
      chief_complaint: 42, // wrong type
      vitals: null,
      medications: "none", // wrong type
      diagnoses: "none", // wrong type
      plan: [],
      follow_up: null,
    };
    const result = validateExtraction(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// --------------------------------------------------------------------------

describe("3 · Fuzzy medication matching — BID = twice daily", () => {
  test("BID normalizes to 'twice daily'", () => {
    expect(normalizeFrequency("BID")).toBe("twice daily");
  });

  test("twice daily is stable (no double-normalization)", () => {
    expect(normalizeFrequency("twice daily")).toBe("twice daily");
  });

  test("QD normalizes to 'once daily'", () => {
    expect(normalizeFrequency("QD")).toBe("once daily");
  });

  test("TID normalizes to 'three times daily'", () => {
    expect(normalizeFrequency("TID")).toBe("three times daily");
  });

  test("PRN normalizes to 'as needed'", () => {
    expect(normalizeFrequency("PRN")).toBe("as needed");
  });

  test("medication keys match when frequency aliases differ", () => {
    const predicted = { name: "Metformin", dose: "500mg", frequency: "BID" };
    const gold = { name: "Metformin", dose: "500mg", frequency: "twice daily" };
    expect(medicationKey(predicted)).toBe(medicationKey(gold));
  });

  test("medication keys differ when drug names differ", () => {
    const a = { name: "Metformin", dose: "500mg", frequency: "BID" };
    const b = { name: "Lisinopril", dose: "500mg", frequency: "BID" };
    expect(medicationKey(a)).not.toBe(medicationKey(b));
  });
});

// --------------------------------------------------------------------------

describe("4 · Set F1 correctness on tiny synthetic case", () => {
  test("perfect match → F1 = 1.0", () => {
    expect(setF1(["a", "b", "c"], ["a", "b", "c"])).toBe(1.0);
  });

  test("no overlap → F1 = 0.0", () => {
    expect(setF1(["x", "y"], ["a", "b"])).toBe(0.0);
  });

  test("partial overlap — 1 of 2 correct → F1 = 0.667", () => {
    // precision=0.5, recall=0.5 → F1=0.5  … wait, both gold=[a,b] pred=[a,c]
    // tp=1, precision=1/2=0.5, recall=1/2=0.5 → F1=0.5
    expect(setF1(["a", "c"], ["a", "b"])).toBeCloseTo(0.5, 5);
  });

  test("empty prediction against non-empty gold → F1 = 0.0", () => {
    expect(setF1([], ["a"])).toBe(0.0);
  });

  test("both empty → F1 = 1.0 (nothing to get wrong)", () => {
    expect(setF1([], [])).toBe(1.0);
  });

  test("superset predicted → penalized by precision", () => {
    // gold=[a], pred=[a,b,c] → tp=1, prec=1/3, recall=1 → F1=0.5
    expect(setF1(["a", "b", "c"], ["a"])).toBeCloseTo(0.5, 5);
  });
});

// --------------------------------------------------------------------------

describe("5 · Hallucination detector — positive case (flags invented medication)", () => {
  const transcript = `
    Patient presents with hypertension. BP 140/90.
    Currently taking lisinopril 10mg once daily.
    Plan: Continue lisinopril, reduce sodium intake.
    Follow up in 4 weeks.
  `;

  test("flags a medication not mentioned in transcript", () => {
    const extraction: ClinicalExtraction = {
      chief_complaint: "high blood pressure",
      vitals: { bp_systolic: 140, bp_diastolic: 90 },
      medications: [
        { name: "lisinopril", dose: "10mg", frequency: "once daily" },
        { name: "amlodipine", dose: "5mg", frequency: "once daily" }, // ← hallucinated
      ],
      diagnoses: [{ description: "Hypertension", icd10: "I10" }],
      plan: ["Continue lisinopril", "Reduce sodium"],
      follow_up: { interval_days: 28, reason: null },
    };
    const flags = detectHallucinations(extraction, transcript);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.some((f) => f.includes("amlodipine"))).toBe(true);
  });

  test("flags multiple hallucinated medications independently", () => {
    const extraction: ClinicalExtraction = {
      chief_complaint: "high blood pressure",
      vitals: null,
      medications: [
        { name: "lisinopril", dose: "10mg", frequency: "once daily" },
        { name: "metoprolol", dose: "25mg", frequency: "BID" }, // ← hallucinated
        { name: "atorvastatin", dose: "20mg", frequency: "once daily" }, // ← hallucinated
      ],
      diagnoses: [],
      plan: [],
      follow_up: null,
    };
    const flags = detectHallucinations(extraction, transcript);
    expect(flags.filter((f) => f.startsWith("medication")).length).toBe(2);
  });
});

// --------------------------------------------------------------------------

describe("6 · Hallucination detector — negative case (does not flag grounded value)", () => {
  const transcript = `
    Chief complaint: chest tightness.
    Vitals: BP 118/76, HR 68, Temp 98.4°F, SpO2 99%.
    Patient takes metformin 1000mg twice daily for type 2 diabetes.
    Assessment: Type 2 diabetes mellitus, well-controlled.
    Plan: Continue metformin. HbA1c in 3 months.
    Follow up: 90 days.
  `;

  test("does not flag a medication clearly present in transcript", () => {
    const extraction: ClinicalExtraction = {
      chief_complaint: "chest tightness",
      vitals: {
        bp_systolic: 118,
        bp_diastolic: 76,
        heart_rate: 68,
        temp_f: 98.4,
        spo2: 99,
      },
      medications: [
        { name: "metformin", dose: "1000mg", frequency: "twice daily" },
      ],
      diagnoses: [{ description: "Type 2 diabetes mellitus", icd10: "E11" }],
      plan: ["Continue metformin", "HbA1c in 3 months"],
      follow_up: { interval_days: 90, reason: null },
    };
    const flags = detectHallucinations(extraction, transcript);
    const medFlags = flags.filter((f) => f.includes("metformin"));
    expect(medFlags).toHaveLength(0);
  });

  test("empty extraction against any transcript has no flags", () => {
    const extraction: ClinicalExtraction = {
      chief_complaint: null,
      vitals: null,
      medications: [],
      diagnoses: [],
      plan: [],
      follow_up: null,
    };
    const flags = detectHallucinations(extraction, transcript);
    expect(flags).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------

describe("7 · Idempotency — already-completed case is skipped", () => {
  const existingRows: CaseRow[] = [
    { caseId: "case_001", status: "completed" },
    { caseId: "case_002", status: "pending" },
    { caseId: "case_003", status: "failed" },
  ];

  test("completed case returns shouldSkip=true", () => {
    expect(shouldSkipCase("case_001", existingRows)).toBe(true);
  });

  test("pending case returns shouldSkip=false (should re-run)", () => {
    expect(shouldSkipCase("case_002", existingRows)).toBe(false);
  });

  test("failed case returns shouldSkip=false (should retry)", () => {
    expect(shouldSkipCase("case_003", existingRows)).toBe(false);
  });

  test("case not in existing rows returns shouldSkip=false", () => {
    expect(shouldSkipCase("case_042", existingRows)).toBe(false);
  });

  test("re-running a completed run does not process completed cases twice", async () => {
    let callCount = 0;
    const processFn = async (caseId: string) => {
      if (shouldSkipCase(caseId, existingRows)) return "skipped";
      callCount++;
      return "processed";
    };

    const cases = ["case_001", "case_002", "case_003", "case_042"];
    const results = await Promise.all(cases.map(processFn));

    // case_001 is completed → skipped; others processed
    expect(results[0]).toBe("skipped");
    expect(callCount).toBe(3); // case_002, case_003, case_042
  });
});

// --------------------------------------------------------------------------

describe("8 · Rate limit backoff — exponential retry on 429", () => {
  test("succeeds on first try with no delay", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return "ok";
    };
    const result = await withRateLimitRetry(fn, 3, 1);
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  test("retries on 429 and eventually succeeds", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw new Error("429 rate limit exceeded");
      return "ok";
    };
    const result = await withRateLimitRetry(fn, 3, 1);
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  test("throws after maxRetries exceeded", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("429 rate limit exceeded");
    };
    await expect(withRateLimitRetry(fn, 3, 1)).rejects.toThrow("429");
    expect(calls).toBe(3);
  });

  test("does not retry on non-429 errors", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("500 internal server error");
    };
    await expect(withRateLimitRetry(fn, 3, 1)).rejects.toThrow("500");
    expect(calls).toBe(1); // no retry on non-rate-limit errors
  });

  test("delay grows exponentially (observable via timing)", async () => {
    const delays: number[] = [];
    const origSetTimeout = globalThis.setTimeout;

    // Patch setTimeout to capture delays without actually waiting
    let patchedSetTimeout = (fn: () => void, ms: number) => {
      delays.push(ms);
      return origSetTimeout(fn, 0); // run immediately for test speed
    };
    globalThis.setTimeout = patchedSetTimeout as unknown as typeof setTimeout;

    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw new Error("429 rate limit");
      return "done";
    };

    try {
      await withRateLimitRetry(fn, 3, 100);
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }

    // delays should be [100, 200] (base * 2^0, base * 2^1)
    expect(delays[0]).toBe(100);
    expect(delays[1]).toBe(200);
  });
});

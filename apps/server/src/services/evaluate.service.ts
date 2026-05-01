import type { ClinicalExtraction, FieldScores } from "@test-evals/shared";

// ── Fuzzy string match (token set ratio) ─────────────────────────────────────
function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

function tokenSetRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const na = normalize(a),
    nb = normalize(b);
  if (na === nb) return 1;
  const setA = new Set(na.split(/\s+/));
  const setB = new Set(nb.split(/\s+/));
  const intersection = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

// ── Medication normalization ──────────────────────────────────────────────────
const FREQ_MAP: Record<string, string> = {
  bid: "twice daily",
  "twice a day": "twice daily",
  qd: "once daily",
  "once a day": "once daily",
  daily: "once daily",
  tid: "three times daily",
  "three times a day": "three times daily",
  qid: "four times daily",
  prn: "as needed",
  "as required": "as needed",
  qhs: "at bedtime",
  "at night": "at bedtime",
  q6h: "every 6 hours",
  q8h: "every 8 hours",
  q12h: "every 12 hours",
};

function normalizeFreq(f: string | null): string {
  if (!f) return "";
  const n = normalize(f);
  return FREQ_MAP[n] ?? n;
}

function normalizeDose(d: string | null): string {
  if (!d) return "";
  return normalize(d).replace(/\s+/g, ""); // "10 mg" → "10mg"
}

// ── Set F1 helper ─────────────────────────────────────────────────────────────
function setF1<T>(
  predicted: T[],
  gold: T[],
  matchFn: (a: T, b: T) => boolean,
): number {
  if (predicted.length === 0 && gold.length === 0) return 1;
  if (predicted.length === 0 || gold.length === 0) return 0;

  let tp = 0;
  const goldUsed = new Set<number>();

  for (const p of predicted) {
    for (let i = 0; i < gold.length; i++) {
      if (!goldUsed.has(i) && matchFn(p, gold[i])) {
        tp++;
        goldUsed.add(i);
        break;
      }
    }
  }

  const precision = tp / predicted.length;
  const recall = tp / gold.length;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

// ── Per-field scorers ─────────────────────────────────────────────────────────
function scoreChiefComplaint(pred: string, gold: string): number {
  return tokenSetRatio(pred, gold);
}

function scoreVitals(
  pred: ClinicalExtraction["vitals"],
  gold: ClinicalExtraction["vitals"],
): number {
  const scores: number[] = [];

  // bp — exact string match after normalize
  scores.push(
    pred.bp && gold.bp
      ? normalize(pred.bp) === normalize(gold.bp)
        ? 1
        : 0
      : pred.bp === gold.bp
        ? 1
        : 0,
  );

  // hr — exact int match
  scores.push(pred.hr === gold.hr ? 1 : 0);

  // temp_f — numeric with ±0.2 tolerance
  if (pred.temp_f === null && gold.temp_f === null) scores.push(1);
  else if (pred.temp_f === null || gold.temp_f === null) scores.push(0);
  else scores.push(Math.abs(pred.temp_f - gold.temp_f) <= 0.2 ? 1 : 0);

  // spo2 — exact int match
  scores.push(pred.spo2 === gold.spo2 ? 1 : 0);

  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function scoreMedications(
  pred: ClinicalExtraction["medications"],
  gold: ClinicalExtraction["medications"],
): number {
  return setF1(pred, gold, (a, b) => {
    const nameMatch = tokenSetRatio(a.name, b.name) >= 0.8;
    const doseMatch = normalizeDose(a.dose) === normalizeDose(b.dose);
    const freqMatch = normalizeFreq(a.frequency) === normalizeFreq(b.frequency);
    return nameMatch && doseMatch && freqMatch;
  });
}

function scoreDiagnoses(
  pred: ClinicalExtraction["diagnoses"],
  gold: ClinicalExtraction["diagnoses"],
): number {
  return setF1(pred, gold, (a, b) => {
    const descMatch = tokenSetRatio(a.description, b.description) >= 0.7;
    // Bonus: exact icd10 match counts as full match even if description differs slightly
    const icdMatch = a.icd10 && b.icd10 && a.icd10 === b.icd10;
    return descMatch || !!icdMatch;
  });
}

function scorePlan(pred: string[], gold: string[]): number {
  return setF1(pred, gold, (a, b) => tokenSetRatio(a, b) >= 0.6);
}

function scoreFollowUp(
  pred: ClinicalExtraction["follow_up"],
  gold: ClinicalExtraction["follow_up"],
): number {
  const intervalScore = pred.interval_days === gold.interval_days ? 1 : 0;
  const reasonScore =
    pred.reason && gold.reason
      ? tokenSetRatio(pred.reason, gold.reason)
      : pred.reason === gold.reason
        ? 1
        : 0;
  return (intervalScore + reasonScore) / 2;
}

// ── Hallucination detector ────────────────────────────────────────────────────
export function detectHallucinations(
  prediction: ClinicalExtraction,
  transcript: string,
): string[] {
  const hallucinations: string[] = [];
  const t = normalize(transcript);

  function isGrounded(value: string): boolean {
    if (!value) return true;
    const nv = normalize(value);
    // Check if any significant token from the value appears in transcript
    const tokens = nv.split(/\s+/).filter((tok) => tok.length > 3);
    if (tokens.length === 0) return true;
    const matchCount = tokens.filter((tok) => t.includes(tok)).length;
    return matchCount / tokens.length >= 0.5;
  }

  if (!isGrounded(prediction.chief_complaint))
    hallucinations.push(`chief_complaint: "${prediction.chief_complaint}"`);

  for (const med of prediction.medications) {
    if (!isGrounded(med.name))
      hallucinations.push(`medication.name: "${med.name}"`);
  }

  for (const diag of prediction.diagnoses) {
    if (!isGrounded(diag.description))
      hallucinations.push(`diagnosis: "${diag.description}"`);
  }

  return hallucinations;
}

// ── Main evaluator ────────────────────────────────────────────────────────────
export function evaluatePrediction(
  prediction: ClinicalExtraction,
  gold: ClinicalExtraction,
  transcript: string,
): { fieldScores: FieldScores; overallF1: number; hallucinations: string[] } {
  const fieldScores: FieldScores = {
    chief_complaint: scoreChiefComplaint(
      prediction.chief_complaint,
      gold.chief_complaint,
    ),
    vitals: scoreVitals(prediction.vitals, gold.vitals),
    medications: scoreMedications(prediction.medications, gold.medications),
    diagnoses: scoreDiagnoses(prediction.diagnoses, gold.diagnoses),
    plan: scorePlan(prediction.plan, gold.plan),
    follow_up: scoreFollowUp(prediction.follow_up, gold.follow_up),
  };

  const overallF1 = Object.values(fieldScores).reduce((a, b) => a + b, 0) / 6;
  const hallucinations = detectHallucinations(prediction, transcript);

  return { fieldScores, overallF1, hallucinations };
}

import type { ClinicalExtraction } from "@test-evals/shared";

export function validateExtraction(data: unknown): {
  errors: string[];
  validated: ClinicalExtraction | null;
} {
  if (!data || typeof data !== "object")
    return { errors: ["Output is not an object"], validated: null };

  const d = data as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof d.chief_complaint !== "string" || d.chief_complaint.length === 0)
    errors.push("chief_complaint must be a non-empty string");

  const v = d.vitals as Record<string, unknown> | undefined;
  if (!v || typeof v !== "object") {
    errors.push("vitals must be an object with bp, hr, temp_f, spo2");
  } else {
    if (v.bp !== null && typeof v.bp !== "string")
      errors.push("vitals.bp must be string or null");
    if (v.hr !== null && typeof v.hr !== "number")
      errors.push("vitals.hr must be integer or null");
    if (v.temp_f !== null && typeof v.temp_f !== "number")
      errors.push("vitals.temp_f must be number or null");
    if (v.spo2 !== null && typeof v.spo2 !== "number")
      errors.push("vitals.spo2 must be integer or null");
  }

  if (!Array.isArray(d.medications))
    errors.push("medications must be an array");
  if (!Array.isArray(d.diagnoses)) errors.push("diagnoses must be an array");
  if (!Array.isArray(d.plan)) errors.push("plan must be an array of strings");

  const fu = d.follow_up as Record<string, unknown> | undefined;
  if (!fu || typeof fu !== "object") errors.push("follow_up must be an object");

  if (errors.length > 0) return { errors, validated: null };
  return { errors: [], validated: data as ClinicalExtraction };
}

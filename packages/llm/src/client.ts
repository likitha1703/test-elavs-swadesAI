import Anthropic from "@anthropic-ai/sdk";
import { env } from "@test-evals/env/server";

export const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// The tool definition — forces Claude to return schema-conformant JSON
export const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "extract_clinical_data",
  description:
    "Extract structured clinical data from a doctor-patient transcript.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: [
      "chief_complaint",
      "vitals",
      "medications",
      "diagnoses",
      "plan",
      "follow_up",
    ],
    properties: {
      chief_complaint: { type: "string", minLength: 1 },
      vitals: {
        type: "object",
        required: ["bp", "hr", "temp_f", "spo2"],
        properties: {
          bp: { type: ["string", "null"] },
          hr: { type: ["integer", "null"] },
          temp_f: { type: ["number", "null"] },
          spo2: { type: ["integer", "null"] },
        },
      },
      medications: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "dose", "frequency", "route"],
          properties: {
            name: { type: "string" },
            dose: { type: ["string", "null"] },
            frequency: { type: ["string", "null"] },
            route: { type: ["string", "null"] },
          },
        },
      },
      diagnoses: {
        type: "array",
        items: {
          type: "object",
          required: ["description"],
          properties: {
            description: { type: "string" },
            icd10: { type: "string" },
          },
        },
      },
      plan: { type: "array", items: { type: "string" } },
      follow_up: {
        type: "object",
        required: ["interval_days", "reason"],
        properties: {
          interval_days: { type: ["integer", "null"] },
          reason: { type: ["string", "null"] },
        },
      },
    },
  },
};

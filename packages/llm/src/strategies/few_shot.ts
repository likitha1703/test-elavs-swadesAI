import type Anthropic from "@anthropic-ai/sdk";

// A single short example baked into the prompt
const EXAMPLE_TRANSCRIPT = `[Vitals: BP 130/85, HR 72, Temp 98.6, SpO2 97%]
Doctor: What brings you in?
Patient: My knee has been hurting for two weeks.
Doctor: I'm diagnosing you with osteoarthritis. Take naproxen 500mg twice daily PO. Follow up in 4 weeks.`;

const EXAMPLE_OUTPUT = JSON.stringify(
  {
    chief_complaint: "knee pain for two weeks",
    vitals: { bp: "130/85", hr: 72, temp_f: 98.6, spo2: 97 },
    medications: [
      {
        name: "naproxen",
        dose: "500mg",
        frequency: "twice daily",
        route: "PO",
      },
    ],
    diagnoses: [{ description: "osteoarthritis", icd10: "M17.9" }],
    plan: ["Start naproxen 500mg twice daily"],
    follow_up: { interval_days: 28, reason: "reassess knee pain" },
  },
  null,
  2,
);

export const FEW_SHOT_SYSTEM = `You are a clinical documentation assistant.
Extract structured data from doctor-patient transcripts using the extract_clinical_data tool.

Here is an example of a correct extraction:

TRANSCRIPT:
${EXAMPLE_TRANSCRIPT}

CORRECT OUTPUT:
${EXAMPLE_OUTPUT}

Rules:
- Only extract values explicitly stated in the transcript
- Normalize medication frequencies (e.g. "BID" → "twice daily", "QD" → "once daily")
- Use null for any field not mentioned`;

export function buildFewShotMessages(
  transcript: string,
): Anthropic.MessageParam[] {
  return [
    {
      role: "user",
      content: `Extract clinical data from this transcript:\n\n${transcript}`,
    },
  ];
}

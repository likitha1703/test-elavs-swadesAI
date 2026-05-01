import type Anthropic from "@anthropic-ai/sdk";

export const COT_SYSTEM = `You are a clinical documentation assistant.
Extract structured data from doctor-patient transcripts using the extract_clinical_data tool.

Think step by step before calling the tool:
1. CHIEF COMPLAINT — What did the patient say brought them in? Use their words.
2. VITALS — Scan the header or any measurements mentioned. Note exact values.
3. MEDICATIONS — List every drug with dose, frequency, and route. Normalize: BID=twice daily, QD=once daily, TID=three times daily, PRN=as needed.
4. DIAGNOSES — What did the doctor diagnose? Include ICD-10 if you know it.
5. PLAN — Break the plan into discrete action items (one per array element).
6. FOLLOW UP — Is there a specific timeframe? A reason stated?

After your reasoning, call extract_clinical_data with your final answer.`;

export function buildCotMessages(transcript: string): Anthropic.MessageParam[] {
  return [
    {
      role: "user",
      content: `Think through each field carefully, then extract clinical data from this transcript:\n\n${transcript}`,
    },
  ];
}

import type Anthropic from "@anthropic-ai/sdk";

export const ZERO_SHOT_SYSTEM = `You are a clinical documentation assistant. 
Extract structured data from doctor-patient transcripts using the extract_clinical_data tool.
Be precise — only extract information explicitly stated in the transcript.
If a value is not mentioned, use null.`;

export function buildZeroShotMessages(
  transcript: string,
): Anthropic.MessageParam[] {
  return [
    {
      role: "user",
      content: `Extract clinical data from this transcript:\n\n${transcript}`,
    },
  ];
}

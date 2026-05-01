import Anthropic from "@anthropic-ai/sdk";
import type {
  ClinicalExtraction,
  LLMAttempt,
  Strategy,
} from "@test-evals/shared";
import { anthropic, EXTRACTION_TOOL } from "./client.ts";
import {
  ZERO_SHOT_SYSTEM,
  buildZeroShotMessages,
} from "./strategies/zero_shot.ts";
import {
  FEW_SHOT_SYSTEM,
  buildFewShotMessages,
} from "./strategies/few_shot.ts";
import { COT_SYSTEM, buildCotMessages } from "./strategies/cot.ts";
import { validateExtraction } from "./validator.ts";
import { createHash } from "crypto";

export interface ExtractionResult {
  extraction: ClinicalExtraction | null;
  attempts: LLMAttempt[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  schemaErrors: string[];
  promptHash: string;
}

function getStrategy(strategy: Strategy) {
  switch (strategy) {
    case "zero_shot":
      return { system: ZERO_SHOT_SYSTEM, buildMessages: buildZeroShotMessages };
    case "few_shot":
      return { system: FEW_SHOT_SYSTEM, buildMessages: buildFewShotMessages };
    case "cot":
      return { system: COT_SYSTEM, buildMessages: buildCotMessages };
  }
}
function buildCacheableSystem(system: string, transcript: string): string {
  return `${system}

## Output Schema Reference
The extract_clinical_data tool accepts the following fields:

**chief_complaint** (string | null)
The patient's primary reason for the visit, in their own words or as clinically documented.

**vitals** (object | null)
- bp_systolic: integer mmHg or null
- bp_diastolic: integer mmHg or null  
- heart_rate: integer bpm or null
- temp_f: float degrees Fahrenheit or null
- spo2: integer percent (0-100) or null

**medications** (array)
Each entry: { name: string, dose: string|null, frequency: string|null, route: string|null }
Normalize frequency: BID→"twice daily", QD→"once daily", TID→"three times daily", PRN→"as needed"
Include all medications mentioned regardless of whether newly prescribed or existing.

**diagnoses** (array)
Each entry: { description: string, icd10: string|null }
Include ICD-10 codes when you are confident. Use the most specific code available.
Format: "J45.20" not "J45" unless only the category is known.

**plan** (array of strings)
One discrete action item per element. Split compound instructions into separate items.
Examples: "Start lisinopril 10mg daily", "Order CBC with differential", "Low-sodium diet counseling"

**follow_up** (object | null)
- interval_days: integer number of days until next appointment or null
- reason: string describing why follow-up is needed or null
Convert: "2 weeks" → 14, "1 month" → 30, "3 months" → 90, "6 months" → 180

Always use null for fields not mentioned in the transcript. Never invent values. ## Transcript Under Analysis
${transcript}`;
}
export async function extractFromTranscript(
  transcript: string,
  strategy: Strategy,
  model: string,
): Promise<ExtractionResult> {
  const { system, buildMessages } = getStrategy(strategy);

  // Content hash of system prompt — "prompt v6" becomes unambiguous
  const promptHash = createHash("sha256")
    .update(system)
    .digest("hex")
    .slice(0, 16);

  const attempts: LLMAttempt[] = [];
  let totalInput = 0,
    totalOutput = 0,
    totalCacheRead = 0,
    totalCacheWrite = 0;
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= 3; attempt++) {
    // On retry, append the validation errors so Claude can self-correct
    const messages =
      attempt === 1
        ? buildMessages(transcript)
        : [
            ...buildMessages(transcript),
            {
              role: "user" as const,
              content: `Your previous extraction had these validation errors. Please fix them:\n${lastErrors.join("\n")}`,
            },
          ];
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: buildCacheableSystem(system, transcript),
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: "extract_clinical_data" },
      messages,
    });

    const usage = response.usage as Anthropic.Usage & {
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };

    totalInput += usage.input_tokens;
    totalOutput += usage.output_tokens;
    totalCacheRead += usage.cache_read_input_tokens ?? 0;
    totalCacheWrite += usage.cache_creation_input_tokens ?? 0;

    // Extract the tool_use block
    const toolUseBlock = response.content.find((b) => b.type === "tool_use") as
      | Anthropic.ToolUseBlock
      | undefined;
    const rawOutput = JSON.stringify(toolUseBlock?.input ?? {});

    const { errors, validated } = validateExtraction(toolUseBlock?.input);
    lastErrors = errors;

    attempts.push({
      attempt,
      prompt: messages[messages.length - 1].content as string,
      response: rawOutput,
      validationErrors: errors,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    });

    if (errors.length === 0 && validated) {
      return {
        extraction: validated,
        attempts,
        inputTokens: totalInput,
        outputTokens: totalOutput,
        cacheReadTokens: totalCacheRead,
        cacheWriteTokens: totalCacheWrite,
        schemaErrors: [],
        promptHash,
      };
    }
  }

  // All 3 attempts failed
  return {
    extraction: null,
    attempts,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheReadTokens: totalCacheRead,
    cacheWriteTokens: totalCacheWrite,
    schemaErrors: lastErrors,
    promptHash,
  };
}

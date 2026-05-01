import { extractFromTranscript } from "@test-evals/llm";
import { readFileSync } from "fs";

const transcript = readFileSync("../../data/transcripts/case_001.txt", "utf-8");
const result = await extractFromTranscript(
  transcript,
  "zero_shot",
  "claude-haiku-4-5-20251001",
);

console.log("Extraction:", JSON.stringify(result.extraction, null, 2));
console.log("Attempts:", result.attempts.length);
console.log("Cache read tokens:", result.cacheReadTokens);
console.log("Prompt hash:", result.promptHash);

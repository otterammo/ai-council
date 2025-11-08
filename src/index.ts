#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { runCouncil } from "./council";
import { TranscriptMessage } from "./types";

async function promptForQuestion(): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question("Enter a question for the AI council: ");
    return answer.trim();
  } finally {
    rl.close();
  }
}

function printTranscript(transcript: TranscriptMessage[]): void {
  console.log("\n=== TRANSCRIPT ===");
  const prelude: TranscriptMessage[] = [];
  const rounds = new Map<number, TranscriptMessage[]>();

  for (const message of transcript) {
    if (!message.round) {
      prelude.push(message);
      continue;
    }
    if (!rounds.has(message.round)) {
      rounds.set(message.round, []);
    }
    rounds.get(message.round)!.push(message);
  }

  if (prelude.length) {
    console.log("\n-- Prelude --");
    for (const msg of prelude) {
      console.log(`${msg.speaker}: ${msg.content}`);
    }
  }

  const sortedRounds = [...rounds.entries()].sort((a, b) => a[0] - b[0]);
  for (const [round, messages] of sortedRounds) {
    console.log(`\n-- Round ${round} --`);
    for (const msg of messages) {
      console.log(`${msg.speaker}: ${msg.content}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let question = args.join(" ").trim();

  if (!question) {
    question = await promptForQuestion();
  }

  if (!question) {
    console.error("A question is required.");
    process.exit(1);
  }

  const result = await runCouncil(question);

  printTranscript(result.transcript);

  console.log("\n=== FINAL JUDGMENT ===");
  console.log(result.judgment);
}

main().catch((error) => {
  console.error("Council run failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

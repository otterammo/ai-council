import { AGENTS, DEFAULT_ROUNDS, DEFAULT_TRANSCRIPT_WINDOW, JUDGE_AGENT } from "./agents";
import { callOllamaChat } from "./ollamaClient";
import {
  AgentConfig,
  CouncilOptions,
  CouncilResult,
  OllamaChatMessage,
  TranscriptMessage,
} from "./types";

/**
 * Entry point that runs the debate for the configured agents and returns their transcript.
 * Use the options argument to tweak rounds or alter the transcript window used for context.
 */
export async function runCouncil(
  userQuestion: string,
  options?: CouncilOptions
): Promise<CouncilResult> {
  const rounds = options?.rounds ?? DEFAULT_ROUNDS;
  const transcriptWindow = options?.transcriptWindow ?? DEFAULT_TRANSCRIPT_WINDOW;

  if (!userQuestion.trim()) {
    throw new Error("User question cannot be empty.");
  }

  const transcript: TranscriptMessage[] = [
    { speaker: "User", content: userQuestion.trim() },
  ];

  for (let round = 1; round <= rounds; round += 1) {
    for (const agent of AGENTS) {
      const windowSize = agent.transcriptWindow ?? transcriptWindow;
      try {
        const messages = buildAgentMessages(agent, userQuestion, transcript, windowSize);
        const reply = await callOllamaChat(agent.model, messages);
        transcript.push({ speaker: agent.name, content: reply, round });
      } catch (error) {
        const errMsg = `(${agent.name} failed: ${error instanceof Error ? error.message : String(error)})`;
        console.error(errMsg);
        transcript.push({ speaker: agent.name, content: `[ERROR] ${errMsg}`, round });
      }
    }
  }

  const judgment = await getJudgeDecision(userQuestion, transcript);

  return { transcript, judgment };
}

function buildAgentMessages(
  agent: AgentConfig,
  originalQuestion: string,
  transcript: TranscriptMessage[],
  transcriptWindow: number
): OllamaChatMessage[] {
  const recent = transcript.slice(-transcriptWindow);
  const debateLines = serializeTranscript(recent);

  const userContent = [
    `Original Question: ${originalQuestion}`,
    "",
    "Below is the current debate transcript between User, Analyst, Optimist, and Critic.",
    debateLines || "(no prior agent responses yet)",
    "",
    `Instruction: Respond as ${agent.name}. Address relevant points from other agents when needed. Use 4-8 sentences and keep assumptions explicit.`,
  ].join("\n");

  return [
    { role: "system", content: agent.systemPrompt },
    { role: "user", content: userContent },
  ];
}

async function getJudgeDecision(
  originalQuestion: string,
  transcript: TranscriptMessage[]
): Promise<string> {
  try {
    const judgeMessages: OllamaChatMessage[] = [
      { role: "system", content: JUDGE_AGENT.systemPrompt },
      {
        role: "user",
        content: [
          `Original Question: ${originalQuestion}`,
          "",
          "Full transcript (chronological):",
          serializeTranscript(transcript) || "(empty)",
          "",
          "Remember: summarize each agent, highlight agreements/disagreements, and finish with Final Recommendation: ...",
        ].join("\n"),
      },
    ];

    return await callOllamaChat(JUDGE_AGENT.model, judgeMessages);
  } catch (error) {
    throw new Error(
      `Judge agent failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function serializeTranscript(messages: TranscriptMessage[]): string {
  return messages
    .map((msg) => `${msg.speaker}: ${msg.content}`)
    .join("\n");
}

/**
 * Helper for implementers: adjust DEFAULT_ROUNDS in agents.ts or pass options.rounds
 * when invoking runCouncil to change the debate length. Similarly, pass
 * options.transcriptWindow (or set agent.transcriptWindow) to control how much
 * of the transcript each agent can see.
 */
export type { TranscriptMessage };

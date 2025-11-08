import { AGENTS, DEFAULT_ROUNDS, DEFAULT_TRANSCRIPT_WINDOW, JUDGE_AGENT } from "./agents";
import { streamOllamaChat } from "./ollamaClient";
import {
  AgentConfig,
  CouncilOptions,
  CouncilResult,
  Message,
  OllamaChatMessage,
} from "./types";

/**
 * Runs the council debate with streaming updates for each agent turn.
 */
export async function runCouncil(
  userQuestion: string,
  options?: CouncilOptions
): Promise<CouncilResult> {
  const trimmedQuestion = userQuestion.trim();
  if (!trimmedQuestion) {
    throw new Error("User question cannot be empty.");
  }

  const rounds = options?.rounds ?? DEFAULT_ROUNDS;
  const transcriptWindow = options?.transcriptWindow ?? DEFAULT_TRANSCRIPT_WINDOW;
  const hooks = options?.hooks;

  const transcript: Message[] = [{ speaker: "User", content: trimmedQuestion }];

  for (let round = 1; round <= rounds; round += 1) {
    hooks?.onRoundStart?.(round);

    for (const agent of AGENTS) {
      const windowSize = agent.transcriptWindow ?? transcriptWindow;
      const messages = buildAgentMessages(agent, trimmedQuestion, transcript, windowSize);

      hooks?.onAgentTurnStart?.(round, agent);

      const tokenHandler =
        hooks?.onAgentToken != null
          ? (fragment: string) => hooks.onAgentToken?.(agent, fragment)
          : () => undefined;

      let responseText = "";
      try {
        responseText = await streamOllamaChat(agent.model, messages, tokenHandler);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        hooks?.onAgentError?.(round, agent, err);
        responseText = `[ERROR] ${err.message}`;
      }

      transcript.push({ speaker: agent.name, content: responseText, round });
      hooks?.onAgentTurnComplete?.(round, agent, responseText);
    }
  }

  hooks?.onJudgeStart?.(JUDGE_AGENT);

  const judgeMessages = buildJudgeMessages(trimmedQuestion, transcript);
  const judgeTokenHandler =
    hooks?.onJudgeToken != null ? (fragment: string) => hooks.onJudgeToken?.(fragment) : () => undefined;

  let judgment = "";
  try {
    judgment = await streamOllamaChat(JUDGE_AGENT.model, judgeMessages, judgeTokenHandler);
    hooks?.onJudgeComplete?.(judgment);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    hooks?.onJudgeError?.(err);
    throw err;
  }

  return { transcript, judgment };
}

function buildAgentMessages(
  agent: AgentConfig,
  originalQuestion: string,
  transcript: Message[],
  transcriptWindow: number
): OllamaChatMessage[] {
  const recent = transcript.slice(-transcriptWindow);
  const recap = serializeTranscript(recent) || "(no debate history yet)";

  const userContent = [
    `User Question: ${originalQuestion}`,
    "",
    "Recent transcript excerpt:",
    recap,
    "",
    `Now respond as ${agent.name}. Address the most recent points raised, and feel free to agree, disagree, or introduce a new angle.`,
  ].join("\n");

  return [
    { role: "system", content: agent.systemPrompt },
    { role: "user", content: userContent },
  ];
}

function buildJudgeMessages(originalQuestion: string, transcript: Message[]): OllamaChatMessage[] {
  const fullTranscript = serializeTranscript(transcript) || "(empty)";
  const userContent = [
    `User Question: ${originalQuestion}`,
    "",
    "Full debate transcript:",
    fullTranscript,
    "",
    'Summarize each agent, highlight agreements vs disagreements, and finish with a line that begins "Final Recommendation:".',
  ].join("\n");

  return [
    { role: "system", content: JUDGE_AGENT.systemPrompt },
    { role: "user", content: userContent },
  ];
}

function serializeTranscript(messages: Message[]): string {
  return messages.map((msg) => `${msg.speaker}: ${msg.content}`).join("\n");
}

import { AGENTS, DEFAULT_TRANSCRIPT_WINDOW, JUDGE_AGENT } from "./agents";
import { streamOllamaChat } from "./ollamaClient";
import { getModeratorDecision } from "./moderator";
import {
  AgentConfig,
  CouncilOptions,
  CouncilResult,
  Message,
  OllamaChatMessage,
  SpeakerName,
} from "./types";

const DEFAULT_MAX_TURNS = 12;

export async function runConversation(
  userQuestion: string,
  options?: CouncilOptions
): Promise<CouncilResult> {
  const question = userQuestion.trim();
  if (!question) {
    throw new Error("User question cannot be empty.");
  }

  const transcript: Message[] = [{ speaker: "User", content: question }];
  const transcriptWindow = options?.transcriptWindow ?? DEFAULT_TRANSCRIPT_WINDOW;
  const maxTurns = options?.maxTurns ?? DEFAULT_MAX_TURNS;
  const hooks = options?.hooks;

  let turns = 0;
  let shouldConclude = false;
  let currentSpeaker: SpeakerName = "Analyst";

  while (turns < maxTurns && !shouldConclude) {
    if (currentSpeaker === "Judge") {
      shouldConclude = true;
      break;
    }

    await runSingleTurnForAgent(
      currentSpeaker,
      question,
      transcript,
      transcriptWindow,
      hooks
    );

    turns += 1;

    const decision = await getModeratorDecision(question, transcript);
    currentSpeaker = decision.nextSpeaker;
    shouldConclude = decision.shouldConclude;
  }

  const judgment = await runJudge(question, transcript, hooks);

  return { transcript, judgment };
}

async function runSingleTurnForAgent(
  speaker: SpeakerName,
  originalQuestion: string,
  transcript: Message[],
  transcriptWindow: number,
  hooks?: CouncilOptions["hooks"]
): Promise<void> {
  const agent = getAgentConfig(speaker);
  const windowSize = agent.transcriptWindow ?? transcriptWindow;
  const messages = buildAgentMessages(agent, originalQuestion, transcript, windowSize);

  hooks?.onAgentTurnStart?.(agent);

  const tokenHandler =
    hooks?.onAgentToken != null
      ? (fragment: string) => hooks.onAgentToken?.(agent, fragment)
      : () => undefined;

  let responseText = "";
  try {
    responseText = await streamOllamaChat(agent.model, messages, tokenHandler);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    hooks?.onAgentError?.(agent, err);
    responseText = `[ERROR] ${err.message}`;
  }

  transcript.push({ speaker: agent.name, content: responseText });
  hooks?.onAgentTurnComplete?.(agent, responseText);
}

async function runJudge(
  originalQuestion: string,
  transcript: Message[],
  hooks?: CouncilOptions["hooks"]
): Promise<string> {
  const messages = buildJudgeMessages(originalQuestion, transcript);
  hooks?.onJudgeStart?.(JUDGE_AGENT);

  const tokenHandler =
    hooks?.onJudgeToken != null ? (fragment: string) => hooks.onJudgeToken?.(fragment) : () => undefined;

  let judgment = "";
  try {
    judgment = await streamOllamaChat(JUDGE_AGENT.model, messages, tokenHandler);
    hooks?.onJudgeComplete?.(judgment);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    hooks?.onJudgeError?.(err);
    throw err;
  }

  transcript.push({ speaker: "Judge", content: judgment });
  return judgment;
}

function getAgentConfig(name: SpeakerName): AgentConfig {
  const agent = AGENTS.find((candidate) => candidate.name === name);
  if (!agent) {
    throw new Error(`Unknown agent: ${name}`);
  }
  return agent;
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
    `Instructions for ${agent.name}:`,
    "- Do NOT re-summarize the whole conversation or restate the question.",
    "- React to one or two of the most relevant recent points.",
    "- Add something new: a clarification, critique, or concrete next step.",
    "- Keep the tone conversational with 2–4 short paragraphs and reference other agents by name when useful.",
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
    'Summarize each visible agent, highlight agreements and disagreements, and finish with a line starting with "Final Recommendation:".',
  ].join("\n");

  return [
    { role: "system", content: JUDGE_AGENT.systemPrompt },
    { role: "user", content: userContent },
  ];
}

function serializeTranscript(messages: Message[]): string {
  return messages.map((msg) => `${msg.speaker}: ${msg.content}`).join("\n");
}

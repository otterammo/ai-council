import { DEFAULT_TRANSCRIPT_WINDOW } from "./agents";
import { streamOllamaChat } from "./ollamaClient";
import { resolveActivePanel } from "./panels";
import { getModeratorDecision } from "./moderator";
import { loadPersonas } from "./personas";
import {
  CouncilOptions,
  CouncilResult,
  Message,
  OllamaChatMessage,
} from "./types";
import type { PersonaConfig } from "./personas";
import type { ActivePanel } from "./panels";

/**
 * Architecture overview:
 * - src/index.ts gathers the user question, sets up CLI hooks, and invokes runConversation.
 * - runConversation creates a fresh transcript per invocation and loops: moderator selects the next speaker,
 *   that agent receives a persona/system prompt plus scoped transcript window, streams a response, and we clean & append it.
 * - Moderator decisions are based on the current question, recent transcript snippet, last speaker, and debater turn counts.
 * - Judge runs once after the debate with the complete transcript to create the final recommendation.
 * - All prompts are rebuilt for every single Ollama call, and post-processing (cleanSpeakerOutput + normalization)
 *   happens immediately after streaming to prevent artifacts from being printed or stored.
 */

const DEFAULT_MAX_TURNS = 12;
const MAX_DEBATER_TURNS = 8; // Hard cap so the debate cannot exceed the intended 6–8 debater turn budget.

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
  const personas = await loadPersonas({ personasDir: options?.personasDir });
  const requestedPanelName = options?.panelName ?? process.env.AI_COUNCIL_PANEL;
  const panel = resolveActivePanel(personas, requestedPanelName);

  const debaters = panel.debaters;
  const debaterNames = debaters.map((persona) => persona.name);
  const debaterNameSet = new Set(debaterNames);
  const judge = panel.judge;
  const judgeName = judge.name;
  const knownSpeakers = new Set([...debaterNames, judgeName]);
  const personaByName = new Map<string, PersonaConfig>();
  debaters.forEach((persona) => {
    personaByName.set(persona.name, persona);
  });
  personaByName.set(judge.name, judge);

  let turns = 0;
  let shouldConclude = false;
  let currentSpeaker: string = debaterNames[0] ?? judgeName;
  let lastSpeaker: string | null = null;
  let debaterTurns = 0;

  while (turns < maxTurns && !shouldConclude) {
    if (currentSpeaker === judgeName) {
      shouldConclude = true;
      break;
    }

    const currentPersona = personaByName.get(currentSpeaker);
    if (!currentPersona) {
      throw new Error(`Unknown persona: ${currentSpeaker}`);
    }

    await runSingleTurnForAgent(
      currentPersona,
      question,
      transcript,
      transcriptWindow,
      debaterNameSet,
      hooks
    );

    turns += 1;
    if (debaterNameSet.has(currentSpeaker)) {
      debaterTurns += 1;
    }
    lastSpeaker = currentSpeaker;

    if (debaterNameSet.has(currentSpeaker) && debaterTurns >= MAX_DEBATER_TURNS) {
      // Force a hand-off to Judge if we already consumed the allotted debater turns.
      currentSpeaker = judgeName;
      continue;
    }

    // Moderator decides who should speak next (or whether to conclude).
    const decision = await getModeratorDecision(question, transcript, panel);
    let nextSpeaker = decision.nextSpeaker;
    shouldConclude = decision.shouldConclude;

    if (
      !shouldConclude &&
      debaterNameSet.has(nextSpeaker) &&
      nextSpeaker === lastSpeaker
    ) {
      const alternatives = debaterNames.filter((name) => name !== lastSpeaker);
      if (alternatives.length > 0) {
        nextSpeaker = alternatives[Math.floor(Math.random() * alternatives.length)];
      }
    }

    if (!knownSpeakers.has(nextSpeaker)) {
      nextSpeaker = judgeName;
      shouldConclude = true;
    } else if (!shouldConclude && nextSpeaker === judgeName) {
      shouldConclude = true;
    }

    currentSpeaker = nextSpeaker;
  }

  const activeSpeakerNames = collectActiveSpeakerNames(transcript, panel);
  const activeParticipants = activeSpeakerNames
    .map((name) => personaByName.get(name))
    .filter((persona): persona is PersonaConfig => Boolean(persona));

  const judgment = await runJudge(question, transcript, panel.judge, activeParticipants, hooks);

  return { transcript, judgment };
}

async function runSingleTurnForAgent(
  agent: PersonaConfig,
  originalQuestion: string,
  transcript: Message[],
  transcriptWindow: number,
  debaterNameSet: Set<string>,
  hooks?: CouncilOptions["hooks"]
): Promise<void> {
  const windowSize = agent.transcriptWindow ?? transcriptWindow;
  const hasAnyAgentSpoken = transcript.some((msg) => debaterNameSet.has(msg.speaker));
  const messages = buildAgentMessages(
    agent,
    originalQuestion,
    transcript,
    windowSize,
    hasAnyAgentSpoken,
    debaterNameSet
  );

  hooks?.onAgentTurnStart?.(agent);

  const shouldStream = typeof hooks?.onAgentToken === "function";
  let rawResponse = "";
  let streamedCleanLength = 0;
  const emitCleanDelta = (cleaned: string): void => {
    if (!shouldStream || !hooks?.onAgentToken) {
      return;
    }
    const delta = cleaned.slice(streamedCleanLength);
    if (delta.length > 0) {
      hooks.onAgentToken(agent, delta);
      streamedCleanLength += delta.length;
    }
  };

  const tokenHandler =
    shouldStream
      ? (fragment: string) => {
          rawResponse += fragment;
          emitCleanDelta(cleanSpeakerOutput(rawResponse));
        }
      : (fragment: string) => {
          rawResponse += fragment;
        };

  let responseText = "";
  try {
    responseText = await streamOllamaChat(agent.model, messages, tokenHandler, {
      label: agent.name.toUpperCase(),
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    hooks?.onAgentError?.(agent, err);
    responseText = `[ERROR] ${err.message}`;
  }

  if (shouldStream && !responseText.startsWith("[ERROR]")) {
    emitCleanDelta(cleanSpeakerOutput(responseText));
  }

  const cleaned =
    !responseText.startsWith("[ERROR]")
      ? formatAgentOutput(agent.name, responseText)
      : responseText;

  transcript.push({ speaker: agent.name, content: cleaned });
  hooks?.onAgentTurnComplete?.(agent, cleaned);
}

async function runJudge(
  originalQuestion: string,
  transcript: Message[],
  judge: PersonaConfig,
  participants: PersonaConfig[],
  hooks?: CouncilOptions["hooks"]
): Promise<string> {
  const messages = buildJudgeMessages(originalQuestion, transcript, judge, participants);
  hooks?.onJudgeStart?.(judge);

  const shouldStream = typeof hooks?.onJudgeToken === "function";
  let rawJudgment = "";
  let streamedCleanLength = 0;
  const emitCleanDelta = (cleaned: string): void => {
    if (!shouldStream || !hooks?.onJudgeToken) {
      return;
    }
    const delta = cleaned.slice(streamedCleanLength);
    if (delta.length > 0) {
      hooks.onJudgeToken(delta);
      streamedCleanLength += delta.length;
    }
  };

  const tokenHandler =
    shouldStream
      ? (fragment: string) => {
          rawJudgment += fragment;
          emitCleanDelta(cleanSpeakerOutput(rawJudgment));
        }
      : (fragment: string) => {
          rawJudgment += fragment;
        };

  let judgment = "";
  try {
    judgment = await streamOllamaChat(judge.model, messages, tokenHandler, {
      label: judge.name.toUpperCase(),
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    hooks?.onJudgeError?.(err);
    throw err;
  }

  if (shouldStream) {
    emitCleanDelta(cleanSpeakerOutput(judgment));
  }

  const cleanedJudgment = cleanSpeakerOutput(judgment).trim();
  hooks?.onJudgeComplete?.(cleanedJudgment);
  transcript.push({ speaker: judge.name, content: cleanedJudgment });
  return cleanedJudgment;
}

function collectActiveSpeakerNames(transcript: Message[], panel: ActivePanel): string[] {
  const allowed = new Set(panel.debaters.map((persona) => persona.name));
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const message of transcript) {
    if (message.speaker === "User" || message.speaker === panel.judge.name) {
      continue;
    }
    if (!allowed.has(message.speaker)) {
      continue;
    }
    if (seen.has(message.speaker)) {
      continue;
    }
    seen.add(message.speaker);
    ordered.push(message.speaker);
  }

  return ordered;
}

function buildAgentMessages(
  agent: PersonaConfig,
  originalQuestion: string,
  transcript: Message[],
  transcriptWindow: number,
  hasAnyAgentSpoken: boolean,
  debaterNameSet: Set<string>
): OllamaChatMessage[] {
  const recent = transcript.slice(-transcriptWindow);
  const recap = serializeTranscript(recent) || "(no debate history yet)";
  const lastDifferentDebater = [...transcript]
    .reverse()
    .find((msg) => debaterNameSet.has(msg.speaker) && msg.speaker !== agent.name);
  const lastSelfTurn = [...transcript]
    .reverse()
    .find((msg) => msg.speaker === agent.name);

  const otherSpeakerSet = new Set<string>();
  const priorOtherSpeakers: string[] = [];
  for (const entry of transcript) {
    if (!debaterNameSet.has(entry.speaker)) {
      continue;
    }
    if (entry.speaker === agent.name) {
      continue;
    }
    if (otherSpeakerSet.has(entry.speaker)) {
      continue;
    }
    otherSpeakerSet.add(entry.speaker);
    priorOtherSpeakers.push(entry.speaker);
  }
  const allOtherDebaters = Array.from(debaterNameSet).filter((name) => name !== agent.name);
  const notYetSpeakers = allOtherDebaters.filter((name) => !otherSpeakerSet.has(name));

  const instructions: (string | undefined)[] = [
    `User Question: ${originalQuestion}`,
    "",
    "Recent transcript excerpt:",
    recap,
    "",
    `Instructions for ${agent.name}:`,
    "- Do NOT re-summarize the whole conversation or restate the question.",
    "- React to one or two of the most relevant recent points.",
    "- Add something new: a clarification, critique, or concrete next step.",
    "- Do not begin with stock phrases such as \"I'd like to respond...\" or \"I'm glad...\". Mention another agent briefly only if necessary, then dive into your core point.",
    "- Keep the tone conversational with 2–4 short paragraphs and reference other agents by name only when useful.",
    "- Refer to yourself as \"I\" or \"me\"—never by your role name—and only use other agent names when you mean them.",
    "",
    "Guidelines for this turn:",
    "- Do NOT repeat your previous arguments or restate others at length.",
    "- If your main perspective was already expressed, keep this response short and add a single fresh nuance, clarification, or agreement before yielding.",
    "- If you genuinely have nothing new, say so succinctly (1–2 sentences) and yield the floor.",
    "- Do NOT summarize the entire discussion; assume everyone remembers it.",
    "- Aim either to move the conversation forward with something new or be brief and acknowledge alignment.",
    priorOtherSpeakers.length > 0
      ? `Debaters who have already spoken: ${priorOtherSpeakers.join(", ")}.`
      : undefined,
    priorOtherSpeakers.length > 0
      ? "- Reference only points from those debaters; if you invoke anyone else, make it explicit that you are predicting rather than recapping."
      : undefined,
    notYetSpeakers.length > 0
      ? `Debaters who have not spoken yet: ${notYetSpeakers.join(", ")}.`
      : undefined,
    notYetSpeakers.length > 0
      ? "- Do NOT claim these personas already weighed in; if you speculate about them, label it clearly as a hypothesis."
      : undefined,
    !hasAnyAgentSpoken ? "First-turn constraints:" : undefined,
    !hasAnyAgentSpoken ? "No other agents have spoken yet in this conversation." : undefined,
    !hasAnyAgentSpoken ? "You are the first agent to respond to the user's question." : undefined,
    !hasAnyAgentSpoken ? "Do NOT claim that other agents already spoke." : undefined,
    !hasAnyAgentSpoken
      ? "You may hypothesize what others might argue, but make it clear it is speculative rather than a recap."
      : undefined,
    lastDifferentDebater
      ? `Previous speaker (${lastDifferentDebater.speaker}) focused on: """${compressForPrompt(
          lastDifferentDebater.content
        )}""" `
      : undefined,
    lastDifferentDebater
      ? "- Build on, challenge, or redirect that point, but do NOT simply restate it; bring a fresh angle, implication, or experiment."
      : undefined,
    lastSelfTurn
      ? `Your last contribution highlighted: """${compressForPrompt(lastSelfTurn.content)}""".`
      : undefined,
    lastSelfTurn
      ? "- Avoid repeating those same sentences. Either add a new nuance, concede alignment succinctly, or propose a concrete next step before yielding."
      : undefined,
  ];

  const userContent = instructions.filter(Boolean).join("\n");

  return [
    { role: "system", content: agent.systemPrompt },
    { role: "user", content: userContent },
  ];
}

function buildJudgeMessages(
  originalQuestion: string,
  transcript: Message[],
  judge: PersonaConfig,
  participants: PersonaConfig[]
): OllamaChatMessage[] {
  const fullTranscript = serializeTranscript(transcript) || "(empty)";
  const participantRoster =
    participants.length > 0
      ? participants.map((persona) => `- ${persona.name}: ${persona.description}`).join("\n")
      : "- (no debaters were recorded)";

  const userContent = [
    `User Question: ${originalQuestion}`,
    "",
    "Participants to summarize:",
    participantRoster,
    "",
    "Full debate transcript:",
    fullTranscript,
    "",
    "Required format:",
    "- Provide exactly one concise bullet per listed participant describing their stance. These are the only personas who spoke—do NOT mention others.",
    "- Include at most two bullets for Agreements and at most two bullets for Disagreements, covering only the most important points.",
    "- Final Recommendation must be 2–3 sentences that synthesize the debate without introducing brand-new arguments.",
    'End with a line that begins exactly with "Final Recommendation:" followed by the conclusion.',
  ].join("\n");

  return [
    { role: "system", content: judge.systemPrompt },
    { role: "user", content: userContent },
  ];
}

function serializeTranscript(messages: Message[]): string {
  return messages.map((msg) => `${msg.speaker}: ${msg.content}`).join("\n");
}

function formatAgentOutput(agentName: string, text: string): string {
  const cleaned = cleanSpeakerOutput(text);
  const artifactFree = stripSpeakerArtifacts(cleaned);
  const normalized = normalizeSelfReference(agentName, artifactFree);
  const stripped = stripClichedLeadIn(normalized);
  const trimmed = stripped.trimStart();
  if (trimmed.length > 0) {
    return trimmed;
  }
  const fallback = artifactFree.trim();
  return fallback.length > 0 ? fallback : cleaned.trim();
}

function stripSpeakerArtifacts(text: string): string {
  return text.replace(/^\s*\[([^\]]+)\]\s*/i, "");
}

function normalizeSelfReference(agentName: string, text: string): string {
  const escaped = escapeRegExp(agentName);
  const leadingTag = new RegExp(`^\\s*${escaped}\\s*[:\\-]\\s*`, "i");
  let updated = text.replace(leadingTag, "");
  const possessive = new RegExp(`(?<!\\w)${escaped}'?s(?!\\w)`, "gi");
  updated = updated.replace(possessive, "my");
  const standalone = new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "gi");
  updated = updated.replace(standalone, "I");
  return updated;
}

function stripClichedLeadIn(text: string): string {
  const patterns = [
    /^I(?:'d| would)\s+like to\s+(?:respond|add|build)[^.]*\.\s*/i,
    /^I'm\s+glad\s+[A-Za-z]+(?:'s| has)?\s+(?:mentioned|raised)[^.]*\.\s*/i,
    /^I(?:'d| would)\s+like to\s+respond to\s+[A-Za-z]+['’]s\s+(?:point|proposal|idea)[^.]*\.\s*/i,
  ];
  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, "");
  }
  return result;
}

function cleanSpeakerOutput(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/^\s*Me\s*[:,\-]\s*/i, "");
  cleaned = cleaned.replace(/^\s*Me\s+(?=[A-Za-z])/i, "");
  cleaned = cleaned.replace(/^\s*Me,\s*I\s+think\b/i, "I think");
  cleaned = cleaned.replace(/^\s*me\s+would\s+like\b/i, "I would like");
  cleaned = cleaned.replace(/([,;])?\s*\bme\s*:\s*/gi, (match: string, punct?: string) => {
    if (match.includes("\n")) {
      return punct ? `${punct} ` : "\n";
    }
    return punct ? `${punct} ` : " ";
  });
  cleaned = cleaned.replace(/^(\s*)Me(?=(agree|acknowledge|appreciate|believe|think|want|would|could|should|can|need|accept|understand|support|urge)\b)/i, (_, leading) =>
    `${leading}I `
  );
  cleaned = cleaned.replace(/^\s*\[([^\]]+)\]\s*/i, "");
  cleaned = cleaned.replace(/\s*\[\d+\](?=[\s,.;:!?)]|$)/g, "");
  cleaned = cleaned.replace(/\n+References:\s*[\s\S]*$/i, "");
  return cleaned.trimStart();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compressForPrompt(text: string, maxLength = 280): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLength - 1)}…`;
}

export const __testables = {
  runSingleTurnForAgent,
  buildAgentMessages,
  buildJudgeMessages,
  collectActiveSpeakerNames,
  cleanSpeakerOutput,
  formatAgentOutput,
  compressForPrompt,
  MAX_DEBATER_TURNS,
  DEFAULT_MAX_TURNS,
};

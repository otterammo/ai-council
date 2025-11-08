import { callOllamaChat } from "./ollamaClient";
import type { ActivePanel } from "./panels";
import type { PersonaConfig } from "./personas";
import { Message, ModeratorDecision, OllamaChatMessage } from "./types";

export async function getModeratorDecision(
  userQuestion: string,
  transcript: Message[],
  panel: ActivePanel
): Promise<ModeratorDecision> {
  const activeDebaters = panel.debaters;
  const judge = panel.judge;
  const moderator = panel.moderator;

  if (activeDebaters.length === 0) {
    return {
      nextSpeaker: judge.name,
      shouldConclude: true,
      reason: "Fallback: panel has no debaters",
    };
  }

  const debaterNames = activeDebaters.map((persona) => persona.name);
  const allowedSpeakers = Array.from(new Set([...debaterNames, judge.name]));
  const allowedSet = new Set(allowedSpeakers);

  const messages = buildModeratorMessages(
    userQuestion,
    transcript,
    moderator,
    activeDebaters,
    judge,
    allowedSpeakers
  );

  let raw = "";
  try {
    raw = await callOllamaChat(moderator.model, messages, { label: "MODERATOR" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      nextSpeaker: judge.name,
      shouldConclude: true,
      reason: `Fallback: moderator call failed (${message})`,
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (isValidModeratorDecision(parsed, allowedSet)) {
      const decision: ModeratorDecision = {
        nextSpeaker: parsed.nextSpeaker,
        shouldConclude: parsed.shouldConclude,
      };
      if (typeof parsed.reason === "string" && parsed.reason.trim().length > 0) {
        decision.reason = parsed.reason;
      }
      return decision;
    }
  } catch {
    // handled below
  }

  return {
    nextSpeaker: judge.name,
    shouldConclude: true,
    reason: "Fallback: invalid JSON from moderator",
  };
}

function buildModeratorMessages(
  userQuestion: string,
  transcript: Message[],
  moderator: PersonaConfig,
  debaters: PersonaConfig[],
  judge: PersonaConfig,
  allowedSpeakers: string[]
): OllamaChatMessage[] {
  const debaterSet = new Set(debaters.map((persona) => persona.name));
  const recentTranscript =
    transcript
      .slice(-8)
      .map((message) => `${message.speaker}: ${message.content}`)
      .join("\n\n") || "(conversation not started yet)";

  const lastNonUser =
    [...transcript]
      .reverse()
      .find((message) => message.speaker !== "User")?.speaker ?? "none";

  const debaterMessages = transcript.filter((message) => debaterSet.has(message.speaker));
  const debaterTurnCount = debaterMessages.length;
  const recentDebaterSpeakers =
    debaterMessages
      .slice(-3)
      .map((message) => message.speaker)
      .join(" -> ") || "none yet";

  const participantRoster = [
    ...debaters.map((persona) => `- ${persona.name}: ${persona.description}`),
    `- ${judge.name}: ${judge.description} (final summarizer)`,
  ];

  const systemPrompt = [
    moderator.systemPrompt.trim(),
    "",
    "Participants:",
    ...participantRoster,
  ]
    .filter(Boolean)
    .join("\n");

  const userContent = [
    `User's question:`,
    `"${userQuestion}"`,
    "",
    "Recent transcript (most recent last):",
    recentTranscript,
    "",
    `Last non-user speaker: ${lastNonUser}. Avoid selecting the same agent twice in a row unless absolutely necessary.`,
    `Debater turns used so far: ${debaterTurnCount}. Target total debater turns: about 6-8.`,
    `Recent debater speaker order (oldest to newest): ${recentDebaterSpeakers}.`,
    "",
    `Valid nextSpeaker values (case-sensitive): ${allowedSpeakers.join(", ")}`,
    `When it's time for ${judge.name}, set nextSpeaker to "${judge.name}" and shouldConclude to true.`,
    "",
    "Decide which participant should speak next, and whether we should conclude.",
    "If recent turns repeat similar themes or the discussion feels resolved, select the judge and conclude immediately.",
    "If you are unsure a new debater turn would add meaningful novelty, hand off to the judge instead of stalling.",
    "Respond with JSON only using exactly the fields nextSpeaker, shouldConclude, and reason.",
  ].join("\n");

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
}

function isValidModeratorDecision(
  candidate: unknown,
  allowedSpeakers: Set<string>
): candidate is ModeratorDecision {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  return (
    typeof record.nextSpeaker === "string" &&
    allowedSpeakers.has(record.nextSpeaker) &&
    typeof record.shouldConclude === "boolean" &&
    (record.reason === undefined || typeof record.reason === "string")
  );
}

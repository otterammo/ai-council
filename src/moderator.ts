import { callOllamaChat } from "./ollamaClient";
import { Message, ModeratorDecision, SpeakerName, OllamaChatMessage } from "./types";

const MODERATOR_MODEL =
  process.env.COUNCIL_MODERATOR_MODEL?.trim() ||
  process.env.COUNCIL_DEFAULT_MODEL?.trim() ||
  "llama3.1:8b";

const moderatorSystemPrompt = `
You are Moderator, an invisible conductor of a small AI roundtable.

Participants:
- Analyst: skeptical, precise, clarifies assumptions.
- Optimist: constructive, solution-focused.
- Critic: rigorous, surfaces blind spots and failure modes.
- Judge: neutral summarizer who gives the final recommendation.

Your role:
- You do NOT speak to the user.
- You do NOT appear in the transcript.
- You silently decide which participant should speak next.
- You also decide when the discussion has gone far enough and it is time for the Judge to conclude.

Guidelines:
- You are managing a short, focused discussion with a very limited budget of roughly 6–8 total debater turns (Analyst/Optimist/Critic) before the Judge.
- Track how many debater turns have already happened, and err on concluding once they approach that budget.
- Early turns should surface distinct perspectives; middle turns should clarify disagreements; final turns should push toward convergence and close open items.
- Keep the discussion balanced. Do not let one voice dominate unless it is clearly helpful.
- Prefer alternating perspectives (e.g., Analyst → Optimist → Critic → Analyst …) when reasonable.
- Avoid selecting the same speaker twice in a row unless there is a compelling reason and the others have already had a fair chance to respond.
- You may choose the same speaker consecutively only if they must clarify or correct something crucial and this benefits the conversation.
- If the last two or three debater turns are variations on the same themes and no clearly new angle seems likely, almost always transition to the Judge.
- If you are unsure whether a new debater turn would add real novelty, prefer to conclude with the Judge instead.
- Do not drag the debate out just to restate prior arguments. When diminishing returns appear, set nextSpeaker to "Judge" and shouldConclude to true.
- Once the core disagreement or key insights are on the table, hand off to the Judge for the summary and recommendation.

Output format:
- You MUST respond with VALID JSON ONLY, no extra text, in this shape:

{
  "nextSpeaker": "Analyst" | "Optimist" | "Critic" | "Judge",
  "shouldConclude": boolean,
  "reason": "short explanation for logging"
}

Do not include any other keys. Do not wrap the JSON in code fences.
`.trim();

export async function getModeratorDecision(
  userQuestion: string,
  transcript: Message[]
): Promise<ModeratorDecision> {
  const recent = transcript
    .slice(-8)
    .map((message) => `${message.speaker}: ${message.content}`)
    .join("\n\n");

  const lastNonUser =
    [...transcript]
      .reverse()
      .find((message) => message.speaker !== "User")?.speaker ?? "none";

  const debaterMessages = transcript.filter(
    (message) =>
      message.speaker === "Analyst" ||
      message.speaker === "Optimist" ||
      message.speaker === "Critic"
  );
  const debaterTurnCount = debaterMessages.length;
  const recentDebaterSpeakers =
    debaterMessages
      .slice(-3)
      .map((message) => message.speaker)
      .join(" -> ") || "none yet";

  const messages: OllamaChatMessage[] = [
    { role: "system", content: moderatorSystemPrompt },
    {
      role: "user",
      content: [
        `User's question:`,
        `"${userQuestion}"`,
        "",
        "Recent transcript (most recent last):",
        recent || "(conversation not started yet)",
        "",
        `Last non-user speaker: ${lastNonUser}. Avoid selecting the same agent twice in a row unless it is absolutely necessary.`,
        `Debater turns used so far: ${debaterTurnCount}. Target total debater turns: about 6-8.`,
        `Recent debater speaker order (oldest to newest): ${recentDebaterSpeakers}.`,
        "",
        "Decide which participant should speak next, and whether we should conclude.",
        "If the recent turns are repeating similar themes or the discussion feels resolved, select Judge and conclude immediately.",
        "If you are unsure a new debater turn will add real novelty, hand off to the Judge instead of stalling.",
        "Remember: respond with JSON only. If it's time for the Judge, set nextSpeaker to \"Judge\" and shouldConclude to true.",
      ].join("\n"),
    },
  ];

  let raw = "";
  try {
    raw = await callOllamaChat(MODERATOR_MODEL, messages, { label: "MODERATOR" });
  } catch (error) {
    return {
      nextSpeaker: "Judge",
      shouldConclude: true,
      reason: `Fallback: moderator call failed (${error instanceof Error ? error.message : String(
        error
      )})`,
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.nextSpeaker === "string" &&
      isSpeakerName(parsed.nextSpeaker) &&
      typeof parsed.shouldConclude === "boolean"
    ) {
      return parsed as ModeratorDecision;
    }
  } catch {
    // handled below
  }

  return {
    nextSpeaker: "Judge",
    shouldConclude: true,
    reason: "Fallback: invalid JSON from moderator",
  };
}

function isSpeakerName(value: string): value is SpeakerName {
  return value === "Analyst" || value === "Optimist" || value === "Critic" || value === "Judge";
}

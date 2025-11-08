import fs from "node:fs";
import path from "node:path";

import type { PersonaConfig, PersonaRole } from "./personas";

const BASE_MODEL = "llama3.1:8b";
const ENV_DEFAULT_MODEL = process.env.COUNCIL_DEFAULT_MODEL?.trim();
const ENV_MODERATOR_MODEL = process.env.COUNCIL_MODERATOR_MODEL?.trim();

export const DEFAULT_MODEL = ENV_DEFAULT_MODEL || BASE_MODEL;
const DEFAULT_MODERATOR_MODEL = ENV_MODERATOR_MODEL || DEFAULT_MODEL;

const BUILT_IN_ORDER = ["Analyst", "Optimist", "Critic", "Judge", "Moderator"];
const BUILTIN_PERSONA_DIR = path.resolve(__dirname, "../personas/default");

const partitioned = partitionBuiltins(loadBuiltinPersonas());

export const DEFAULT_DEBATER_PERSONAS = partitioned.debaters.map(clonePersona);
export const DEFAULT_JUDGE_PERSONA = clonePersona(partitioned.judge);
export const DEFAULT_MODERATOR_PERSONA = clonePersona(partitioned.moderator);
export const DEFAULT_PERSONAS = [
  ...partitioned.debaters,
  partitioned.judge,
  partitioned.moderator,
].map(clonePersona);

export const DEFAULT_TRANSCRIPT_WINDOW = 10;

function loadBuiltinPersonas(): PersonaConfig[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(BUILTIN_PERSONA_DIR, { withFileTypes: true });
  } catch (error) {
    console.warn(
      `[personas] Could not access built-in persona directory "${BUILTIN_PERSONA_DIR}": ${String(
        error
      )}`
    );
    return getLegacyFallbackPersonas();
  }

  const personas: PersonaConfig[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) {
      continue;
    }
    const fullPath = path.join(BUILTIN_PERSONA_DIR, entry.name);
    const persona = readPersonaFile(fullPath);
    if (persona) {
      personas.push(persona);
    }
  }

  if (personas.length === 0) {
    console.warn(
      `[personas] No built-in persona JSON files were loaded from "${BUILTIN_PERSONA_DIR}". Falling back to legacy defaults.`
    );
    return getLegacyFallbackPersonas();
  }

  return sortByPreferredOrder(personas);
}

function readPersonaFile(fullPath: string): PersonaConfig | null {
  let raw = "";
  try {
    raw = fs.readFileSync(fullPath, "utf8");
  } catch (error) {
    console.warn(`[personas] Failed to read built-in persona "${fullPath}": ${String(error)}`);
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return normalizePersonaFromDisk(parsed, fullPath);
  } catch (error) {
    console.warn(`[personas] Failed to parse built-in persona "${fullPath}": ${String(error)}`);
    return null;
  }
}

function normalizePersonaFromDisk(candidate: unknown, source: string): PersonaConfig | null {
  if (!candidate || typeof candidate !== "object") {
    console.warn(`[personas] ${source} must contain a JSON object.`);
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const roleType = typeof record.roleType === "string" ? record.roleType.trim() : "";
  const description =
    typeof record.description === "string" ? record.description.trim() : "";
  const systemPrompt =
    typeof record.systemPrompt === "string" ? record.systemPrompt : "";
  const transcriptWindow =
    typeof record.transcriptWindow === "number" && Number.isFinite(record.transcriptWindow)
      ? record.transcriptWindow
      : undefined;

  if (!name) {
    console.warn(`[personas] ${source} is missing a non-empty "name" field.`);
    return null;
  }
  if (!isPersonaRole(roleType)) {
    console.warn(
      `[personas] ${source} has invalid "roleType". Expected one of debater, judge, or moderator.`
    );
    return null;
  }
  if (!description) {
    console.warn(`[personas] ${source} is missing a "description" field.`);
    return null;
  }
  if (!systemPrompt) {
    console.warn(`[personas] ${source} is missing a "systemPrompt" field.`);
    return null;
  }

  const providedModel =
    typeof record.model === "string" && record.model.trim().length > 0
      ? record.model.trim()
      : undefined;

  const persona: PersonaConfig = {
    name,
    roleType,
    description,
    systemPrompt,
    model: resolveModel(roleType, providedModel),
  };

  if (transcriptWindow && transcriptWindow > 0) {
    persona.transcriptWindow = transcriptWindow;
  }

  return persona;
}

function resolveModel(role: PersonaRole, provided?: string): string {
  if (role === "moderator") {
    return ENV_MODERATOR_MODEL || provided || DEFAULT_MODERATOR_MODEL;
  }
  return ENV_DEFAULT_MODEL || provided || DEFAULT_MODEL;
}

function partitionBuiltins(
  personas: PersonaConfig[],
  allowFallback = true
): {
  debaters: PersonaConfig[];
  judge: PersonaConfig;
  moderator: PersonaConfig;
} {
  const debaters = personas.filter((persona) => persona.roleType === "debater");
  const judge = personas.find((persona) => persona.roleType === "judge");
  const moderator = personas.find((persona) => persona.roleType === "moderator");

  if (!judge || !moderator || debaters.length === 0) {
    console.warn(
      "[personas] Built-in persona set was incomplete. Falling back to legacy embedded defaults."
    );
    if (allowFallback) {
      return partitionBuiltins(getLegacyFallbackPersonas(), false);
    }
    throw new Error("Built-in personas could not be initialized.");
  }

  return {
    debaters,
    judge,
    moderator,
  };
}

function getLegacyFallbackPersonas(): PersonaConfig[] {
  return [
    {
      name: "Analyst",
      roleType: "debater",
      description: "Skeptical systems thinker who stresses clarity and explicit assumptions.",
      model: resolveModel("debater"),
      systemPrompt: `You are Analyst, a skeptical and methodical thinker in a short, focused roundtable with Optimist and Critic.
Stay focused on structure, clarity, and explicit assumptions, and reference other agents by name only when discussing their ideas.
Refer to yourself as "I" or "me"—never as "Analyst".
You have a limited number of turns (roughly 6–8 total across the group), so avoid repeating yourself or restating long chunks of the debate.
If your main point has already been voiced by you or someone else, keep the response brief (1–3 sentences) and add at most one new nuance or clarifying distinction.
It is acceptable to say you mostly agree and yield the floor.
Do not re-summarize the entire conversation; assume everyone remembers it.
When you do speak, introduce at most 1–2 precise distinctions or questions that move the discussion forward.
If the transcript contains only the User and no other agents, treat this as the first turn and do not refer to other agents having spoken already.`,
    },
    {
      name: "Optimist",
      roleType: "debater",
      description: "Grounded builder who steers toward practical solutions and convergence.",
      model: resolveModel("debater"),
      systemPrompt: `You are Optimist, a constructive problem solver collaborating with Analyst and Critic in a brief, high-signal conversation.
Keep the tone grounded yet hopeful, sketching practical next steps or compromises that move things forward.
Refer to yourself only as "I" or "me", and use other agent names solely when discussing their ideas.
The council only has a handful of turns, so do not restate earlier arguments unless you can add a concrete twist.
If your main perspective is already represented, keep it short (1–3 sentences) and add just one fresh experiment, metric, or practical direction before yielding.
It is acceptable to agree succinctly and focus on convergence.
Avoid rehashing everything—react to the most important current tension and advance it pragmatically.
If the transcript contains only the User and no other agents, treat this as the first turn and do not refer to other agents having spoken already.`,
    },
    {
      name: "Critic",
      roleType: "debater",
      description: "Rigorous reviewer spotlighting blind spots, risks, and missing contingencies.",
      model: resolveModel("debater"),
      systemPrompt: `You are Critic, a rigorous reviewer who partners with Analyst and Optimist in a concise discussion.
Refer to yourself with "I" or "me"—never call yourself "Critic"—and name the others only when you are examining their ideas.
The group only has a small number of turns, so focus each contribution on 1–2 specific weaknesses, failure modes, or missing contingencies.
If those risks were already flagged, be brief (1–3 sentences) and add one new angle or concede agreement.
It is acceptable to state that the remaining concerns are covered and cede time.
Skip broad recaps—zero in on the latest assumptions or proposals—and avoid stock openers so you can immediately pressure-test the freshest claims.
If the transcript contains only the User and no other agents, treat this as the first turn and do not refer to other agents having spoken already.`,
    },
    {
      name: "Judge",
      roleType: "judge",
      description: "Neutral synthesizer who delivers the final summary and recommendation.",
      model: resolveModel("judge"),
      systemPrompt: `You are Judge, a neutral synthesizer observing Analyst, Optimist, and Critic.
Summarize each visible agent's stance in exactly one concise bullet per agent.
Provide at most two bullets for Agreements and at most two bullets for Disagreements, covering only the most important areas of alignment or tension.
Keep the overall tone impartial, avoid repeating detailed arguments, and focus on the core tension that remains.
Your Final Recommendation must be 2–3 sentences that synthesize the debate, highlight the decisive trade-off, and clearly state the preferred direction without adding brand-new arguments.
End with a line that begins exactly with "Final Recommendation:" followed by your conclusion.`,
    },
    {
      name: "Moderator",
      roleType: "moderator",
      description: "Invisible conductor that balances turns and decides when to conclude.",
      model: resolveModel("moderator"),
      systemPrompt: `You are Moderator, an invisible conductor of a small AI roundtable.

Your duties:
- You never speak to the user or appear in the transcript.
- You silently decide which participant should speak next.
- You determine when the discussion should conclude and hand off to the Judge.

Guidelines:
- The debate budget is short (roughly 6–8 debater turns in total) before the Judge concludes.
- Keep the discussion balanced and avoid letting one persona dominate.
- Prefer alternating perspectives unless there is a compelling reason for back-to-back turns.
- When the conversation starts repeating or the core insights are already on the table, transition to the Judge.
- If uncertain whether a new turn adds meaningfully new information, conclude instead of stalling.

Output format:
Respond with VALID JSON only:
{
  "nextSpeaker": "PersonaName",
  "shouldConclude": boolean,
  "reason": "short explanation for logging"
}

"nextSpeaker" must be drawn from the upcoming participant roster or set to the Judge when concluding.`,
    },
  ];
}

function sortByPreferredOrder(personas: PersonaConfig[]): PersonaConfig[] {
  const orderMap = new Map(BUILT_IN_ORDER.map((name, index) => [name, index]));
  return [...personas].sort((a, b) => {
    const aIndex = orderMap.get(a.name) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = orderMap.get(b.name) ?? Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }
    return a.name.localeCompare(b.name);
  });
}

function isPersonaRole(role: string): role is PersonaRole {
  return role === "debater" || role === "judge" || role === "moderator";
}

function clonePersona(config: PersonaConfig): PersonaConfig {
  return { ...config };
}

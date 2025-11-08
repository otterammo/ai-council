import { promises as fs } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";

import {
  DEFAULT_DEBATER_PERSONAS,
  DEFAULT_JUDGE_PERSONA,
  DEFAULT_MODERATOR_PERSONA,
  DEFAULT_PERSONAS,
  ensureCitationGuardrails,
} from "./agents";

/**
 * Persona files live in an optional directory (default: ./personas) where each JSON file
 * describes a single participant. Example schema:
 *
 * {
 *   "name": "Skeptic",
 *   "roleType": "debater",
 *   "model": "llama3.1:8b",
 *   "description": "Zooms in on assumptions and data gaps.",
 *   "systemPrompt": "Full system prompt..."
 * }
 *
 * Save multiple files to add multiple personas. A file name collision replaces the built-in
 * persona with the custom one, while new names extend the council. Files may live directly in
 * ./personas or be organized into subdirectories such as ./personas/debaters/, ./personas/judges/,
 * etc.—the loader recursively scans the entire tree.
 */

export type PersonaRole = "debater" | "judge" | "moderator";

export interface PersonaConfig {
  name: string;
  roleType: PersonaRole;
  model: string;
  description: string;
  systemPrompt: string;
  transcriptWindow?: number;
}

export interface LoadedPersonas {
  debaters: PersonaConfig[];
  judge: PersonaConfig;
  moderator: PersonaConfig;
}

interface LoadOptions {
  personasDir?: string;
}

const ROLE_VALUES: PersonaRole[] = ["debater", "judge", "moderator"];

export async function loadPersonas(options?: LoadOptions): Promise<LoadedPersonas> {
  const { resolvedDir, source } = resolvePersonasDir(options);
  const personaOrder: string[] = [];
  const orderSet = new Set<string>();
  const personaMap = new Map<string, PersonaConfig>();

  for (const persona of DEFAULT_PERSONAS) {
    personaOrder.push(persona.name);
    orderSet.add(persona.name);
    personaMap.set(persona.name, clonePersona(persona));
  }

  const fileConfigs = await loadPersonaFiles(resolvedDir, source !== "default");
  for (const persona of fileConfigs) {
    if (!orderSet.has(persona.name)) {
      personaOrder.push(persona.name);
      orderSet.add(persona.name);
    }
    personaMap.set(persona.name, clonePersona(persona));
  }

  const ordered: PersonaConfig[] = personaOrder
    .map((name) => personaMap.get(name))
    .filter((entry): entry is PersonaConfig => Boolean(entry))
    .map(clonePersona);

  const preferredJudgeName = fileConfigs.find((p) => p.roleType === "judge")?.name;
  const preferredModeratorName = fileConfigs.find((p) => p.roleType === "moderator")?.name;

  let debaters = ordered.filter((p) => p.roleType === "debater");
  if (debaters.length === 0) {
    console.warn(
      "[personas] No debater personas found. Falling back to the default Rationalist-led panel."
    );
    debaters = DEFAULT_DEBATER_PERSONAS.map(clonePersona);
  }

  const judgeSource =
    (preferredJudgeName ? personaMap.get(preferredJudgeName) : undefined) ??
    ordered.find((p) => p.roleType === "judge") ??
    DEFAULT_JUDGE_PERSONA;
  const judge = clonePersona(judgeSource);

  const moderatorSource =
    (preferredModeratorName ? personaMap.get(preferredModeratorName) : undefined) ??
    ordered.find((p) => p.roleType === "moderator") ??
    DEFAULT_MODERATOR_PERSONA;
  const moderator = clonePersona(moderatorSource);

  return {
    debaters,
    judge,
    moderator,
  };
}

async function loadPersonaFiles(
  personasDir: string,
  warnWhenMissing: boolean
): Promise<PersonaConfig[]> {
  const results: PersonaConfig[] = [];

  let stats: Stats;
  try {
    stats = await fs.stat(personasDir);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      if (warnWhenMissing) {
        console.warn(`[personas] Persona directory "${personasDir}" was not found.`);
      }
    } else {
      console.warn(`[personas] Unable to access directory "${personasDir}": ${String(error)}`);
    }
    return results;
  }

  if (!stats.isDirectory()) {
    console.warn(`[personas] Path "${personasDir}" is not a directory; skipping persona files.`);
    return results;
  }

  const filePaths = await collectPersonaFilePaths(personasDir);
  for (const fullPath of filePaths) {
    try {
      const raw = await fs.readFile(fullPath, "utf8");
      const parsed = JSON.parse(raw);
      const persona = validatePersonaConfig(parsed, fullPath);
      if (persona) {
        results.push(clonePersona(persona));
      }
    } catch (error) {
      console.warn(`[personas] Failed to parse ${fullPath}: ${String(error)}`);
    }
  }

  return results;
}

async function collectPersonaFilePaths(dir: string): Promise<string[]> {
  const files: string[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    console.warn(`[personas] Failed to read directory "${dir}": ${String(error)}`);
    return files;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectPersonaFilePaths(fullPath);
      files.push(...nested);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files;
}

function validatePersonaConfig(candidate: unknown, source: string): PersonaConfig | null {
  if (!candidate || typeof candidate !== "object") {
    console.warn(`[personas] ${source} must contain a JSON object.`);
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const roleType = typeof record.roleType === "string" ? record.roleType.trim() : "";
  const model = typeof record.model === "string" ? record.model.trim() : "";
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
  if (!ROLE_VALUES.includes(roleType as PersonaRole)) {
    console.warn(
      `[personas] ${source} has invalid "roleType". Expected one of ${ROLE_VALUES.join(
        ", "
      )}.`
    );
    return null;
  }
  if (!model) {
    console.warn(`[personas] ${source} is missing a "model" field.`);
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

  const persona: PersonaConfig = {
    name,
    roleType: roleType as PersonaRole,
    model,
    description,
    systemPrompt,
  };

  if (transcriptWindow && transcriptWindow > 0) {
    persona.transcriptWindow = transcriptWindow;
  }

  return persona;
}

function clonePersona(config: PersonaConfig): PersonaConfig {
  return ensureCitationGuardrails({ ...config });
}

function resolvePersonasDir(
  options?: LoadOptions
): { resolvedDir: string; source: "cli" | "env" | "default" } {
  const cliDir = options?.personasDir?.trim();
  if (cliDir) {
    return { resolvedDir: path.resolve(process.cwd(), cliDir), source: "cli" };
  }

  const envDir = process.env.AI_COUNCIL_PERSONAS_DIR?.trim();
  if (envDir) {
    return {
      resolvedDir: path.resolve(process.cwd(), envDir),
      source: "env",
    };
  }

  return { resolvedDir: path.resolve(process.cwd(), "personas"), source: "default" };
}

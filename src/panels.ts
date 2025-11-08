import fs from "node:fs";
import path from "node:path";

import type { LoadedPersonas, PersonaConfig } from "./personas";

export interface PanelDefinition {
  name: string;
  debaters: string[];
  judge?: string;
  moderator?: string;
}

export interface PanelConfigFile {
  panels: PanelDefinition[];
}

export interface ActivePanel {
  name: string;
  debaters: PersonaConfig[];
  judge: PersonaConfig;
  moderator: PersonaConfig;
}

export const DEFAULT_PANEL_NAME = "core";

export const BUILTIN_PANELS: PanelDefinition[] = [
  {
    name: DEFAULT_PANEL_NAME,
    debaters: ["Rationalist", "Empiricist", "Pragmatist", "Humanist", "Skeptic"],
  },
];

export function loadPanelDefinitions(): PanelDefinition[] {
  const map = new Map<string, PanelDefinition>();
  const normalize = (value: string) => value.trim().toLowerCase();

  for (const panel of BUILTIN_PANELS) {
    map.set(normalize(panel.name), normalizePanel(panel));
  }

  for (const panel of loadUserPanels()) {
    map.set(normalize(panel.name), normalizePanel(panel));
  }

  return Array.from(map.values());
}

export function resolveActivePanel(
  personas: LoadedPersonas,
  preferredPanelName?: string
): ActivePanel {
  const panelDefs = loadPanelDefinitions();
  const normalize = (value: string) => value.trim().toLowerCase();
  const byName = new Map(panelDefs.map((panel) => [normalize(panel.name), panel]));

  let resolvedDefinition: PanelDefinition | undefined;
  const requested = preferredPanelName?.trim();
  if (requested) {
    resolvedDefinition = byName.get(normalize(requested));
    if (!resolvedDefinition) {
      console.warn(
        `[panel] Panel "${requested}" was not found. Falling back to "${DEFAULT_PANEL_NAME}".`
      );
    }
  }

  if (!resolvedDefinition) {
    resolvedDefinition = byName.get(normalize(DEFAULT_PANEL_NAME));
  }

  if (!resolvedDefinition && panelDefs.length > 0) {
    resolvedDefinition = panelDefs[0];
  }

  const active = resolvedDefinition
    ? resolveActivePanelFromDefinition(resolvedDefinition, personas)
    : buildFallbackPanel(personas);

  const roster = active.debaters.map((persona) => persona.name).join(", ") || "(none)";
  console.log(`[panel] Active panel "${active.name}" with debaters: ${roster}`);

  return active;
}

function resolveActivePanelFromDefinition(
  panelDef: PanelDefinition,
  personas: LoadedPersonas
): ActivePanel {
  const debaterMap = new Map(
    personas.debaters.map((persona) => [persona.name.toLowerCase(), persona])
  );
  const resolvedDebaters: PersonaConfig[] = [];
  const missing: string[] = [];

  for (const rawName of panelDef.debaters) {
    const name = rawName.trim();
    if (!name) {
      continue;
    }
    const persona = debaterMap.get(name.toLowerCase());
    if (persona) {
      resolvedDebaters.push(persona);
    } else {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    console.warn(
      `[panel] Debater persona(s) not found for panel "${panelDef.name}": ${missing.join(", ")}`
    );
  }

  const finalDebaters =
    resolvedDebaters.length > 0
      ? resolvedDebaters
      : personas.debaters.length > 0
        ? personas.debaters
        : [];

  if (resolvedDebaters.length === 0 && personas.debaters.length > 0) {
    console.warn(
      `[panel] Panel "${panelDef.name}" did not resolve any debaters. Using all loaded debaters instead.`
    );
  }

  return {
    name: panelDef.name,
    debaters: finalDebaters,
    judge: resolveJudge(panelDef, personas),
    moderator: resolveModerator(panelDef, personas),
  };
}

function resolveJudge(panelDef: PanelDefinition, personas: LoadedPersonas): PersonaConfig {
  if (!panelDef.judge) {
    return personas.judge;
  }
  if (equalsIgnoreCase(panelDef.judge, personas.judge.name)) {
    return personas.judge;
  }
  console.warn(
    `[panel] Requested judge "${panelDef.judge}" was not found. Using ${personas.judge.name}.`
  );
  return personas.judge;
}

function resolveModerator(panelDef: PanelDefinition, personas: LoadedPersonas): PersonaConfig {
  if (!panelDef.moderator) {
    return personas.moderator;
  }
  if (equalsIgnoreCase(panelDef.moderator, personas.moderator.name)) {
    return personas.moderator;
  }
  console.warn(
    `[panel] Requested moderator "${panelDef.moderator}" was not found. Using ${personas.moderator.name}.`
  );
  return personas.moderator;
}

function buildFallbackPanel(personas: LoadedPersonas): ActivePanel {
  return {
    name: DEFAULT_PANEL_NAME,
    debaters: personas.debaters,
    judge: personas.judge,
    moderator: personas.moderator,
  };
}

function loadUserPanels(): PanelDefinition[] {
  const cwd = process.cwd();
  const configPath = path.join(cwd, "panels.json");

  if (!fs.existsSync(configPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as PanelConfigFile;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.panels)) {
      console.warn(`[panel] panels.json did not contain a "panels" array. Ignoring file.`);
      return [];
    }
    return parsed.panels
      .map((candidate) => sanitizePanelDefinition(candidate))
      .filter((panel): panel is PanelDefinition => Boolean(panel));
  } catch (error) {
    console.warn(`[panel] Failed to parse panels.json: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function sanitizePanelDefinition(candidate: unknown): PanelDefinition | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) {
    console.warn("[panel] Ignoring panel entry without a name.");
    return null;
  }

  const debaters = Array.isArray(record.debaters)
    ? record.debaters
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];

  const judge =
    typeof record.judge === "string" && record.judge.trim().length > 0
      ? record.judge.trim()
      : undefined;

  const moderator =
    typeof record.moderator === "string" && record.moderator.trim().length > 0
      ? record.moderator.trim()
      : undefined;

  return {
    name,
    debaters,
    judge,
    moderator,
  };
}

function normalizePanel(panel: PanelDefinition): PanelDefinition {
  return {
    name: panel.name.trim(),
    debaters: dedupe(panel.debaters),
    judge: panel.judge?.trim() || undefined,
    moderator: panel.moderator?.trim() || undefined,
  };
}

function dedupe(values: string[] = []): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function equalsIgnoreCase(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

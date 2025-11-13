import path from "node:path";
import { vi } from "vitest";

import {
  DEFAULT_DEBATER_PERSONAS,
  DEFAULT_JUDGE_PERSONA,
  DEFAULT_MODERATOR_PERSONA,
} from "../../src/agents";
import type { LoadedPersonas, PersonaConfig } from "../../src/personas";

export function fixturePath(...segments: string[]): string {
  return path.join(__dirname, "..", "fixtures", ...segments);
}

export function mockCwd(nextCwd: string): () => void {
  const spy = vi.spyOn(process, "cwd").mockReturnValue(nextCwd);
  return () => spy.mockRestore();
}

export function clonePersona<T extends PersonaConfig>(persona: T): T {
  return JSON.parse(JSON.stringify(persona)) as T;
}

export function buildPersona(partial: Partial<PersonaConfig> & { name: string }): PersonaConfig {
  return {
    ...clonePersona(DEFAULT_DEBATER_PERSONAS[0]),
    ...partial,
  };
}

export function createLoadedPersonas(
  overrides: Partial<LoadedPersonas> = {}
): LoadedPersonas {
  return {
    debaters: overrides.debaters?.map(clonePersona) ?? DEFAULT_DEBATER_PERSONAS.map(clonePersona),
    judge: overrides.judge ? clonePersona(overrides.judge) : clonePersona(DEFAULT_JUDGE_PERSONA),
    moderator: overrides.moderator
      ? clonePersona(overrides.moderator)
      : clonePersona(DEFAULT_MODERATOR_PERSONA),
  };
}

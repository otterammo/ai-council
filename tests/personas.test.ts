import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DEBATER_PERSONAS } from "../src/agents";
import { loadPersonas, validatePersonaConfig } from "../src/personas";
import { fixturePath } from "./helpers/testUtils";

afterEach(() => {
  delete process.env.AI_COUNCIL_PERSONAS_DIR;
  vi.restoreAllMocks();
});

describe("loadPersonas", () => {
  it("falls back to default debaters when no debater personas exist", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const personas = await loadPersonas({
      personasDir: fixturePath("personas", "no-debaters"),
    });

    expect(personas.debaters).toHaveLength(DEFAULT_DEBATER_PERSONAS.length);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("No debater personas found")
    );
  });

  it("prefers CLI personas dir over env var and appends guardrails once", async () => {
    process.env.AI_COUNCIL_PERSONAS_DIR = fixturePath("personas", "env-overrides");

    const personas = await loadPersonas({
      personasDir: fixturePath("personas", "cli-overrides"),
    });

    const names = personas.debaters.map((persona) => persona.name);
    expect(names).toContain("Visionary");
    expect(names).not.toContain("OpsChief");

    const visionary = personas.debaters.find((p) => p.name === "Visionary");
    expect(visionary).toBeDefined();
    const guardrailMatches =
      visionary?.systemPrompt.match(/\[AI Council Citation Guardrails\]/g) ?? [];
    expect(guardrailMatches).toHaveLength(1);
  });
});

describe("validatePersonaConfig", () => {
  const basePersona = {
    name: "Tester",
    roleType: "debater",
    model: "llama3.1:8b",
    description: "Ensures configs validate.",
    systemPrompt: "Keep answers short.",
  };

  it("enforces required fields and transcript window constraints", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const valid = validatePersonaConfig(basePersona, "fixture");
    expect(valid).not.toBeNull();
    expect(valid?.transcriptWindow).toBeUndefined();

    const withPositiveWindow = validatePersonaConfig(
      { ...basePersona, transcriptWindow: 3 },
      "fixture"
    );
    expect(withPositiveWindow?.transcriptWindow).toBe(3);

    const withZeroWindow = validatePersonaConfig(
      { ...basePersona, transcriptWindow: 0 },
      "fixture"
    );
    expect(withZeroWindow?.transcriptWindow).toBeUndefined();

    warnSpy.mockClear();
    const missingModel = validatePersonaConfig({ ...basePersona, model: "" }, "fixture");
    expect(missingModel).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });
});

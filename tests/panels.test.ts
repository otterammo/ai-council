import { afterEach, describe, expect, it, vi } from "vitest";

import { createLoadedPersonas, buildPersona, fixturePath, mockCwd } from "./helpers/testUtils";
import { loadPanelDefinitions, resolveActivePanel } from "../src/panels";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveActivePanel", () => {
  it("warns when configured debaters are missing and falls back to loaded debaters", () => {
    const restoreCwd = mockCwd(fixturePath("workspaces", "panels-missing"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const personas = createLoadedPersonas({
      debaters: [
        buildPersona({ name: "Visionary", model: "llama3.1:8b", description: "Visionary", systemPrompt: "Go big." }),
        buildPersona({ name: "DeliveryLead", model: "gemma2:9b", description: "Deliver", systemPrompt: "Ship safely." }),
      ],
    });

    const panel = resolveActivePanel(personas, "custom");

    expect(panel.debaters.map((p) => p.name)).toEqual(personas.debaters.map((p) => p.name));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Debater persona(s) not found')
    );

    restoreCwd();
    logSpy.mockRestore();
  });

  it("honors custom judge/moderator names and dedupes debaters", () => {
    const restoreCwd = mockCwd(fixturePath("workspaces", "panels-custom"));

    const judge = buildPersona({
      name: "Oracle",
      roleType: "judge",
      model: "llama3.1:8b",
      description: "Judge who values clarity.",
      systemPrompt: "Judge fairly.",
    });
    const moderator = buildPersona({
      name: "OpsModerator",
      roleType: "moderator",
      model: "llama3.1:8b",
      description: "Moderator ensures balance.",
      systemPrompt: "Keep order.",
    });

    const personas = createLoadedPersonas({
      debaters: [
        buildPersona({ name: "Visionary", model: "llama3.1:8b", description: "Visionary", systemPrompt: "Go big." }),
        buildPersona({ name: "DeliveryLead", model: "gemma2:9b", description: "Deliver", systemPrompt: "Ship safely." }),
      ],
      judge,
      moderator,
    });

    const panel = resolveActivePanel(personas, "product");
    expect(panel.debaters.map((p) => p.name)).toEqual(["Visionary", "DeliveryLead"]);
    expect(panel.judge.name).toBe("Oracle");
    expect(panel.moderator.name).toBe("OpsModerator");

    restoreCwd();
  });
});

describe("loadPanelDefinitions", () => {
  it("ignores invalid panels.json files that lack a panels array", () => {
    const restoreCwd = mockCwd(fixturePath("workspaces", "panels-invalid"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const panels = loadPanelDefinitions();
    expect(panels.length).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('did not contain a "panels" array')
    );

    restoreCwd();
  });
});

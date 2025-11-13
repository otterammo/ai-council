import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/ollamaClient", () => ({
  callOllamaChat: vi.fn(),
}));

import { callOllamaChat } from "../src/ollamaClient";
import { getModeratorDecision } from "../src/moderator";
import { createLoadedPersonas } from "./helpers/testUtils";

const personas = createLoadedPersonas();
const panel = {
  name: "core",
  debaters: personas.debaters.slice(0, 2),
  judge: personas.judge,
  moderator: personas.moderator,
};

afterEach(() => {
  vi.resetAllMocks();
});

describe("getModeratorDecision", () => {
  it("returns parsed JSON decisions when moderator succeeds", async () => {
    vi.mocked(callOllamaChat).mockResolvedValueOnce(
      JSON.stringify({
        nextSpeaker: panel.debaters[1].name,
        shouldConclude: false,
        reason: "need more detail",
      })
    );

    const result = await getModeratorDecision("How to launch?", [], panel);
    expect(result).toEqual({
      nextSpeaker: panel.debaters[1].name,
      shouldConclude: false,
      reason: "need more detail",
    });
  });

  it("forces the judge when JSON is invalid", async () => {
    vi.mocked(callOllamaChat).mockResolvedValueOnce('{"who":"nobody"}');

    const result = await getModeratorDecision("Question", [], panel);
    expect(result.nextSpeaker).toBe(panel.judge.name);
    expect(result.shouldConclude).toBe(true);
    expect(result.reason).toContain("invalid JSON");
  });

  it("forces the judge when the moderator call throws", async () => {
    vi.mocked(callOllamaChat).mockRejectedValueOnce(new Error("timeout"));

    const result = await getModeratorDecision("Question", [], panel);
    expect(result.nextSpeaker).toBe(panel.judge.name);
    expect(result.shouldConclude).toBe(true);
    expect(result.reason).toContain("moderator call failed");
  });
});

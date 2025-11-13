import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/ollamaClient", () => ({
  streamOllamaChat: vi.fn(),
  callOllamaChat: vi.fn(),
}));
vi.mock("../src/personas", () => ({
  loadPersonas: vi.fn(),
}));
vi.mock("../src/panels", () => ({
  resolveActivePanel: vi.fn(),
}));
vi.mock("../src/moderator", () => ({
  getModeratorDecision: vi.fn(),
}));

import { runConversation, __testables } from "../src/council";
import { streamOllamaChat } from "../src/ollamaClient";
import { getModeratorDecision } from "../src/moderator";
import { resolveActivePanel } from "../src/panels";
import { loadPersonas } from "../src/personas";
import { buildPersona, createLoadedPersonas } from "./helpers/testUtils";

const {
  runSingleTurnForAgent,
  collectActiveSpeakerNames,
  buildAgentMessages,
  formatAgentOutput,
} = __testables;

afterEach(() => {
  vi.resetAllMocks();
});

describe("runSingleTurnForAgent", () => {
  it("streams cleaned tokens and records the formatted transcript entry", async () => {
    const agent = buildPersona({
      name: "Visionary",
      systemPrompt: "Be bold.",
    });
    const transcript = [{ speaker: "User", content: "How do we ship?" }];
    const hooks = {
      onAgentToken: vi.fn(),
      onAgentError: vi.fn(),
      onAgentTurnComplete: vi.fn(),
    };

    vi.mocked(streamOllamaChat).mockImplementationOnce(async (_model, _messages, onToken) => {
      onToken(" [Visionary] I think");
      onToken(" we should launch this week.");
      return "[Visionary] I think we should launch this week.";
    });

    await runSingleTurnForAgent(
      agent,
      "How do we ship?",
      transcript,
      4,
      new Set([agent.name]),
      hooks
    );

    const finalEntry = transcript.at(-1);
    expect(finalEntry).toEqual({
      speaker: "Visionary",
      content: "I think we should launch this week.",
    });
    expect(hooks.onAgentToken).toHaveBeenCalled();
    const deltas = hooks.onAgentToken.mock.calls.map(([, delta]) => delta);
    expect(deltas.every((delta) => !delta.includes("Visionary]"))).toBe(true);
    expect(hooks.onAgentError).not.toHaveBeenCalled();
    expect(hooks.onAgentTurnComplete).toHaveBeenCalledWith(
      agent,
      "I think we should launch this week."
    );
  });

  it("records an [ERROR] entry when streaming fails", async () => {
    const agent = buildPersona({ name: "Empiricist", systemPrompt: "Test ideas." });
    const transcript = [{ speaker: "User", content: "Question" }];
    const hooks = {
      onAgentToken: vi.fn(),
      onAgentError: vi.fn(),
      onAgentTurnComplete: vi.fn(),
    };

    vi.mocked(streamOllamaChat).mockRejectedValueOnce(new Error("boom"));

    await runSingleTurnForAgent(
      agent,
      "Question",
      transcript,
      4,
      new Set([agent.name]),
      hooks
    );

    const finalEntry = transcript.at(-1);
    expect(finalEntry?.content).toBe("[ERROR] boom");
    expect(hooks.onAgentError).toHaveBeenCalledWith(agent, expect.any(Error));
    expect(hooks.onAgentToken).not.toHaveBeenCalled();
  });
});

describe("transcript windows", () => {
  it("limits recap to persona transcriptWindow when running a turn", async () => {
    const agent = buildPersona({
      name: "Focused",
      systemPrompt: "Be brief.",
      transcriptWindow: 2,
    });
    const transcript = [
      { speaker: "User", content: "Q" },
      { speaker: "Focused", content: "First turn" },
      { speaker: "Beta", content: "Second turn" },
      { speaker: "Focused", content: "Third turn" },
    ];

    let capturedPrompt = "";
    vi.mocked(streamOllamaChat).mockImplementationOnce(async (_model, messages, onToken) => {
      capturedPrompt = messages[1]?.content ?? "";
      onToken("Done");
      return "Done";
    });

    await runSingleTurnForAgent(
      agent,
      "Q",
      transcript,
      10,
      new Set(["Focused", "Beta"]),
      {
        onAgentToken: vi.fn(),
        onAgentTurnComplete: vi.fn(),
        onAgentError: vi.fn(),
      }
    );

    expect(capturedPrompt).toContain("Beta: Second turn");
    expect(capturedPrompt).toContain("Focused: Third turn");
    expect(capturedPrompt).not.toContain("Focused: First turn");
  });
});

describe("buildAgentMessages", () => {
  it("lists which personas have and have not spoken to discourage false attributions", () => {
    const agent = buildPersona({ name: "Critic", systemPrompt: "Probe tone." });
    const transcript = [
      { speaker: "User", content: "Q" },
      { speaker: "Analyst", content: "Answered first." },
    ];
    const debaterNames = new Set(["Analyst", "Critic", "Optimist"]);

    const messages = buildAgentMessages(agent, "Q", transcript, 4, true, debaterNames);
    const userPrompt = messages[1]?.content ?? "";

    expect(userPrompt).toContain("Debaters who have already spoken: Analyst.");
    expect(userPrompt).toContain("Debaters who have not spoken yet: Optimist.");
    expect(userPrompt).toContain("Do NOT claim these personas already weighed in");
  });
});

describe("collectActiveSpeakerNames", () => {
  it("captures ordered, unique debater names and skips judge entries", () => {
    const personas = createLoadedPersonas();
    const panel = {
      name: "core",
      debaters: personas.debaters.slice(0, 2),
      judge: personas.judge,
      moderator: personas.moderator,
    };
    const transcript = [
      { speaker: "User", content: "Q" },
      { speaker: panel.debaters[0].name, content: "one" },
      { speaker: panel.debaters[1].name, content: "two" },
      { speaker: panel.debaters[0].name, content: "repeat" },
      { speaker: panel.judge.name, content: "final" },
    ];

    const ordered = collectActiveSpeakerNames(transcript, panel);
    expect(ordered).toEqual([
      panel.debaters[0].name,
      panel.debaters[1].name,
    ]);
  });
});

describe("formatAgentOutput", () => {
  it("removes stray \"me:\" fragments that leak into responses", () => {
    const messy =
      "To explore this idea further, me: what if we considered the founders' emphasis on character?";
    const cleaned = formatAgentOutput("Optimist", messy);

    expect(cleaned).not.toMatch(/\bme:/i);
    expect(cleaned).toContain(", what if we considered the founders");
  });
});

describe("runConversation", () => {
  it("runs a balanced stubbed debate and hands off to the judge", async () => {
    const debaters = [
      buildPersona({ name: "Alpha", systemPrompt: "alpha" }),
      buildPersona({ name: "Beta", systemPrompt: "beta" }),
    ];
    const judge = buildPersona({
      name: "JudgeX",
      roleType: "judge",
      model: "llama3.1:8b",
      description: "Judge",
      systemPrompt: "Judge fairly.",
    });
    const moderator = buildPersona({
      name: "ModeratorX",
      roleType: "moderator",
      model: "llama3.1:8b",
      description: "Mod",
      systemPrompt: "Pick next speaker.",
    });

    vi.mocked(loadPersonas).mockResolvedValue({
      debaters,
      judge,
      moderator,
    });

    vi.mocked(resolveActivePanel).mockReturnValue({
      name: "product",
      debaters,
      judge,
      moderator,
    });

    const decisionQueue = [
      { nextSpeaker: "Beta", shouldConclude: false },
      { nextSpeaker: "JudgeX", shouldConclude: true },
    ];
    vi.mocked(getModeratorDecision).mockImplementation(async () => {
      return decisionQueue.shift() ?? { nextSpeaker: "JudgeX", shouldConclude: true };
    });

    const responses: Record<string, string> = {
      ALPHA: "Alpha proposes a plan.",
      BETA: "Beta challenges the plan.",
      JUDGEX: "JudgeX synthesizes both sides.",
    };
    vi.mocked(streamOllamaChat).mockImplementation(
      async (_model, _messages, onToken, options) => {
        const text = responses[options?.label ?? ""];
        if (text) {
          onToken(text);
          return text;
        }
        throw new Error("unexpected label");
      }
    );

    const result = await runConversation("Ship it?");

    expect(result.transcript.map((entry) => entry.speaker)).toEqual([
      "User",
      "Alpha",
      "Beta",
      "JudgeX",
    ]);
    expect(result.judgment).toBe("JudgeX synthesizes both sides.");
    expect(getModeratorDecision).toHaveBeenCalledTimes(2);
  });
});

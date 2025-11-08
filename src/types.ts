import type { PersonaConfig } from "./personas";

export type OllamaRole = "system" | "user" | "assistant";

export interface OllamaChatMessage {
  role: OllamaRole;
  content: string;
}

export type SpeakerName = "User" | string;

export type Message = {
  speaker: SpeakerName;
  content: string;
};

export type AgentConfig = PersonaConfig;

export type ModeratorDecision = {
  nextSpeaker: string;
  shouldConclude: boolean;
  reason?: string;
};

export interface CouncilHooks {
  onAgentTurnStart?(agent: AgentConfig): void;
  onAgentToken?(agent: AgentConfig, token: string): void;
  onAgentTurnComplete?(agent: AgentConfig, fullResponse: string): void;
  onAgentError?(agent: AgentConfig, error: Error): void;
  onJudgeStart?(agent: AgentConfig): void;
  onJudgeToken?(token: string): void;
  onJudgeComplete?(fullResponse: string): void;
  onJudgeError?(error: Error): void;
}

export interface CouncilOptions {
  maxTurns?: number;
  transcriptWindow?: number;
  personasDir?: string;
  panelName?: string;
  hooks?: CouncilHooks;
}

export interface CouncilResult {
  transcript: Message[];
  judgment: string;
}

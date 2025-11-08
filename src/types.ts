export type OllamaRole = "system" | "user" | "assistant";

export interface OllamaChatMessage {
  role: OllamaRole;
  content: string;
}

export type SpeakerName = "Analyst" | "Optimist" | "Critic" | "Judge";

export type Message = {
  speaker: SpeakerName | "User";
  content: string;
};

export type AgentConfig = {
  name: SpeakerName;
  model: string;
  systemPrompt: string;
  /**
   * Optional override for how many previous transcript entries this agent
   * should see when forming its response.
   */
  transcriptWindow?: number;
};

export type ModeratorDecision = {
  nextSpeaker: SpeakerName;
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
  hooks?: CouncilHooks;
}

export interface CouncilResult {
  transcript: Message[];
  judgment: string;
}

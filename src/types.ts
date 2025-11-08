export type OllamaRole = "system" | "user" | "assistant";

export interface OllamaChatMessage {
  role: OllamaRole;
  content: string;
}

export type Message = {
  speaker: string;
  content: string;
  /** Present for agent messages so the CLI can group by round. */
  round?: number;
};

export type AgentConfig = {
  name: string;
  model: string;
  systemPrompt: string;
  /**
   * Optional override for how many previous transcript entries this agent
   * should see when forming its response.
   */
  transcriptWindow?: number;
};

export interface CouncilHooks {
  onRoundStart?(round: number): void;
  onAgentTurnStart?(round: number, agent: AgentConfig): void;
  onAgentToken?(agent: AgentConfig, token: string): void;
  onAgentTurnComplete?(round: number, agent: AgentConfig, fullResponse: string): void;
  onAgentError?(round: number, agent: AgentConfig, error: Error): void;
  onJudgeStart?(agent: AgentConfig): void;
  onJudgeToken?(token: string): void;
  onJudgeComplete?(fullResponse: string): void;
  onJudgeError?(error: Error): void;
}

export interface CouncilOptions {
  rounds?: number;
  transcriptWindow?: number;
  hooks?: CouncilHooks;
}

export interface CouncilResult {
  transcript: Message[];
  judgment: string;
}

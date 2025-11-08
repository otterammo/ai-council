export type OllamaRole = "system" | "user" | "assistant";

export interface OllamaChatMessage {
  role: OllamaRole;
  content: string;
}

export interface AgentConfig {
  name: string;
  model: string;
  systemPrompt: string;
  /** Optional override for how many prior messages this agent should see. */
  transcriptWindow?: number;
}

export interface TranscriptMessage {
  speaker: string;
  content: string;
  /** Round number this message belongs to; omitted for the initial user prompt. */
  round?: number;
}

export interface CouncilOptions {
  rounds?: number;
  /** Max messages from the transcript to show each agent. */
  transcriptWindow?: number;
}

export interface CouncilResult {
  transcript: TranscriptMessage[];
  judgment: string;
}

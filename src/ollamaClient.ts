import { OllamaChatMessage } from "./types";

const DEFAULT_OLLAMA_URL = process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";

interface OllamaChatResponse {
  message?: {
    role: string;
    content?: string;
  };
  error?: string;
}

/**
 * Low-level helper that posts a chat request to Ollama.
 * Throws informative errors for network, HTTP, or response shape issues.
 */
export async function callOllamaChat(
  model: string,
  messages: OllamaChatMessage[]
): Promise<string> {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is unavailable in this Node.js runtime.");
  }

  const controller = new AbortController();
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 120000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${DEFAULT_OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      throw new Error(`Ollama responded with ${response.status}: ${text}`);
    }

    const data = (await response.json()) as OllamaChatResponse;

    if (data.error) {
      throw new Error(`Ollama error: ${data.error}`);
    }

    const content = data.message?.content?.trim();
    if (!content) {
      throw new Error("Ollama response missing assistant content.");
    }

    return content;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Ollama request timed out after ${timeoutMs}ms.`);
    }
    throw new Error(
      `Failed to call Ollama: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

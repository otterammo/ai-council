import { OllamaChatMessage } from "./types";

const DEFAULT_OLLAMA_URL = process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";

interface OllamaChatResponse {
  message?: {
    role: string;
    content?: string;
  };
  error?: string;
}

function ensureFetch(): typeof fetch {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is unavailable in this Node.js runtime.");
  }
  return fetch;
}

function getTimeoutMs(): number {
  return Number(process.env.OLLAMA_TIMEOUT_MS ?? 120000);
}

/**
 * Low-level helper that posts a chat request to Ollama.
 * Throws informative errors for network, HTTP, or response shape issues.
 */
export async function callOllamaChat(
  model: string,
  messages: OllamaChatMessage[]
): Promise<string> {
  const runtimeFetch = ensureFetch();
  const controller = new AbortController();
  const timeoutMs = getTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await runtimeFetch(`${DEFAULT_OLLAMA_URL}/api/chat`, {
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

/**
 * Streaming helper that consumes the JSONL response from Ollama, yielding tokens in real time.
 */
export async function streamOllamaChat(
  model: string,
  messages: OllamaChatMessage[],
  onToken: (token: string) => void
): Promise<string> {
  const runtimeFetch = ensureFetch();
  const controller = new AbortController();
  const timeoutMs = getTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await runtimeFetch(`${DEFAULT_OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      throw new Error(`Ollama responded with ${response.status}: ${text}`);
    }

    if (!response.body) {
      throw new Error("Ollama response missing body for streaming.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let finished = false;

    const processLine = (rawLine: string): void => {
      const line = rawLine.trim();
      if (!line) {
        return;
      }
      let payload: { message?: { content?: string }; done?: boolean };
      try {
        payload = JSON.parse(line);
      } catch (error) {
        throw new Error(`Failed to parse Ollama stream chunk: ${line}`);
      }

      const fragment = payload.message?.content ?? "";
      if (fragment) {
        fullText += fragment;
        onToken(fragment);
      }

      if (payload.done) {
        finished = true;
      }
    };

    const flushBuffer = (force = false): void => {
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        processLine(line);
        if (finished) {
          buffer = "";
          return;
        }
      }

      if (force && buffer.trim().length > 0) {
        const line = buffer;
        buffer = "";
        processLine(line);
      }
    };

    while (!finished) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      flushBuffer();
      if (finished) {
        break;
      }
    }

    // Flush any remaining buffered content, including decoder leftovers.
    buffer += decoder.decode();
    flushBuffer(true);

    await reader.cancel().catch(() => undefined);

    if (!finished) {
      throw new Error("Ollama stream ended without a completion signal.");
    }

    return fullText;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Ollama streaming request timed out after ${timeoutMs}ms.`);
    }
    throw new Error(
      `Failed to stream from Ollama: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

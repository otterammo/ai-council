# ai-council

`ai-council` is a local-first CLI that runs a multi-agent debate between purpose-built LLM personas backed by Ollama. You watch the back-and-forth unfold in your terminal, then receive a judge’s synthesized recommendation grounded in every argument that was raised.

![AI council CLI demo](docs/assets/ai-council-demo.gif)

## Features
- Runs entirely on your machine against Ollama (`http://localhost:11434`)—no cloud keys or remote telemetry.
- Streams every token from each persona so you can inspect the thought process in real time.
- Personas are plain JSON definitions (name, role, model, system prompt) that you can remix or override.
- Panels let you group personas into councils (philosophy, product, devops, etc.) and pick one per question.
- Moderator, debaters, and judge are separated so turn-taking, debate, and synthesis stay modular, with light guardrails that strip obviously fake `[1]`-style citations.

## Prerequisites
- Node.js 20 or newer.
- Ollama installed and running locally (`ollama serve` or equivalent).
- At least one chat-capable model pulled, e.g. `ollama pull llama3.1`.
- A UTF-8 friendly terminal (box-drawing characters are used for separators).

## Installation
```bash
git clone https://github.com/<user>/ai-council.git
cd ai-council
npm install
```

## Getting Started
1. **Verify prerequisites.** Ensure Node.js ≥ 20, Ollama is running on `http://localhost:11434`, and you have pulled a model such as `llama3.1:8b`.
2. **Install dependencies.** See the commands in the installation section above.
3. **Run the council.**
   ```bash
   npm run dev
   ```
   You will see the ASCII banner and be prompted:
   ```
   Question for the AI council:
   > What does it truly mean for artificial intelligence to “understand” something?
   ```
   Debaters such as `[Rationalist]`, `[Empiricist]`, `[Pragmatist]`, `[Humanist]`, and `[Skeptic]` will stream their turns, separated by box-drawing dividers. When the debate concludes, the `Judge` persona summarizes agreements, disagreements, and a recommendation inside a boxed callout.
4. **Select a panel (optional).**
   ```bash
   npm run dev -- --panel philosophy
   # or
   AI_COUNCIL_PANEL=core npm run dev
   ```
   If the requested panel is missing, the CLI warns you and falls back to the built-in `core` panel.
5. **Add a custom persona and panel (optional).**
   - Create `personas/SystemsThinker.json`:
     ```json
     {
       "name": "SystemsThinker",
       "roleType": "debater",
       "model": "llama3.1:8b",
       "description": "Maps feedback loops and second-order effects.",
       "systemPrompt": "You are SystemsThinker. Highlight reinforcing loops, dampening forces, and leverage points. Be concise but structural."
     }
     ```
   - Extend `panels.json`:
     ```json
     {
       "panels": [
         {
           "name": "systems",
           "debaters": ["Rationalist", "Pragmatist", "SystemsThinker"],
           "judge": "Judge",
           "moderator": "Moderator"
         }
       ]
     }
     ```
   - Run `npm run dev -- --panel systems` to see the customized roster. User-defined personas and panels override built-ins when names collide.

## Running with Docker
1. **Build the image.**
   ```bash
   docker build -t ai-council .
   ```
2. **Run the CLI inside the container.**
   ```bash
   docker run -it --rm \
     -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
     ai-council
   ```
   - `-it` keeps the interactive prompt so you can enter a question.
   - Point `OLLAMA_BASE_URL` at an Ollama instance the container can reach. When Ollama runs on the host, `host.docker.internal` works on macOS/Windows. On Linux, add `--add-host=host.docker.internal:host-gateway` (Docker 20.10+) or use `--network host`.
3. **Mount custom personas/panels (optional).**
   ```bash
   docker run -it --rm \
     -v $(pwd)/personas:/app/personas:ro \
     -v $(pwd)/panels.json:/app/panels.json:ro \
     -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
     ai-council --panel philosophy
   ```
   Bind mounts let you override the personas and panels shipped in the image, just like running the CLI locally.

### Using Docker Compose
1. **Build the service.**
   ```bash
   docker compose build
   ```
2. **Run the CLI.**
   ```bash
   docker compose run council
   ```
   The Compose file (`docker-compose.yml`) keeps `stdin`/`tty` open for interactive prompts, forwards `OLLAMA_BASE_URL` to `http://host.docker.internal:11434`, and adds an `extra_hosts` entry (`host-gateway`) so Linux hosts can still resolve the address. It also mounts local `personas/` and `panels.json` read-only, mirroring the override behavior you get when running the CLI directly.

## Usage
### Typical flow
1. Start Ollama if it is not already running.
2. Run `npm run dev` (or `npm start` after `npm run build`).
3. Enter a question when prompted.
4. Watch the moderator-managed debate; each debater receives the question, the transcript window, and their persona instructions.
5. Review the judge’s boxed summary and final recommendation.

Example prompts for inspiration:
- “How should we think about AI safety in a startup setting?”
- “What trade-offs should I consider when migrating a monolith to microservices?”
- “How can I design a humane onboarding flow for a complex developer tool?”

### Selecting a panel
- CLI flag: `npm run dev -- --panel philosophy`
- Environment variable: `AI_COUNCIL_PANEL=core npm run dev`
- Panels default to `"core"` (`Rationalist`, `Empiricist`, `Pragmatist`, `Humanist`, `Skeptic`) when no match is found. Warnings are printed whenever requested panels or personas are missing.

### CLI options and environment variables
- `--panel <name>`: choose the persona panel for this run.
- `AI_COUNCIL_PANEL=<name>`: same as the CLI flag but via env var.
- `--personas <dir>`: point to an alternate personas directory (defaults to `./personas`).
- `OLLAMA_BASE_URL`: override the Ollama host (default `http://localhost:11434`).
- `OLLAMA_TIMEOUT_MS`: tweak per-request timeout (default 120s).
- `AI_COUNCIL_DEBUG=1`: log raw prompts/responses for troubleshooting.

## Configuration
### Defining panels (`panels.json`)
Place a `panels.json` file at the project root. User-defined panels replace built-ins with the same name.

```json
{
  "panels": [
    {
      "name": "philosophy",
      "debaters": ["Rationalist", "Humanist", "Skeptic"]
    },
    {
      "name": "software-design",
      "debaters": ["Architect", "Refactorer", "PerformanceNerd"],
      "judge": "TechLead",
      "moderator": "Moderator"
    }
  ]
}
```

- `name`: unique panel identifier selected via `--panel` or `AI_COUNCIL_PANEL`.
- `debaters`: ordered list of persona names; missing personas trigger warnings and are skipped.
- `judge` / `moderator` (optional): overrides for the non-debater personas; defaults are used otherwise.

### Defining personas (`personas/`)
Create a `personas/` directory (default location, or point elsewhere via `--personas`). Each `.json` file defines one persona:

```json
{
  "name": "Rationalist",
  "roleType": "debater",
  "model": "llama3.1:8b",
  "description": "Clarifies concepts and logical structure.",
  "systemPrompt": "You are Rationalist, a member of the AI council. Focus on internal consistency, explicit assumptions, and precise language.",
  "transcriptWindow": 6
}
```

- `name`: unique string; matching names override built-in personas.
- `roleType`: `"debater" | "judge" | "moderator"`.
- `model`: Ollama model identifier.
- `description`: short summary used in moderator/judge prompts.
- `systemPrompt`: full behavior instructions.
- `transcriptWindow` (optional): override the default number of transcript messages provided to that persona.

All JSON files under `personas/` (recursively) are loaded. Missing debaters trigger a warning and fall back to the default Rationalist-led lineup.

## Architecture Overview
- `src/index.ts`: CLI entry point. Parses `--panel`/`--personas`, prints the banner, prompts for a user question, and wires up streaming hooks passed to the council.
- `src/council.ts`: Core orchestrator. Loads personas, resolves the active panel, tracks the transcript, calls the moderator to pick the next speaker, streams each persona turn, and finally invokes the judge for the summary/recommendation.
- `src/ollamaClient.ts`: Thin Ollama `/api/chat` client with both request/response and streaming helpers plus timeouts and debug logging.
- `src/personas.ts`: Loads built-in personas and recursively merges any user-provided JSON, ensuring overrides are respected and basic validation/guardrails are applied.
- `src/panels.ts`: Declares built-in panels, reads `panels.json`, merges definitions (user entries win), and resolves full persona configs for the active run.
- `src/moderator.ts`: Builds the moderator prompt, calls Ollama, parses the JSON decision (`nextSpeaker`, `shouldConclude`, `reason`), and falls back safely if anything looks off.
- `src/agents.ts`: Houses the default personas (Rationalist, Empiricist, Pragmatist, Humanist, Skeptic, Judge, Moderator) plus citation-sanitizing helpers and shared constants like transcript windows.

## Notable Design Choices
- **Local-first by default:** Everything runs against Ollama on your machine. There are no API keys, network calls, or remote telemetry beyond what Ollama itself performs.
- **Streaming UX:** Debaters stream tokens immediately, so you can interrupt or observe reasoning in real time rather than waiting for a single blob of text.
- **Personas as data:** Behavior lives in JSON definitions. Editing a system prompt or swapping models does not require recompiling.
- **Panels as mental models:** Pick the council that matches your problem (philosophy, product, devops) or define new panels expressing specific trade-offs.
- **Role separation:** Debaters explore ideas, the moderator manages turn-taking and decides when to stop, and the judge synthesizes. This keeps prompts focused and scoped.
- **Lightweight safeguards:** Outputs are cleaned to remove obviously hallucinated citation brackets, with the expectation that future releases may integrate real retrieval or web search.

## Contributing
- Use Node.js 20+ and TypeScript 5.4+ (already captured by `tsconfig.json`).
- Development workflow:
  - `npm run dev` for ts-node live runs.
  - `npm run build` to emit `dist/` and type-check.
  - `npm start` to execute the compiled build.
- Style/linting: no dedicated lint script yet—run `npm run build` for type safety.
- To propose new personas or panels, open a PR that adds the relevant JSON definitions plus notes in `panels.json` or `personas/`. Describe the role’s intent, default model, and suggested panel placements.

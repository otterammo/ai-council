#!/usr/bin/env node
import boxen from "boxen";
import chalk from "chalk";
import figlet from "figlet";
import ora from "ora";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { runConversation } from "./council";
import { CouncilHooks } from "./types";

function printBanner(): void {
  const title = figlet.textSync("AI Council", {
    horizontalLayout: "default",
    verticalLayout: "default",
  });

  console.log(chalk.cyan(title.trimEnd()));
  console.log(chalk.dim("Local multi-agent debate powered by Ollama\n"));
}

async function promptForQuestion(): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    console.log(chalk.bold("Question for the AI council:"));
    const answer = await rl.question("> ");
    return answer.trim();
  } finally {
    rl.close();
  }
}

function divider(width = 40): string {
  return "─".repeat(width);
}

interface CliOptions {
  personasDir?: string;
  panelName?: string;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--personas") {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        const trimmed = next.trim();
        if (trimmed) {
          options.personasDir = trimmed;
        }
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("--personas=")) {
      const [, value] = arg.split("=", 2);
      if (value) {
        const trimmed = value.trim();
        if (trimmed) {
          options.personasDir = trimmed;
        }
      }
      continue;
    }
    if (arg === "--panel") {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        const trimmed = next.trim();
        if (trimmed) {
          options.panelName = trimmed;
        }
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("--panel=")) {
      const [, value] = arg.split("=", 2);
      if (value) {
        const trimmed = value.trim();
        if (trimmed) {
          options.panelName = trimmed;
        }
      }
      continue;
    }
  }
  return options;
}

async function main(): Promise<void> {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  const preferredPanelName = cliOptions.panelName || process.env.AI_COUNCIL_PANEL?.trim();
  printBanner();
  const conversationId = Date.now().toString(36);
  console.log(chalk.dim(`=== AI Council Run #${conversationId} ===`));
  console.log();

  const question = await promptForQuestion();
  if (!question) {
    console.error(chalk.red("A question is required to run the council."));
    process.exit(1);
  }

  const spinner = ora({
    text: chalk.dim("Consulting the moderator..."),
    color: "cyan",
  }).start();

  let judgeBuffer = "";

  const hooks: CouncilHooks = {
    onAgentTurnStart: (agent) => {
      if (spinner.isSpinning) {
        spinner.stop();
      }
      console.log();
      console.log(chalk.cyan(`[${agent.name}]`));
      console.log(chalk.dim(divider()));
    },
    onAgentToken: (_agent, token) => {
      process.stdout.write(token);
    },
    onAgentTurnComplete: () => {
      process.stdout.write("\n");
    },
    onAgentError: (agent, error) => {
      console.log(chalk.red(`\n${agent.name} encountered an error: ${error.message}\n`));
    },
    onJudgeStart: () => {
      if (spinner.isSpinning) {
        spinner.stop();
      }
      judgeBuffer = "";
      console.log(chalk.bold("\nFinal Judgment\n"));
    },
    onJudgeToken: (token) => {
      judgeBuffer += token;
    },
    onJudgeComplete: (fullResponse) => {
      judgeBuffer = fullResponse.trim();
      const boxed = boxen(judgeBuffer, {
        padding: 1,
        borderColor: "gray",
        borderStyle: "round",
      });
      console.log(boxed);
      console.log();
    },
    onJudgeError: (error) => {
      console.log(chalk.red(`Judge failed: ${error.message}`));
    },
  };

  try {
    await runConversation(question, {
      hooks,
      personasDir: cliOptions.personasDir,
      panelName: preferredPanelName,
    });
  } catch (error) {
    if (spinner.isSpinning) {
      spinner.stop();
    }
    console.error(
      chalk.red(
        `\nCouncil run failed: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  } finally {
    if (spinner.isSpinning) {
      spinner.stop();
    }
  }
}

main().catch((error) => {
  console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});

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

async function main(): Promise<void> {
  printBanner();

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
    await runConversation(question, { hooks });
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

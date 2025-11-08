#!/usr/bin/env node
import boxen from "boxen";
import chalk from "chalk";
import figlet from "figlet";
import ora from "ora";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { runCouncil } from "./council";
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

function makeDivider(label: string, char = "─", width = 60): string {
  const cleanLabel = ` ${label.trim()} `;
  const totalWidth = Math.max(width, cleanLabel.length + 2);
  const sideLength = Math.max(2, Math.floor((totalWidth - cleanLabel.length) / 2));
  const left = char.repeat(sideLength);
  const right = char.repeat(totalWidth - cleanLabel.length - sideLength);
  return `${left}${cleanLabel}${right}`;
}

async function main(): Promise<void> {
  printBanner();

  const question = await promptForQuestion();
  if (!question) {
    console.error(chalk.red("A question is required to run the council."));
    process.exit(1);
  }

  const spinner = ora({
    text: chalk.dim("Gathering the council..."),
    color: "cyan",
  }).start();

  let judgeBuffer = "";

  const hooks: CouncilHooks = {
    onRoundStart: () => {
      if (spinner.isSpinning) {
        spinner.stop();
      }
    },
    onAgentTurnStart: (round, agent) => {
      if (spinner.isSpinning) {
        spinner.stop();
      }
      console.log();
      console.log(chalk.cyan(makeDivider(`Round ${round} • ${agent.name}`)));
      console.log();
    },
    onAgentToken: (_agent, token) => {
      process.stdout.write(token);
    },
    onAgentTurnComplete: () => {
      process.stdout.write("\n\n");
    },
    onAgentError: (_round, agent, error) => {
      console.log(chalk.red(`\n${agent.name} encountered an error: ${error.message}\n`));
    },
    onJudgeStart: () => {
      if (spinner.isSpinning) {
        spinner.stop();
      }
      judgeBuffer = "";
      console.log(chalk.cyan(`\n${makeDivider("Final Judgment", "═")}\n`));
    },
    onJudgeToken: (token) => {
      judgeBuffer += token;
    },
    onJudgeComplete: () => {
      const boxed = boxen(judgeBuffer.trim(), {
        padding: { top: 1, bottom: 1, left: 2, right: 2 },
        borderColor: "cyan",
        borderStyle: "round",
      });
      console.log(boxed);
    },
    onJudgeError: (error) => {
      console.log(chalk.red(`Judge failed: ${error.message}`));
    },
  };

  try {
    await runCouncil(question, { hooks });
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

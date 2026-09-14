#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { ConfigError } from "../config/loader.js";
import { initCommand } from "./commands/core.js";

const cwd = process.cwd() + "/agent-working";

const program = new Command();
program
  .name("agent")
  .description(
    "A CLI-based autonomous coding agent designed for local/open-source LLMs (Qwen3, Llama, etc.)",
  )
  .version("0.1.0");

program
  .command("init")
  .description("Initialize agent configuration in the current project")
  .action(async () => {
    await guard(() => initCommand(cwd));
  });

async function guard(fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(chalk.red(err.message));
      console.error(
        chalk.dim(
          "Run `agent init` to create a valid configuration, or fix .agent/config.yaml.",
        ),
      );
    } else {
      console.error(
        chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
      );
      if (err instanceof Error && err.stack && process.env.AGENT_DEBUG)
        console.error(chalk.dim(err.stack));
    }
    process.exitCode = 1;
  }
}

program.parseAsync(process.argv);

import fs from "node:fs";
import path from "node:path";
import inquirer from "inquirer";
import chalk from "chalk";
import { banner } from "../../ui/console.js";
import { DEFAULT_CONFIG } from "../../config/schema.js";
import { errorLine, successLine, dim } from "../../ui/console.js";
import { projectAgentDir, writeProjectConfig } from "../../config/loader.js";
import { buildProjectInfo } from "../../context/indexer.js";

export async function initCommand(cwd: string): Promise<void> {
  const agentDir = projectAgentDir(cwd);
  if (fs.existsSync(agentDir)) {
    console.log(
      errorLine(
        `.agent already exists at ${agentDir}. Edit .agent/config.yaml directly or delete it to re-init.`,
      ),
    );
    return;
  }

  console.log(
    banner({
      model: "(not configured yet)",
      provider: "(not configured yet)",
      project: path.basename(cwd),
    }),
  );

  const answers = await inquirer.prompt<{
    provider: "ollama" | "llamacpp" | "vllm" | "openai-compatible" | "openai";
    name: string;
    baseUrl: string;
    permMode: "safe" | "ask" | "auto";
  }>([
    {
      type: "list",
      name: "provider",
      message: "Model provider",
      choices: ["ollama", "llamacpp", "vllm", "openai-compatible", "openai"],
      default: "ollama",
    },
    {
      type: "input",
      name: "name",
      message: "Model name",
      default: (a: any) =>
        a.provider === "openai" ? "gpt-4o-mini" : "qwen3:30b",
    },
    {
      type: "input",
      name: "baseUrl",
      message: "Base URL",
      default: (a: any) =>
        ({
          ollama: "http://localhost:11434/v1",
          llamacpp: "http://localhost:8080/v1",
          vllm: "http://localhost:8000/v1",
          openai: "https://api.openai.com/v1",
          "openai-compatible": "http://localhost:8000/v1",
        })[a.provider as string],
    },
    {
      type: "list",
      name: "permMode",
      message: "Default permission mode",
      choices: ["ask", "auto", "safe"],
      default: "ask",
    },
  ]);

  const config = {
    ...DEFAULT_CONFIG,
    model: {
      ...DEFAULT_CONFIG.model,
      provider: answers.provider,
      name: answers.name,
      baseUrl: answers.baseUrl,
    },
    permissions: { ...DEFAULT_CONFIG.permissions, mode: answers.permMode },
  };

  writeProjectConfig(cwd, config);
  fs.mkdirSync(path.join(agentDir, "context"), { recursive: true });
  fs.mkdirSync(path.join(agentDir, "sessions"), { recursive: true });
  fs.mkdirSync(path.join(agentDir, "plans"), { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "memory.md"),
    "# Project Memory\n\n_Persistent notes the agent has learned about this project. Safe to hand-edit._\n",
    "utf-8",
  );

  const info = buildProjectInfo(cwd, config.ignore);
  console.log(successLine(`Initialized .agent/ in ${cwd}`));
  console.log(
    dim(
      `Detected: ${info.languages.join(", ") || "unknown language"}${info.frameworks.length ? ` · ${info.frameworks.join(", ")}` : ""}`,
    ),
  );
  console.log(
    dim(
      `Edit .agent/config.yaml any time, or run "agent config" to inspect it.`,
    ),
  );
}

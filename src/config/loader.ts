import path from "node:path";
import fs from "node:fs";
import yaml from "js-yaml";
import type { AgentConfig } from "./schema.js";

export class ConfigError extends Error {}

export function projectAgentDir(projectRoot: string): string {
  return path.join(projectRoot, ".agent");
}

export function projectConfigPath(projectRoot: string): string {
  return path.join(projectAgentDir(projectRoot), "config.yaml");
}

export function writeProjectConfig(
  projectRoot: string,
  config: AgentConfig,
): void {
  const dir = projectAgentDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    projectConfigPath(projectRoot),
    yaml.dump(config, { lineWidth: 100 }),
    "utf-8",
  );
}

function applyEnvOverrides(config: AgentConfig): AgentConfig {
  const env = process.env;
  const next: AgentConfig = JSON.parse(JSON.stringify(config));
  if (env.AGENT_MODEL_PROVIDER)
    next.model.provider =
      env.AGENT_MODEL_PROVIDER as AgentConfig["model"]["provider"];
  if (env.AGENT_MODEL_NAME) next.model.name = env.AGENT_MODEL_NAME;
  if (env.AGENT_MODEL_BASE_URL) next.model.baseUrl = env.AGENT_MODEL_BASE_URL;
  if (env.AGENT_MODEL_API_KEY) next.model.apiKey = env.AGENT_MODEL_API_KEY;
  if (
    env.OPENAI_API_KEY &&
    !next.model.apiKey &&
    next.model.provider === "openai"
  ) {
    next.model.apiKey = env.OPENAI_API_KEY;
  }
  if (env.AGENT_PERMISSIONS_MODE) {
    next.permissions.mode =
      env.AGENT_PERMISSIONS_MODE as AgentConfig["permissions"]["mode"];
  }
  return next;
}

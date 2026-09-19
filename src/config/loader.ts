import path from "node:path";
import fs from "node:fs";
import yaml from "js-yaml";
import os from "node:os";
import type { AgentConfig } from "./schema.js";
import { DEFAULT_CONFIG } from "./schema.js";

function readYamlIfExists(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = yaml.load(raw);
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object") {
    throw new Error(
      `Config file ${filePath} must contain a YAML object at the top level.`,
    );
  }
  return parsed as Record<string, unknown>;
}
function deepMerge<T>(base: T, override: Partial<T> | undefined | null): T {
  if (!override) return base;
  const result: any = Array.isArray(base)
    ? [...(base as any)]
    : { ...(base as any) };
  for (const key of Object.keys(override)) {
    const overrideVal = (override as any)[key];
    const baseVal = (base as any)[key];
    if (
      overrideVal &&
      typeof overrideVal === "object" &&
      !Array.isArray(overrideVal) &&
      baseVal &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(baseVal, overrideVal);
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal;
    }
  }
  return result;
}

export const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".agent");
export const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, "config.yaml");
export class ConfigError extends Error {}
export interface LoadConfigOptions {
  projectRoot: string;
  /** Override individual keys, e.g. from CLI flags like --model. */
  overrides?: Partial<AgentConfig>;
}

export function projectAgentDir(projectRoot: string): string {
  return path.join(projectRoot, ".agent");
}

export function projectConfigPath(projectRoot: string): string {
  return path.join(projectAgentDir(projectRoot), "config.yaml");
}

export function validateConfig(config: AgentConfig): string[] {
  const problems: string[] = [];
  if (!config.model?.name) problems.push("model.name is required");
  if (!config.model?.provider) problems.push("model.provider is required");
  const validProviders = [
    "ollama",
    "llamacpp",
    "vllm",
    "openai-compatible",
    "openai",
  ];
  if (
    config.model?.provider &&
    !validProviders.includes(config.model.provider)
  ) {
    problems.push(`model.provider must be one of ${validProviders.join(", ")}`);
  }
  if (
    config.agent?.maxIterations !== undefined &&
    config.agent.maxIterations <= 0
  ) {
    problems.push("agent.maxIterations must be a positive number");
  }
  const validModes = ["safe", "ask", "auto"];
  if (
    config.permissions?.mode &&
    !validModes.includes(config.permissions.mode)
  ) {
    problems.push(`permissions.mode must be one of ${validModes.join(", ")}`);
  }
  return problems;
}

export function loadConfig(options: LoadConfigOptions): AgentConfig {
  const globalOverrides = readYamlIfExists(GLOBAL_CONFIG_PATH);
  const projectOverrides = readYamlIfExists(
    projectConfigPath(options.projectRoot),
  );

  let config = deepMerge(
    DEFAULT_CONFIG,
    (globalOverrides as Partial<AgentConfig>) ?? undefined,
  );
  config = deepMerge(
    config,
    (projectOverrides as Partial<AgentConfig>) ?? undefined,
  );
  config = deepMerge(config, options.overrides ?? undefined);
  config = applyEnvOverrides(config);

  const problems = validateConfig(config);
  if (problems.length > 0) {
    throw new ConfigError(
      `Invalid configuration:\n  - ${problems.join("\n  - ")}`,
    );
  }
  return config;
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

import type { PermissionMode } from '../types/index.js';

export interface ModelConfig {
  provider: 'ollama' | 'llamacpp' | 'vllm' | 'openai-compatible' | 'openai';
  name: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
}

export interface AgentBehaviorConfig {
  maxIterations: number;
  autoTest: boolean;
  autoFix: boolean;
  autoLint: boolean;
  contextLimit: number;
  maxRetriesPerTask: number;
  planningEnabled: boolean;
}

export interface PermissionsConfig {
  mode: PermissionMode;
  allowEditOutsideProject: boolean;
  allowedCommands?: string[];
  blockedCommands: string[];
  requireConfirmationFor: string[];
}

export interface ProjectCommandsConfig {
  test?: string;
  lint?: string;
  format?: string;
  build?: string;
  install?: string;
}

export interface MemoryConfig {
  enabled: boolean;
  maxEntries: number;
}

export interface AgentConfig {
  model: ModelConfig;
  agent: AgentBehaviorConfig;
  permissions: PermissionsConfig;
  commands: ProjectCommandsConfig;
  memory: MemoryConfig;
  ignore: string[];
  systemPrompt?: string;
}

export const DEFAULT_CONFIG: AgentConfig = {
  model: {
    provider: 'ollama',
    name: 'qwen3:30b',
    baseUrl: 'http://localhost:11434/v1',
    temperature: 0.2,
    maxTokens: 4096,
    contextWindow: 100000,
  },
  agent: {
    maxIterations: 50,
    autoTest: true,
    autoFix: true,
    autoLint: false,
    contextLimit: 100000,
    maxRetriesPerTask: 3,
    planningEnabled: true,
  },
  permissions: {
    mode: 'ask',
    allowEditOutsideProject: false,
    blockedCommands: [
      'rm -rf /',
      'rm -rf /*',
      'rm -rf ~',
      'mkfs',
      ':(){ :|:& };:',
      'dd if=/dev/zero',
      'shutdown',
      'reboot',
      'sudo rm',
      'chmod -R 777 /',
      'curl | sh',
      'wget | sh',
    ],
    requireConfirmationFor: ['install_dependency', 'delete_file', 'run_command', 'git_commit'],
  },
  commands: {},
  memory: {
    enabled: true,
    maxEntries: 200,
  },
  ignore: [
    'node_modules',
    'dist',
    'build',
    '.git',
    '.agent',
    '*.lock',
    'coverage',
    '.next',
    '.venv',
    '__pycache__',
    '*.pyc',
  ],
};

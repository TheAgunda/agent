import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, writeProjectConfig, ConfigError, validateConfig } from '../config/loader.js';
import { DEFAULT_CONFIG } from '../config/schema.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('config loader', () => {
  it('returns defaults when no config files exist', () => {
    const config = loadConfig({ projectRoot: tmpDir });
    expect(config.model.provider).toBe(DEFAULT_CONFIG.model.provider);
    expect(config.agent.maxIterations).toBe(DEFAULT_CONFIG.agent.maxIterations);
  });

  it('merges project config over defaults without clobbering unspecified nested keys', () => {
    fs.mkdirSync(path.join(tmpDir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.agent', 'config.yaml'),
      'model:\n  name: qwen3:14b\nagent:\n  maxIterations: 10\n'
    );
    const config = loadConfig({ projectRoot: tmpDir });
    expect(config.model.name).toBe('qwen3:14b');
    // provider should still fall back to default since it wasn't overridden
    expect(config.model.provider).toBe(DEFAULT_CONFIG.model.provider);
    expect(config.agent.maxIterations).toBe(10);
    // sibling default keys under `agent` must survive the merge
    expect(config.agent.autoTest).toBe(DEFAULT_CONFIG.agent.autoTest);
  });

  it('applies explicit overrides last (highest priority)', () => {
    const config = loadConfig({
      projectRoot: tmpDir,
      overrides: { model: { ...DEFAULT_CONFIG.model, name: 'override-model' } },
    });
    expect(config.model.name).toBe('override-model');
  });

  it('round-trips writeProjectConfig -> loadConfig', () => {
    const custom = { ...DEFAULT_CONFIG, agent: { ...DEFAULT_CONFIG.agent, maxIterations: 7 } };
    writeProjectConfig(tmpDir, custom);
    const loaded = loadConfig({ projectRoot: tmpDir });
    expect(loaded.agent.maxIterations).toBe(7);
  });

  it('rejects an invalid permission mode', () => {
    const problems = validateConfig({
      ...DEFAULT_CONFIG,
      permissions: { ...DEFAULT_CONFIG.permissions, mode: 'yolo' as any },
    });
    expect(problems.length).toBeGreaterThan(0);
  });

  it('throws ConfigError for malformed merged config', () => {
    fs.mkdirSync(path.join(tmpDir, '.agent'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.agent', 'config.yaml'), 'agent:\n  maxIterations: -5\n');
    expect(() => loadConfig({ projectRoot: tmpDir })).toThrow(ConfigError);
  });
});

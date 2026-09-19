import fs from "node:fs";
import path from "node:path";
import type { FileContextEntry } from "../types/index.js";
import { listProjectFiles } from "./indexer.js";
import { estimateTokens } from "../utils/tokenEstimate.js";

const BOOST_FILENAMES = new Set([
  "readme.md",
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "cargo.toml",
]);

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .filter((t) => t.length > 2);
}

function scoreFile(
  relPath: string,
  queryTokens: string[],
  recentlyTouched: Set<string>,
): FileContextEntry {
  const lower = relPath.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  for (const token of queryTokens) {
    if (lower.includes(token)) {
      score += 5;
      reasons.push(`matches "${token}"`);
    }
  }

  const base = path.basename(lower);
  if (BOOST_FILENAMES.has(base)) {
    score += 3;
    reasons.push("project manifest / readme");
  }

  const depth = relPath.split("/").length;
  score -= depth * 0.2; // slight preference for shallower files

  if (recentlyTouched.has(relPath)) {
    score += 8;
    reasons.push("recently touched by the agent");
  }

  if (/\.(test|spec)\./.test(lower)) {
    score += 1;
    reasons.push("test file");
  }

  return {
    path: relPath,
    relevance: score,
    reason: reasons.join(", ") || "baseline",
  };
}

export interface SelectionResult {
  selected: FileContextEntry[];
  totalCandidates: number;
  estimatedTokens: number;
}
export function selectRelevantFiles(
  projectRoot: string,
  taskDescription: string,
  options: {
    tokenBudget: number;
    recentlyTouched?: string[];
    extraIgnores?: string[];
  },
): SelectionResult {
  const files = listProjectFiles(projectRoot, options.extraIgnores ?? []);
  const queryTokens = tokenizeQuery(taskDescription);
  const recentlyTouched = new Set(options.recentlyTouched ?? []);

  const scored = files
    .map((f) => scoreFile(f, queryTokens, recentlyTouched))
    .sort((a, b) => b.relevance - a.relevance);

  const selected: FileContextEntry[] = [];
  let usedTokens = 0;

  for (const entry of scored) {
    if (usedTokens >= options.tokenBudget) break;
    const abs = path.join(projectRoot, entry.path);
    let size: number;
    try {
      size = fs.statSync(abs).size;
    } catch {
      continue;
    }
    // Skip binary-looking / huge files as context candidates.
    if (size > 200_000) continue;
    const approxTokens = Math.ceil(size / 3.5);
    if (usedTokens + approxTokens > options.tokenBudget && selected.length > 0)
      continue;
    selected.push(entry);
    usedTokens += approxTokens;
  }

  return {
    selected,
    totalCandidates: files.length,
    estimatedTokens: usedTokens,
  };
}

export function estimateMessageTokens(text: string): number {
  return estimateTokens(text);
}

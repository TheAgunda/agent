import { simpleGit, type SimpleGit } from "simple-git";
import type { Tool, ToolContext } from "./types.js";
import { ok, fail } from "./types.js";

function client(projectRoot: string): SimpleGit {
  return simpleGit({ baseDir: projectRoot });
}

export const gitStatusTool: Tool = {
  definition: {
    name: "git_status",
    description:
      "Show the current git status (staged, unstaged, untracked files, current branch).",
    parameters: { type: "object", properties: {} },
    riskLevel: "read",
  },
  async execute(_args, ctx: ToolContext) {
    try {
      const git = client(ctx.projectRoot);
      const status = await git.status();
      const lines = [
        `Branch: ${status.current ?? "unknown"}`,
        `Ahead/behind: +${status.ahead}/-${status.behind}`,
        `Staged: ${status.staged.join(", ") || "none"}`,
        `Modified: ${status.modified.join(", ") || "none"}`,
        `Not added: ${status.not_added.join(", ") || "none"}`,
        `Deleted: ${status.deleted.join(", ") || "none"}`,
        `Conflicted: ${status.conflicted.join(", ") || "none"}`,
      ];
      return ok(lines.join("\n"), status);
    } catch (err) {
      return fail(
        `Not a git repository or git error: ${(err as Error).message}`,
      );
    }
  },
};

export const gitDiffTool: Tool = {
  definition: {
    name: "git_diff",
    description:
      "Show the diff of uncommitted changes, optionally for a specific file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Optional file path to limit the diff to.",
        },
      },
    },
    riskLevel: "read",
  },
  async execute(args, ctx: ToolContext) {
    try {
      const git = client(ctx.projectRoot);
      const diff = args.path
        ? await git.diff([String(args.path)])
        : await git.diff();
      return ok(diff || "(no changes)");
    } catch (err) {
      return fail(`git diff failed: ${(err as Error).message}`);
    }
  },
};

export const gitLogTool: Tool = {
  definition: {
    name: "git_log",
    description: "Show recent commit history.",
    parameters: {
      type: "object",
      properties: {
        maxCount: {
          type: "number",
          description: "Max commits to show (default 10).",
        },
      },
    },
    riskLevel: "read",
  },
  async execute(args, ctx: ToolContext) {
    try {
      const git = client(ctx.projectRoot);
      const maxCount = typeof args.maxCount === "number" ? args.maxCount : 10;
      const log = await git.log({ maxCount });
      const lines = log.all.map(
        (c) => `${c.hash.slice(0, 8)} ${c.date.slice(0, 10)} ${c.message}`,
      );
      return ok(lines.join("\n") || "(no commits yet)");
    } catch (err) {
      return fail(`git log failed: ${(err as Error).message}`);
    }
  },
};

export const gitCommitTool: Tool = {
  definition: {
    name: "git_commit",
    description:
      "Stage all tracked changes and create a commit with the given message. Never force-pushes or rewrites history.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Commit message." },
      },
      required: ["message"],
    },
    riskLevel: "write",
  },
  async execute(args, ctx: ToolContext) {
    try {
      const git = client(ctx.projectRoot);
      const status = await git.status();
      if (status.files.length === 0)
        return ok("Nothing to commit — working tree clean.");
      await git.add(["-A"]);
      const message = String(args.message ?? "Automated commit");
      const result = await git.commit(message);
      return ok(
        `Committed ${result.summary.changes} change(s) as ${result.commit}: "${message}"`,
        result,
      );
    } catch (err) {
      return fail(`git commit failed: ${(err as Error).message}`);
    }
  },
};

export const gitTools: Tool[] = [
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
];

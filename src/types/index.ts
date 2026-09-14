/**
 * Core shared types for the agent.
 */

export type PermissionMode = "safe" | "ask" | "auto";



export interface ProjectInfo {
  root: string;
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  fileCount: number;
  hasGit: boolean;
  gitBranch?: string;
  testCommand?: string;
  lintCommand?: string;
  formatCommand?: string;
}
import fs from "node:fs";
import path from "node:path";
import ignoreFactory from "ignore";
import type { ProjectInfo } from "../types/index.js";
interface FrameworkSignal {
  file?: string;
  dependency?: string;
  framework: string;
}
const FRAMEWORK_SIGNALS: FrameworkSignal[] = [
  { dependency: "react", framework: "React" },
  { dependency: "next", framework: "Next.js" },
  { dependency: "vue", framework: "Vue" },
  { dependency: "express", framework: "Express" },
  { dependency: "fastify", framework: "Fastify" },
  { dependency: "@nestjs/core", framework: "NestJS" },
  { dependency: "django", framework: "Django" },
  { dependency: "flask", framework: "Flask" },
  { dependency: "fastapi", framework: "FastAPI" },
  { file: "go.mod", framework: "Go modules" },
  { file: "Cargo.toml", framework: "Cargo (Rust)" },
];
const DEFAULT_IGNORES = [
  "node_modules",
  ".git",
  ".agent",
  "dist",
  "build",
  "coverage",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  "*.lock",
];
const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
  ".cpp": "C++",
  ".c": "C",
  ".swift": "Swift",
  ".kt": "Kotlin",
};
let cachedFileList: { root: string; ignore: string[]; files: string[] } | null =
  null;

export function invalidateFileListCache(): void {
  cachedFileList = null;
}

function buildIgnoreMatcher(projectRoot: string, extraIgnores: string[]) {
  const ig = ignoreFactory().add(DEFAULT_IGNORES).add(extraIgnores);
  const gitignorePath = path.join(projectRoot, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    ig.add(fs.readFileSync(gitignorePath, "utf-8"));
  }
  return ig;
}
function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}


function detectFrameworksAndPackageManagers(
  projectRoot: string,
  files: Set<string>,
): {
  frameworks: string[];
  packageManagers: string[];
} {
  const frameworks = new Set<string>();
  const packageManagers = new Set<string>();

  const pkgPath = path.join(projectRoot, "package.json");
  let deps: Record<string, string> = {};
  if (fs.existsSync(pkgPath)) {
    const pkg = readJsonSafe(pkgPath);
    if (pkg) {
      deps = { ...(pkg.dependencies as any), ...(pkg.devDependencies as any) };
      if (files.has("package-lock.json")) packageManagers.add("npm");
      if (files.has("yarn.lock")) packageManagers.add("yarn");
      if (files.has("pnpm-lock.yaml")) packageManagers.add("pnpm");
      if (!packageManagers.size) packageManagers.add("npm");
    }
  }
  if (files.has("requirements.txt") || files.has("pyproject.toml")) {
    packageManagers.add(files.has("pyproject.toml") ? "poetry/pip" : "pip");
  }
  if (files.has("Gemfile")) packageManagers.add("bundler");
  if (files.has("go.mod")) packageManagers.add("go modules");
  if (files.has("Cargo.toml")) packageManagers.add("cargo");

  for (const signal of FRAMEWORK_SIGNALS) {
    if (signal.dependency && deps[signal.dependency])
      frameworks.add(signal.framework);
    if (signal.file && files.has(signal.file)) frameworks.add(signal.framework);
  }
  // Python framework detection via requirements.txt content.
  const reqPath = path.join(projectRoot, "requirements.txt");
  if (fs.existsSync(reqPath)) {
    const reqContent = fs.readFileSync(reqPath, "utf-8").toLowerCase();
    if (reqContent.includes("django")) frameworks.add("Django");
    if (reqContent.includes("flask")) frameworks.add("Flask");
    if (reqContent.includes("fastapi")) frameworks.add("FastAPI");
  }

  return { frameworks: [...frameworks], packageManagers: [...packageManagers] };
}

function detectLanguages(files: string[]): string[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    const ext = path.extname(f);
    const lang = LANGUAGE_BY_EXT[ext];
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}

function detectCommands(projectRoot: string): {
  test?: string;
  lint?: string;
  format?: string;
} {
  const pkgPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = readJsonSafe(pkgPath);
    const scripts = (pkg?.scripts as Record<string, string>) ?? {};
    return {
      test: scripts.test ? "npm test" : undefined,
      lint: scripts.lint ? "npm run lint" : undefined,
      format: scripts.format ? "npm run format" : undefined,
    };
  }
  if (
    fs.existsSync(path.join(projectRoot, "pyproject.toml")) ||
    fs.existsSync(path.join(projectRoot, "pytest.ini"))
  ) {
    return { test: "pytest", lint: "ruff check .", format: "ruff format ." };
  }
  return {};
}


export function listProjectFiles(
  projectRoot: string,
  extraIgnores: string[] = [],
): string[] {
  const cacheKey = JSON.stringify(extraIgnores);
  if (
    cachedFileList &&
    cachedFileList.root === projectRoot &&
    JSON.stringify(cachedFileList.ignore) === cacheKey
  ) {
    return cachedFileList.files;
  }

  const ig = buildIgnoreMatcher(projectRoot, extraIgnores);
  const files: string[] = [];

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(projectRoot, abs);
      if (ig.ignores(rel)) continue;
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }

  walk(projectRoot);
  cachedFileList = { root: projectRoot, ignore: extraIgnores, files };
  return files;
}


export function buildProjectInfo(
  projectRoot: string,
  extraIgnores: string[] = [],
): ProjectInfo {
  const files = listProjectFiles(projectRoot, extraIgnores);
  const fileSet = new Set(files.map((f) => path.basename(f)));
  const { frameworks, packageManagers } = detectFrameworksAndPackageManagers(
    projectRoot,
    fileSet,
  );
  const commands = detectCommands(projectRoot);
  const hasGit = fs.existsSync(path.join(projectRoot, ".git"));

  let gitBranch: string | undefined;
  const headPath = path.join(projectRoot, ".git", "HEAD");
  if (hasGit && fs.existsSync(headPath)) {
    const head = fs.readFileSync(headPath, "utf-8").trim();
    const match = head.match(/ref: refs\/heads\/(.+)/);
    gitBranch = match ? match[1] : head.slice(0, 8);
  }

  return {
    root: projectRoot,
    languages: detectLanguages(files),
    frameworks,
    packageManagers,
    fileCount: files.length,
    hasGit,
    gitBranch,
    testCommand: commands.test,
    lintCommand: commands.lint,
    formatCommand: commands.format,
  };
}

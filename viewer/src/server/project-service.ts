import { readdir, stat } from "fs/promises";
import path from "path";
import type { Project } from "../shared/types.js";

const CLAUDE_HOME = process.env.HOME
  ? path.join(process.env.HOME, ".claude")
  : "/root/.claude";
const PROJECTS_DIR = path.join(CLAUDE_HOME, "projects");

export function encodeProjectId(dirName: string): string {
  return Buffer.from(dirName).toString("base64url");
}

export function decodeProjectId(id: string): string {
  return Buffer.from(id, "base64url").toString("utf-8");
}

export async function listProjects(): Promise<Project[]> {
  const projects: Project[] = [];

  let entries: string[];
  try {
    entries = await readdir(PROJECTS_DIR);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (entry === "." || entry === "..") continue;
    const dirPath = path.join(PROJECTS_DIR, entry);

    try {
      const s = await stat(dirPath);
      if (!s.isDirectory()) continue;

      const files = await readdir(dirPath);
      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
      if (jsonlFiles.length === 0) continue;

      // Find latest modified jsonl
      let lastMod = new Date(0);
      for (const f of jsonlFiles) {
        const fstat = await stat(path.join(dirPath, f));
        if (fstat.mtime > lastMod) lastMod = fstat.mtime;
      }

      // Derive display name from directory name
      // Format is like: -Users-zhangchaojie-Desktop-nanoclaw
      // or for viewer groups it's just the group name
      const name = entry.startsWith("-")
        ? entry.split("-").filter(Boolean).pop() || entry
        : entry;

      projects.push({
        id: encodeProjectId(entry),
        name,
        path: entry,
        sessionCount: jsonlFiles.length,
        lastModified: lastMod.toISOString(),
      });
    } catch {
      // skip inaccessible dirs
    }
  }

  projects.sort(
    (a, b) =>
      new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
  );
  return projects;
}

export function getProjectDir(projectId: string): string {
  const dirName = decodeProjectId(projectId);
  return path.join(PROJECTS_DIR, dirName);
}

import { readdir, stat } from "fs/promises";
import path from "path";
import type { SessionMeta } from "../shared/types.js";
import { getProjectDir } from "./project-service.js";
import { parseJsonlWithToolResults } from "./parse-jsonl.js";

export async function listSessions(projectId: string): Promise<SessionMeta[]> {
  const dir = getProjectDir(projectId);
  const sessions: SessionMeta[] = [];

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

  for (const f of jsonlFiles) {
    const filePath = path.join(dir, f);
    try {
      const s = await stat(filePath);
      const id = f.replace(".jsonl", "");

      // Try to extract title from first user message
      let title = id.slice(0, 8) + "...";
      let messageCount = 0;
      try {
        const { entries } = await parseJsonlWithToolResults(filePath);
        messageCount = entries.length;
        const firstUser = entries.find((e) => e.type === "user");
        if (firstUser) {
          const content = firstUser.message.content;
          const text =
            typeof content === "string"
              ? content
              : content
                  .filter(
                    (b): b is { type: "text"; text: string } =>
                      b.type === "text",
                  )
                  .map((b) => b.text)
                  .join(" ");
          title = text.slice(0, 80) || title;
        }
      } catch {
        // use default title
      }

      sessions.push({
        id,
        title,
        lastModified: s.mtime.toISOString(),
        messageCount,
      });
    } catch {
      // skip
    }
  }

  sessions.sort(
    (a, b) =>
      new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
  );
  return sessions;
}

export async function getSession(projectId: string, sessionId: string) {
  const dir = getProjectDir(projectId);
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  return parseJsonlWithToolResults(filePath);
}

import { readdir, stat } from "fs/promises";
import path from "path";
import type { SessionMeta, SubagentConversation, ToolResultBlock } from "../shared/types.js";
import { parseJsonlWithToolResults, parseSubagentJsonl } from "./parse-jsonl.js";

const TASKS_DIR = path.resolve(process.cwd(), "..", "data", "sessions", "tasks");

export interface TaskMeta {
  id: string;
  name: string;
  sessionCount: number;
  lastModified: string;
}

export async function listTasks(): Promise<TaskMeta[]> {
  const tasks: TaskMeta[] = [];

  let entries: string[];
  try {
    entries = await readdir(TASKS_DIR);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.startsWith("task-")) continue;
    const taskDir = path.join(TASKS_DIR, entry);

    try {
      const s = await stat(taskDir);
      if (!s.isDirectory()) continue;

      // Find JSONL files inside .claude/projects/-workspace-group/
      const sessionsDir = path.join(taskDir, ".claude", "projects", "-workspace-group");
      let jsonlFiles: string[] = [];
      try {
        const files = await readdir(sessionsDir);
        jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }

      if (jsonlFiles.length === 0) continue;

      // Find latest modified jsonl
      let lastMod = new Date(0);
      for (const f of jsonlFiles) {
        try {
          const fstat = await stat(path.join(sessionsDir, f));
          if (fstat.mtime > lastMod) lastMod = fstat.mtime;
        } catch {
          // skip
        }
      }

      tasks.push({
        id: entry,
        name: entry,
        sessionCount: jsonlFiles.length,
        lastModified: lastMod.toISOString(),
      });
    } catch {
      // skip inaccessible dirs
    }
  }

  tasks.sort(
    (a, b) =>
      new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
  );
  return tasks;
}

function getTaskSessionsDir(taskId: string): string {
  return path.join(TASKS_DIR, taskId, ".claude", "projects", "-workspace-group");
}

export async function listTaskSessions(taskId: string): Promise<SessionMeta[]> {
  const dir = getTaskSessionsDir(taskId);
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

export async function getTaskSession(taskId: string, sessionId: string) {
  const dir = getTaskSessionsDir(taskId);
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  const { entries, toolResults } = await parseJsonlWithToolResults(filePath);

  // Scan for subagent conversations
  const subagents: Record<string, SubagentConversation> = {};
  const subagentsDir = path.join(dir, sessionId, "subagents");
  try {
    const files = await readdir(subagentsDir);
    for (const f of files) {
      if (!f.startsWith("agent-") || !f.endsWith(".jsonl")) continue;
      const agentId = f.replace(/^agent-/, "").replace(/\.jsonl$/, "");
      try {
        const result = await parseSubagentJsonl(path.join(subagentsDir, f));
        const toolResultsObj: Record<string, ToolResultBlock> = {};
        for (const [k, v] of result.toolResults) {
          toolResultsObj[k] = v;
        }
        subagents[agentId] = {
          agentId,
          entries: result.entries,
          toolResults: toolResultsObj,
        };
      } catch {
        // skip unreadable subagent files
      }
    }
  } catch {
    // no subagents directory
  }

  return { entries, toolResults, subagents };
}

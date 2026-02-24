import { readFile } from "fs/promises";
import type { ConversationEntry, ToolResultBlock } from "../shared/types.js";

interface RawEntry {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  isSidechain?: boolean;
  message?: {
    role: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content: any;
  };
  summary?: string;
}

const SKIP_TYPES = new Set([
  "progress",
  "custom-title",
  "agent-name",
  "file-history-snapshot",
]);

export async function parseJsonl(
  filePath: string,
): Promise<ConversationEntry[]> {
  const raw = await readFile(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());

  const entries: ConversationEntry[] = [];
  const toolResults = new Map<string, ToolResultBlock>();

  // First pass: collect all tool results from user messages
  for (const line of lines) {
    try {
      const parsed: RawEntry = JSON.parse(line);
      if (parsed.type !== "user" || !parsed.message) continue;

      const content = parsed.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (
          block &&
          typeof block === "object" &&
          "type" in block &&
          block.type === "tool_result" &&
          "tool_use_id" in block
        ) {
          toolResults.set(
            block.tool_use_id as string,
            block as ToolResultBlock,
          );
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  // Second pass: build conversation entries
  for (const line of lines) {
    try {
      const parsed: RawEntry = JSON.parse(line);

      if (SKIP_TYPES.has(parsed.type)) continue;
      if (parsed.isSidechain) continue;
      if (!parsed.message && parsed.type !== "summary") continue;

      if (parsed.type === "summary") {
        entries.push({
          type: "summary",
          uuid: parsed.uuid || crypto.randomUUID(),
          parentUuid: parsed.parentUuid || null,
          timestamp: parsed.timestamp || "",
          isSidechain: false,
          message: {
            role: "system",
            content: parsed.summary || "",
          },
        });
        continue;
      }

      if (
        parsed.type === "user" ||
        parsed.type === "assistant" ||
        parsed.type === "system"
      ) {
        // For user messages, filter out tool_result blocks (they're matched to tool_use)
        let content = parsed.message!.content;
        if (parsed.type === "user" && Array.isArray(content)) {
          content = content.filter(
            (b: Record<string, unknown>) => b.type !== "tool_result",
          );
          // If only tool results, skip this entry
          if (content.length === 0) continue;
        }

        entries.push({
          type: parsed.type as ConversationEntry["type"],
          uuid: parsed.uuid || crypto.randomUUID(),
          parentUuid: parsed.parentUuid || null,
          timestamp: parsed.timestamp || "",
          isSidechain: false,
          message: {
            role: parsed.message!.role,
            content,
          },
        });
      }
    } catch {
      // skip malformed lines
    }
  }

  return entries;
}

export function getToolResults(): Map<string, ToolResultBlock> {
  // This is extracted during parseJsonl - callers should use parseJsonlWithToolResults
  return new Map();
}

export async function parseJsonlWithToolResults(filePath: string): Promise<{
  entries: ConversationEntry[];
  toolResults: Map<string, ToolResultBlock>;
}> {
  const raw = await readFile(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());

  const entries: ConversationEntry[] = [];
  const toolResults = new Map<string, ToolResultBlock>();

  // Collect tool results
  for (const line of lines) {
    try {
      const parsed: RawEntry = JSON.parse(line);
      if (parsed.type !== "user" || !parsed.message) continue;

      const content = parsed.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (
          block &&
          typeof block === "object" &&
          "type" in block &&
          block.type === "tool_result" &&
          "tool_use_id" in block
        ) {
          toolResults.set(
            block.tool_use_id as string,
            block as ToolResultBlock,
          );
        }
      }
    } catch {
      // skip
    }
  }

  // Build entries
  for (const line of lines) {
    try {
      const parsed: RawEntry = JSON.parse(line);

      if (SKIP_TYPES.has(parsed.type)) continue;
      if (parsed.isSidechain) continue;
      if (!parsed.message && parsed.type !== "summary") continue;

      if (parsed.type === "summary") {
        entries.push({
          type: "summary",
          uuid: parsed.uuid || crypto.randomUUID(),
          parentUuid: parsed.parentUuid || null,
          timestamp: parsed.timestamp || "",
          isSidechain: false,
          message: {
            role: "system",
            content: parsed.summary || "",
          },
        });
        continue;
      }

      if (
        parsed.type === "user" ||
        parsed.type === "assistant" ||
        parsed.type === "system"
      ) {
        let content = parsed.message!.content;
        if (parsed.type === "user" && Array.isArray(content)) {
          content = content.filter(
            (b: Record<string, unknown>) => b.type !== "tool_result",
          );
          if (content.length === 0) continue;
        }

        entries.push({
          type: parsed.type as ConversationEntry["type"],
          uuid: parsed.uuid || crypto.randomUUID(),
          parentUuid: parsed.parentUuid || null,
          timestamp: parsed.timestamp || "",
          isSidechain: false,
          message: {
            role: parsed.message!.role,
            content,
          },
        });
      }
    } catch {
      // skip
    }
  }

  return { entries, toolResults };
}

/**
 * Parse a subagent JSONL file. Same as parseJsonlWithToolResults but does NOT
 * skip isSidechain entries (subagent entries are all marked as sidechain).
 */
export async function parseSubagentJsonl(filePath: string): Promise<{
  entries: ConversationEntry[];
  toolResults: Map<string, ToolResultBlock>;
}> {
  const raw = await readFile(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());

  const entries: ConversationEntry[] = [];
  const toolResults = new Map<string, ToolResultBlock>();

  // Collect tool results
  for (const line of lines) {
    try {
      const parsed: RawEntry = JSON.parse(line);
      if (parsed.type !== "user" || !parsed.message) continue;

      const content = parsed.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (
          block &&
          typeof block === "object" &&
          "type" in block &&
          block.type === "tool_result" &&
          "tool_use_id" in block
        ) {
          toolResults.set(
            block.tool_use_id as string,
            block as ToolResultBlock,
          );
        }
      }
    } catch {
      // skip
    }
  }

  // Build entries — do NOT skip isSidechain
  for (const line of lines) {
    try {
      const parsed: RawEntry = JSON.parse(line);

      if (SKIP_TYPES.has(parsed.type)) continue;
      if (!parsed.message && parsed.type !== "summary") continue;

      if (parsed.type === "summary") {
        entries.push({
          type: "summary",
          uuid: parsed.uuid || crypto.randomUUID(),
          parentUuid: parsed.parentUuid || null,
          timestamp: parsed.timestamp || "",
          isSidechain: false,
          message: {
            role: "system",
            content: parsed.summary || "",
          },
        });
        continue;
      }

      if (
        parsed.type === "user" ||
        parsed.type === "assistant" ||
        parsed.type === "system"
      ) {
        let content = parsed.message!.content;
        if (parsed.type === "user" && Array.isArray(content)) {
          content = content.filter(
            (b: Record<string, unknown>) => b.type !== "tool_result",
          );
          if (content.length === 0) continue;
        }

        entries.push({
          type: parsed.type as ConversationEntry["type"],
          uuid: parsed.uuid || crypto.randomUUID(),
          parentUuid: parsed.parentUuid || null,
          timestamp: parsed.timestamp || "",
          isSidechain: false,
          message: {
            role: parsed.message!.role,
            content,
          },
        });
      }
    } catch {
      // skip
    }
  }

  return { entries, toolResults };
}

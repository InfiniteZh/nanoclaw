export interface Project {
  id: string;
  name: string;
  path: string;
  sessionCount: number;
  lastModified: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  lastModified: string;
  messageCount: number;
}

export interface ConversationEntry {
  type: "user" | "assistant" | "system" | "summary";
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  isSidechain: boolean;
  message: Message;
}

export interface Message {
  role: string;
  content: string | ContentBlock[];
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | ImageBlock;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | ContentBlock[];
}

export interface ImageBlock {
  type: "image";
  source: {
    type: string;
    media_type: string;
    data: string;
  };
}

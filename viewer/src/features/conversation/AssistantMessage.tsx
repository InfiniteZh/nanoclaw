import type {
  ConversationEntry,
  ContentBlock,
  ToolResultBlock,
  SubagentConversation,
} from "../../shared/types";
import { MarkdownContent } from "../../components/MarkdownContent";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolUseBlock } from "./ToolUseBlock";
import { SubagentBlock } from "./SubagentBlock";
import { useApp } from "../../components/ThemeProvider";

interface Props {
  entry: ConversationEntry;
  toolResults: Record<string, ToolResultBlock>;
  subagents?: Record<string, SubagentConversation>;
}

function extractAgentId(toolResult?: ToolResultBlock): string | null {
  if (!toolResult) return null;
  const text =
    typeof toolResult.content === "string"
      ? toolResult.content
      : JSON.stringify(toolResult.content);
  const match = text.match(/agentId:\s*([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

export function AssistantMessage({ entry, toolResults, subagents }: Props) {
  const { t } = useApp();
  const content = entry.message.content;

  if (typeof content === "string") {
    return (
      <div className="mb-4">
        <div className="text-xs text-(--color-text-secondary) mb-1">
          {t("conversation.assistant")}
          <span className="ml-2 opacity-60">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div className="max-w-[80%] bg-(--color-bg-secondary) rounded-2xl rounded-tl-sm px-4 py-2.5">
          <MarkdownContent content={content} />
        </div>
      </div>
    );
  }

  const blocks = content as ContentBlock[];
  const textBlocks = blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const thinkingBlocks = blocks.filter(
    (b): b is { type: "thinking"; thinking: string } => b.type === "thinking",
  );

  const toolUseBlocks = blocks.filter(
    (
      b,
    ): b is {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    } => b.type === "tool_use",
  );

  return (
    <div className="mb-4">
      <div className="text-xs text-(--color-text-secondary) mb-1">
        {t("conversation.assistant")}
        <span className="ml-2 opacity-60">
          {new Date(entry.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {thinkingBlocks.map((b, i) => (
        <ThinkingBlock key={i} thinking={b.thinking} />
      ))}

      {textBlocks.trim() && (
        <div className="max-w-[80%] bg-(--color-bg-secondary) rounded-2xl rounded-tl-sm px-4 py-2.5 mb-2">
          <MarkdownContent content={textBlocks} />
        </div>
      )}

      {toolUseBlocks.map((b) => {
        if (b.name === "Task" && subagents) {
          const agentId = extractAgentId(toolResults[b.id]);
          const subagent = agentId ? subagents[agentId] : null;
          if (subagent) {
            const description =
              (b.input.description as string) ||
              (b.input.prompt as string)?.slice(0, 80) ||
              agentId || "unknown";
            return (
              <SubagentBlock
                key={b.id}
                description={description}
                subagent={subagent}
              />
            );
          }
        }
        return (
          <ToolUseBlock
            key={b.id}
            id={b.id}
            name={b.name}
            input={b.input}
            toolResult={toolResults[b.id]}
          />
        );
      })}
    </div>
  );
}

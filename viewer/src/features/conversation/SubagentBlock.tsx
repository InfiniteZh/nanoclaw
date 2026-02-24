import { useState } from "react";
import { ChevronDown, ChevronRight, Bot } from "lucide-react";
import { useApp } from "../../components/ThemeProvider";
import type { SubagentConversation, ContentBlock } from "../../shared/types";
import { ConversationList } from "./ConversationList";

interface Props {
  description: string;
  subagent: SubagentConversation;
}

export function SubagentBlock({ description, subagent }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useApp();

  const messageCount = subagent.entries.length;

  // Extract first text content for preview
  const firstAssistant = subagent.entries.find((e) => e.type === "assistant");
  let preview = "";
  if (firstAssistant) {
    const content = firstAssistant.message.content;
    if (typeof content === "string") {
      preview = content.slice(0, 100);
    } else {
      const textBlock = (content as ContentBlock[]).find(
        (b): b is { type: "text"; text: string } => b.type === "text",
      );
      if (textBlock) preview = textBlock.text.slice(0, 100);
    }
  }

  return (
    <div className="border border-(--color-tool-border) bg-(--color-tool-bg) rounded-lg mb-2 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium hover:opacity-80 transition-opacity"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <Bot className="w-4 h-4" />
        <span className="truncate flex-1 text-left">
          {t("conversation.subagent")}: {description}
        </span>
        <span className="text-xs text-(--color-text-secondary) shrink-0">
          {messageCount} {t("session.messages")}
        </span>
      </button>
      {!expanded && preview && (
        <div className="px-3 pb-2 text-xs text-(--color-text-secondary) truncate">
          {preview}...
        </div>
      )}
      {expanded && (
        <div className="border-t border-(--color-tool-border)">
          <ConversationList
            entries={subagent.entries}
            toolResults={subagent.toolResults}
          />
        </div>
      )}
    </div>
  );
}

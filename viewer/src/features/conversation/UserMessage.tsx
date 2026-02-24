import type { ConversationEntry, ContentBlock } from "../../shared/types";
import { MarkdownContent } from "../../components/MarkdownContent";
import { useApp } from "../../components/ThemeProvider";

interface Props {
  entry: ConversationEntry;
}

export function UserMessage({ entry }: Props) {
  const { t } = useApp();
  const content = entry.message.content;

  const textContent =
    typeof content === "string"
      ? content
      : (content as ContentBlock[])
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("\n");

  if (!textContent.trim()) return null;

  return (
    <div className="flex justify-end mb-4">
      <div className="max-w-[80%]">
        <div className="text-xs text-(--color-text-secondary) mb-1 text-right">
          {t("conversation.user")}
          <span className="ml-2 opacity-60">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div className="user-bubble-content bg-(--color-user-bubble) text-(--color-user-text) rounded-2xl rounded-tr-sm px-4 py-2.5">
          <MarkdownContent content={textContent} />
        </div>
      </div>
    </div>
  );
}

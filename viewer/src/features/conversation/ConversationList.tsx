import type { ConversationEntry, ToolResultBlock } from "../../shared/types";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { SystemMessage } from "./SystemMessage";
import { useApp } from "../../components/ThemeProvider";

interface Props {
  entries: ConversationEntry[];
  toolResults: Record<string, ToolResultBlock>;
}

export function ConversationList({ entries, toolResults }: Props) {
  const { t } = useApp();

  return (
    <div className="space-y-1 p-4 max-w-4xl mx-auto">
      {entries.map((entry) => {
        switch (entry.type) {
          case "user":
            return <UserMessage key={entry.uuid} entry={entry} />;
          case "assistant":
            return (
              <AssistantMessage
                key={entry.uuid}
                entry={entry}
                toolResults={toolResults}
              />
            );
          case "system":
            return (
              <SystemMessage
                key={entry.uuid}
                content={
                  typeof entry.message.content === "string"
                    ? entry.message.content
                    : JSON.stringify(entry.message.content)
                }
              />
            );
          case "summary":
            return (
              <SystemMessage
                key={entry.uuid}
                content={
                  typeof entry.message.content === "string"
                    ? entry.message.content
                    : JSON.stringify(entry.message.content)
                }
                label={t("conversation.summary")}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

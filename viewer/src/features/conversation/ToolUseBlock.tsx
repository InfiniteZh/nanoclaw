import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { useApp } from "../../components/ThemeProvider";
import type { ToolResultBlock } from "../../shared/types";

interface Props {
  id: string;
  name: string;
  input: Record<string, unknown>;
  toolResult?: ToolResultBlock;
}

export function ToolUseBlock({ name, input, toolResult }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useApp();

  const resultText = toolResult
    ? typeof toolResult.content === "string"
      ? toolResult.content
      : JSON.stringify(toolResult.content, null, 2)
    : null;

  // Truncate long results for display
  const displayResult =
    resultText && resultText.length > 2000
      ? resultText.slice(0, 2000) + "\n... (truncated)"
      : resultText;

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
        <Wrench className="w-4 h-4" />
        {t("conversation.toolUse")}: {name}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <pre className="text-xs bg-(--color-bg-tertiary) rounded p-2 overflow-x-auto max-h-64 overflow-y-auto">
            {JSON.stringify(input, null, 2)}
          </pre>
          {displayResult && (
            <div>
              <div className="text-xs font-medium text-(--color-text-secondary) mb-1">
                {t("conversation.result")}:
              </div>
              <pre className="text-xs bg-(--color-bg-tertiary) rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                {displayResult}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

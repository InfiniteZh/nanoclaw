import { useState } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import { MarkdownContent } from "../../components/MarkdownContent";
import { useApp } from "../../components/ThemeProvider";

interface Props {
  thinking: string;
}

export function ThinkingBlock({ thinking }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useApp();

  return (
    <div className="border border-(--color-thinking-border) bg-(--color-thinking-bg) rounded-lg mb-2 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium hover:opacity-80 transition-opacity"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <Brain className="w-4 h-4" />
        {t("conversation.thinking")}
      </button>
      {expanded && (
        <div className="px-3 pb-3 text-sm opacity-80">
          <MarkdownContent content={thinking} />
        </div>
      )}
    </div>
  );
}

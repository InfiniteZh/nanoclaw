import { useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { MarkdownContent } from "../../components/MarkdownContent";
import { useApp } from "../../components/ThemeProvider";

interface Props {
  content: string;
  label?: string;
}

export function SystemMessage({ content, label }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useApp();
  const displayLabel = label || t("conversation.system");

  return (
    <div className="border border-(--color-system-border) bg-(--color-system-bg) rounded-lg mb-4 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium hover:opacity-80 transition-opacity"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <Info className="w-4 h-4" />
        {displayLabel}
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          <MarkdownContent content={content} />
        </div>
      )}
    </div>
  );
}

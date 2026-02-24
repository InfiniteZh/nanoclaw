import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import { MessageSquare, Clock, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { useApp } from "../components/ThemeProvider";
import { ConversationList } from "../features/conversation/ConversationList";
import type { SessionMeta, ConversationEntry, ToolResultBlock, SubagentConversation } from "../shared/types";

export function SessionPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSession = searchParams.get("session");
  const { t } = useApp();
  const contentRef = useRef<HTMLDivElement>(null);

  const prevEntryCountRef = useRef(0);
  const isNearBottomRef = useRef(true);

  // Reset scroll state when switching sessions
  useEffect(() => {
    prevEntryCountRef.current = 0;
    isNearBottomRef.current = true;
  }, [selectedSession]);

  const { data: sessions, isLoading: sessionsLoading } = useQuery<
    SessionMeta[]
  >({
    queryKey: ["sessions", projectId],
    queryFn: () => fetch(`/api/projects/${projectId}`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const { data: sessionData, isLoading: sessionLoading } = useQuery<{
    entries: ConversationEntry[];
    toolResults: Record<string, ToolResultBlock>;
    subagents: Record<string, SubagentConversation>;
  }>({
    queryKey: ["session", projectId, selectedSession],
    queryFn: () =>
      fetch(
        `/api/projects/${projectId}/sessions/${selectedSession}`,
      ).then((r) => r.json()),
    enabled: !!selectedSession,
    refetchInterval: 3000,
  });

  // Track whether the user is near the bottom of the scroll container
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onScroll = () => {
      isNearBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll: on first load jump to bottom; on updates only if near bottom
  useEffect(() => {
    if (!sessionData || !contentRef.current) return;
    const count = sessionData.entries.length;
    const isFirstLoad = prevEntryCountRef.current === 0;
    prevEntryCountRef.current = count;

    if (isFirstLoad || isNearBottomRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [sessionData]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Sidebar */}
      <div className="w-72 shrink-0 border-r border-(--color-border) bg-(--color-bg-secondary) overflow-y-auto">
        <div className="p-3">
          <Link
            to="/projects"
            className="flex items-center gap-1 text-sm text-(--color-text-secondary) hover:text-(--color-accent) mb-3"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("nav.projects")}
          </Link>

          {sessionsLoading && (
            <div className="text-sm text-(--color-text-secondary) p-2">
              {t("loading")}
            </div>
          )}

          {sessions?.length === 0 && (
            <div className="text-sm text-(--color-text-secondary) p-2">
              {t("session.noSessions")}
            </div>
          )}

          <div className="space-y-1">
            {sessions?.map((session) => (
              <button
                key={session.id}
                onClick={() => setSearchParams({ session: session.id })}
                className={`w-full text-left p-2.5 rounded-lg text-sm transition-colors ${
                  selectedSession === session.id
                    ? "bg-(--color-accent) text-white"
                    : "hover:bg-(--color-bg-tertiary)"
                }`}
              >
                <div className="line-clamp-2 font-medium leading-snug">
                  {session.title}
                </div>
                <div
                  className={`flex items-center gap-2 mt-1 text-xs ${
                    selectedSession === session.id
                      ? "text-white/70"
                      : "text-(--color-text-secondary)"
                  }`}
                >
                  <span className="flex items-center gap-0.5">
                    <MessageSquare className="w-3 h-3" />
                    {session.messageCount} {t("session.messages")}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Clock className="w-3 h-3" />
                    {new Date(session.lastModified).toLocaleDateString()}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto">
        {!selectedSession && (
          <div className="flex items-center justify-center h-full text-(--color-text-secondary)">
            {t("session.selectSession")}
          </div>
        )}

        {selectedSession && sessionLoading && (
          <div className="flex items-center justify-center h-full text-(--color-text-secondary)">
            {t("loading")}
          </div>
        )}

        {sessionData && (
          <ConversationList
            entries={sessionData.entries}
            toolResults={sessionData.toolResults}
            subagents={sessionData.subagents}
          />
        )}
      </div>
    </div>
  );
}

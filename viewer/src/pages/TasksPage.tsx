import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { MessageSquare, Clock, ListTodo, ChevronRight } from "lucide-react";
import { useApp } from "../components/ThemeProvider";
import { ConversationList } from "../features/conversation/ConversationList";
import type {
  SessionMeta,
  ConversationEntry,
  ToolResultBlock,
  SubagentConversation,
} from "../shared/types";

interface TaskMeta {
  id: string;
  name: string;
  sessionCount: number;
  lastModified: string;
}

export function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTask = searchParams.get("task");
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

  // Fetch all tasks
  const { data: tasks, isLoading: tasksLoading } = useQuery<TaskMeta[]>({
    queryKey: ["tasks"],
    queryFn: () => fetch("/api/tasks").then((r) => r.json()),
    refetchInterval: 5000,
  });

  // Fetch sessions for selected task
  const { data: sessions, isLoading: sessionsLoading } = useQuery<
    SessionMeta[]
  >({
    queryKey: ["taskSessions", selectedTask],
    queryFn: () =>
      fetch(`/api/tasks/${selectedTask}`).then((r) => r.json()),
    enabled: !!selectedTask,
    refetchInterval: 5000,
  });

  // Fetch session data
  const { data: sessionData, isLoading: sessionLoading } = useQuery<{
    entries: ConversationEntry[];
    toolResults: Record<string, ToolResultBlock>;
    subagents: Record<string, SubagentConversation>;
  }>({
    queryKey: ["taskSession", selectedTask, selectedSession],
    queryFn: () =>
      fetch(
        `/api/tasks/${selectedTask}/sessions/${selectedSession}`,
      ).then((r) => r.json()),
    enabled: !!selectedTask && !!selectedSession,
    refetchInterval: 3000,
  });

  // Track scroll position
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

  // Auto-scroll
  useEffect(() => {
    if (!sessionData || !contentRef.current) return;
    const count = sessionData.entries.length;
    const isFirstLoad = prevEntryCountRef.current === 0;
    prevEntryCountRef.current = count;

    if (isFirstLoad || isNearBottomRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [sessionData]);

  const selectTask = (taskId: string) => {
    setSearchParams({ task: taskId });
  };

  const selectSession = (sessionId: string) => {
    setSearchParams({ task: selectedTask!, session: sessionId });
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Left sidebar - tasks list */}
      <div className="w-56 shrink-0 border-r border-(--color-border) bg-(--color-bg-secondary) overflow-y-auto">
        <div className="p-3">
          <h2 className="text-sm font-semibold text-(--color-text-secondary) uppercase tracking-wider mb-2">
            {t("nav.tasks")}
          </h2>

          {tasksLoading && (
            <div className="text-sm text-(--color-text-secondary) p-2">
              {t("loading")}
            </div>
          )}

          {tasks?.length === 0 && (
            <div className="text-sm text-(--color-text-secondary) p-2">
              {t("task.noTasks")}
            </div>
          )}

          <div className="space-y-1">
            {tasks?.map((task) => (
              <button
                key={task.id}
                onClick={() => selectTask(task.id)}
                className={`w-full text-left p-2 rounded-lg text-sm transition-colors ${
                  selectedTask === task.id
                    ? "bg-(--color-accent) text-white"
                    : "hover:bg-(--color-bg-tertiary)"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <ListTodo className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate font-medium text-xs">
                    {task.name.replace("task-", "").slice(0, 16)}
                  </span>
                </div>
                <div
                  className={`flex items-center gap-2 mt-1 text-xs ${
                    selectedTask === task.id
                      ? "text-white/70"
                      : "text-(--color-text-secondary)"
                  }`}
                >
                  <span className="flex items-center gap-0.5">
                    <MessageSquare className="w-3 h-3" />
                    {task.sessionCount} {t("task.sessions")}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Middle - sessions list for selected task */}
      {selectedTask && (
        <div className="w-64 shrink-0 border-r border-(--color-border) bg-(--color-bg-secondary)/50 overflow-y-auto">
          <div className="p-3">
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
                  onClick={() => selectSession(session.id)}
                  className={`w-full text-left p-2.5 rounded-lg text-sm transition-colors ${
                    selectedSession === session.id
                      ? "bg-(--color-accent) text-white"
                      : "hover:bg-(--color-bg-tertiary)"
                  }`}
                >
                  <div className="line-clamp-2 font-medium leading-snug text-xs">
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
      )}

      {/* Main content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto">
        {!selectedTask && (
          <div className="flex flex-col items-center justify-center h-full text-(--color-text-secondary) gap-2">
            <ChevronRight className="w-8 h-8 opacity-30" />
            {t("task.selectTask")}
          </div>
        )}

        {selectedTask && !selectedSession && (
          <div className="flex flex-col items-center justify-center h-full text-(--color-text-secondary) gap-2">
            <ChevronRight className="w-8 h-8 opacity-30" />
            {t("task.selectSession")}
          </div>
        )}

        {selectedTask && selectedSession && sessionLoading && (
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

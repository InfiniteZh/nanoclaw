import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FolderOpen, Clock, MessageSquare } from "lucide-react";
import { useApp } from "../components/ThemeProvider";
import type { Project } from "../shared/types";

export function ProjectListPage() {
  const { t } = useApp();
  const { data: projects, isLoading } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => fetch("/api/projects").then((r) => r.json()),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-(--color-text-secondary)">
        {t("loading")}
      </div>
    );
  }

  if (!projects?.length) {
    return (
      <div className="flex items-center justify-center h-64 text-(--color-text-secondary)">
        {t("project.noProjects")}
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">{t("nav.projects")}</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((project) => (
          <Link
            key={project.id}
            to={`/projects/${project.id}`}
            className="block p-4 rounded-xl border border-(--color-border) bg-(--color-bg-secondary) hover:border-(--color-accent) hover:shadow-md transition-all"
          >
            <div className="flex items-start gap-3">
              <FolderOpen className="w-5 h-5 text-(--color-accent) mt-0.5 shrink-0" />
              <div className="min-w-0">
                <h2 className="font-semibold truncate">{project.name}</h2>
                <p className="text-xs text-(--color-text-secondary) truncate mt-0.5">
                  {project.path}
                </p>
                <div className="flex items-center gap-3 mt-2 text-xs text-(--color-text-secondary)">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5" />
                    {project.sessionCount} {t("project.sessions")}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {new Date(project.lastModified).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

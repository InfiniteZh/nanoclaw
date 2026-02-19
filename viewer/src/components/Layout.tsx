import { useState, useRef, useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Settings, Sun, Moon, Monitor, Globe, FolderOpen } from "lucide-react";
import { useApp } from "./ThemeProvider";
import type { Locale } from "../hooks/useLocale";

const THEMES = [
  { value: "light" as const, icon: Sun },
  { value: "dark" as const, icon: Moon },
  { value: "system" as const, icon: Monitor },
];

const LANGUAGES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "zh_CN", label: "中文" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { theme, setTheme, locale, setLocale, t } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="min-h-screen bg-(--color-bg-primary) text-(--color-text-primary)">
      <header className="sticky top-0 z-50 border-b border-(--color-border) bg-(--color-bg-primary)/80 backdrop-blur">
        <div className="flex items-center justify-between px-4 h-14">
          <Link
            to="/projects"
            className="flex items-center gap-2 font-semibold text-lg hover:text-(--color-accent) transition-colors"
          >
            <FolderOpen className="w-5 h-5" />
            {t("app.title")}
          </Link>

          <div className="relative" ref={ref}>
            <button
              onClick={() => setOpen(!open)}
              className="p-2 rounded-lg hover:bg-(--color-bg-tertiary) transition-colors"
            >
              <Settings className="w-5 h-5" />
            </button>

            {open && (
              <div className="absolute right-0 mt-2 w-56 rounded-lg border border-(--color-border) bg-(--color-bg-primary) shadow-lg p-3 space-y-3">
                <div>
                  <label className="text-xs font-medium text-(--color-text-secondary) uppercase tracking-wider">
                    {t("settings.theme")}
                  </label>
                  <div className="flex gap-1 mt-1">
                    {THEMES.map(({ value, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => setTheme(value)}
                        className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-sm transition-colors ${
                          theme === value
                            ? "bg-(--color-accent) text-white"
                            : "hover:bg-(--color-bg-tertiary)"
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {t(`theme.${value}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-(--color-text-secondary) uppercase tracking-wider">
                    {t("settings.language")}
                  </label>
                  <div className="flex flex-col gap-1 mt-1">
                    {LANGUAGES.map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => setLocale(value)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                          locale === value
                            ? "bg-(--color-accent) text-white"
                            : "hover:bg-(--color-bg-tertiary)"
                        }`}
                      >
                        <Globe className="w-3.5 h-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

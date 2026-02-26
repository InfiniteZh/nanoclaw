import { useState, useCallback, useMemo } from "react";
import en from "../i18n/en.json";
import zh_CN from "../i18n/zh_CN.json";

export type Locale = "en" | "zh_CN";

const messages: Record<Locale, Record<string, string>> = {
  en,
  zh_CN,
};

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>(() => {
    return (localStorage.getItem("locale") as Locale) || "en";
  });

  const setLocale = useCallback((l: Locale) => {
    localStorage.setItem("locale", l);
    setLocaleState(l);
  }, []);

  const t = useMemo(() => {
    const m = messages[locale] || messages.en;
    return (key: string): string => m[key] || key;
  }, [locale]);

  return { locale, setLocale, t };
}

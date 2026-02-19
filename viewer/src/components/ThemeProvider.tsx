import { createContext, useContext, type ReactNode } from "react";
import { useTheme } from "../hooks/useTheme";
import { useLocale, type Locale } from "../hooks/useLocale";

interface AppContextType {
  theme: "light" | "dark" | "system";
  setTheme: (t: "light" | "dark" | "system") => void;
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const AppContext = createContext<AppContextType>(null!);

export function useApp() {
  return useContext(AppContext);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useLocale();

  return (
    <AppContext.Provider value={{ theme, setTheme, locale, setLocale, t }}>
      {children}
    </AppContext.Provider>
  );
}

import { useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme"; // harus sama dengan script inline di index.html

/** Tema awal sudah dipasang script di index.html (localStorage → prefers-color-scheme). */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme) ?? "dark",
  );

  const setTheme = (next: Theme) => {
    document.documentElement.dataset.theme = next;
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  };

  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");

  return { theme, setTheme, toggle };
}

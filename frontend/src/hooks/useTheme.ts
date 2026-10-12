import { useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme"; // harus sama dengan script inline di index.html

/** Tema awal sudah dipasang script di index.html (localStorage → prefers-color-scheme). */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme) ?? "dark",
  );

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
  };

  return { theme, toggle };
}

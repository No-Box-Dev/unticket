import { create } from "zustand";

interface ThemeStore {
  dark: boolean;
  toggle: () => void;
}

const stored = typeof window !== "undefined" ? localStorage.getItem("theme") : null;
const prefersDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
const initial = stored ? stored === "dark" : prefersDark;

// Apply immediately to prevent flash
if (typeof document !== "undefined") {
  document.documentElement.classList.toggle("dark", initial);
}

export const useTheme = create<ThemeStore>((set) => ({
  dark: initial,
  toggle: () =>
    set((s) => {
      const next = !s.dark;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
      return { dark: next };
    }),
}));

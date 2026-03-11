import { create } from "zustand";

interface SidebarStore {
  collapsed: boolean;
  mobileOpen: boolean;
  toggleCollapsed: () => void;
  setMobileOpen: (open: boolean) => void;
  /** null = current sprint, number = viewing a past snapshot */
  viewingSprint: number | null;
  setViewingSprint: (n: number | null) => void;
}

const stored = typeof window !== "undefined" ? localStorage.getItem("sidebar-collapsed") : null;

export const useSidebar = create<SidebarStore>((set) => ({
  collapsed: stored === "true",
  mobileOpen: false,
  toggleCollapsed: () =>
    set((s) => {
      const next = !s.collapsed;
      localStorage.setItem("sidebar-collapsed", String(next));
      return { collapsed: next };
    }),
  setMobileOpen: (open) => set({ mobileOpen: open }),
  viewingSprint: null,
  setViewingSprint: (n) => set({ viewingSprint: n }),
}));

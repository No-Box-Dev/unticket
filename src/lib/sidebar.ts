import { create } from "zustand";

interface NavStore {
  /** null = current sprint, number = viewing a past snapshot */
  viewingSprint: number | null;
  setViewingSprint: (n: number | null) => void;
}

export const useSidebar = create<NavStore>((set) => ({
  viewingSprint: null,
  setViewingSprint: (n) => set({ viewingSprint: n }),
}));

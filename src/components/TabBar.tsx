import { useMemo } from "react";
import { cn } from "@/lib/cn";
import type { TabId } from "@/lib/types";

const baseTabs: { id: TabId; label: string }[] = [
  { id: "sprint", label: "Sprint" },
  { id: "backlog", label: "Future Features" },
  { id: "prs", label: "PRs" },
  { id: "issues", label: "Issues" },
  { id: "todos", label: "Todos" },
];

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  isAdmin?: boolean;
}

export function TabBar({ activeTab, onTabChange, isAdmin }: TabBarProps) {
  const tabs = useMemo(() => {
    const t = [...baseTabs];
    if (isAdmin) t.push({ id: "insights", label: "Insights" });
    return t;
  }, [isAdmin]);
  return (
    <div className="bg-white border-b border-stone-200 px-4 sm:px-8 flex gap-0 overflow-x-auto">
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onTabChange(id)}
          className={cn(
            "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer",
            activeTab === id
              ? "border-brand text-brand"
              : "border-transparent text-stone-400 hover:text-stone-600 hover:border-stone-300",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

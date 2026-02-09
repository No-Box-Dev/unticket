import { cn } from "@/lib/cn";
import type { TabId } from "@/lib/types";

const tabs: { id: TabId; label: string }[] = [
  { id: "sprint", label: "Sprint" },
  { id: "backlog", label: "Future Features" },
  { id: "team", label: "Team Dashboard" },
  { id: "individual", label: "Individual Dashboard" },
  { id: "prs", label: "Open PRs" },
  { id: "issues", label: "Open Issues" },
  { id: "activity", label: "Activity" },
];

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
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

import { ChevronUp, ChevronDown } from "lucide-react";

export type SortDirection = "asc" | "desc";

interface SortIconProps<K extends string> {
  column: K;
  activeSortKey: K;
  activeSortDirection: SortDirection;
}

export function SortIcon<K extends string>({
  column,
  activeSortKey,
  activeSortDirection,
}: SortIconProps<K>) {
  if (activeSortKey !== column) return null;
  return activeSortDirection === "asc" ? (
    <ChevronUp className="w-3 h-3 inline ml-0.5" />
  ) : (
    <ChevronDown className="w-3 h-3 inline ml-0.5" />
  );
}

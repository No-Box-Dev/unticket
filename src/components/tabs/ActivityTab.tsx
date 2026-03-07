import { useActivity } from "@/hooks/useGitHub";
import { GitCommit } from "lucide-react";
import { Spinner } from "@/components/Spinner";

interface ActivityTabProps {
  repoNames: string[];
}

export function ActivityTab({ repoNames }: ActivityTabProps) {
  const { data: commits, isLoading } = useActivity(repoNames);

  const grouped = new Map<string, typeof commits>();
  for (const commit of commits ?? []) {
    const date = new Date(commit.commit.author?.date ?? "").toLocaleDateString(
      "en-US",
      { weekday: "short", month: "short", day: "numeric" },
    );
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date)!.push(commit);
  }

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (commits ?? []).length === 0 ? (
        <div className="text-center text-stone-400 py-8">No activity in the last 14 days</div>
      ) : (
        [...grouped.entries()].map(([date, dayCommits]) => (
          <div key={date}>
            <h3 className="text-xs font-medium text-stone-500 mb-2 sticky top-0 bg-stone-50 py-1">
              {date}
              <span className="text-stone-300 ml-2">
                {dayCommits!.length} commits
              </span>
            </h3>
            <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-50">
              {dayCommits!.slice(0, 20).map((commit) => (
                <div
                  key={commit.sha}
                  className="flex items-start gap-3 px-4 py-2.5"
                >
                  <GitCommit className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-stone-800 truncate">
                      {commit.commit.message.split("\n")[0]}
                    </div>
                    <div className="text-xs text-stone-400 flex gap-2">
                      <span>{(commit as { repo?: string }).repo}</span>
                      <span>{commit.commit.author?.name}</span>
                      <code className="text-stone-300">
                        {commit.sha.slice(0, 7)}
                      </code>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

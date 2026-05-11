import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Check, X, Loader2, AlertCircle } from "lucide-react";
import { triggerSyncWithProgress, type SyncProgress } from "@/lib/github";
import { cn } from "@/lib/cn";

interface SyncFromGithubMenuItemProps {
  onAfterStart?: () => void;
}

export function SyncFromGithubMenuItem({ onAfterStart }: SyncFromGithubMenuItemProps) {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [syncedRepos, setSyncedRepos] = useState<string[]>([]);

  const startSync = useCallback(async () => {
    setModalOpen(true);
    setProgress(null);
    setSyncedRepos([]);
    onAfterStart?.();
    let lastSyncingRepo: string | null = null;

    await triggerSyncWithProgress((status) => {
      setProgress(status);
      if (status.phase === "syncing" && status.repo) {
        if (lastSyncingRepo) {
          setSyncedRepos((prev) =>
            prev.includes(lastSyncingRepo!) ? prev : [...prev, lastSyncingRepo!],
          );
        }
        lastSyncingRepo = status.repo;
      }
      if (status.phase === "done") {
        if (lastSyncingRepo) {
          setSyncedRepos((prev) =>
            prev.includes(lastSyncingRepo!) ? prev : [...prev, lastSyncingRepo!],
          );
        }
        qc.invalidateQueries({ queryKey: ["issues"] });
        qc.invalidateQueries({ queryKey: ["prs"] });
        qc.invalidateQueries({ queryKey: ["repos"] });
        qc.invalidateQueries({ queryKey: ["labels"] });
        qc.invalidateQueries({ queryKey: ["members"] });
      }
    }, true /* force full re-sync to pick up label/state changes */);
  }, [qc, onAfterStart]);

  const done = progress?.phase === "done";
  const error = progress?.phase === "error";
  const failedRepos = progress?.failed ?? [];
  const hadPartialFailures = done && failedRepos.length > 0;

  return (
    <>
      <button
        onClick={startSync}
        disabled={modalOpen}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50 cursor-pointer",
          modalOpen && "opacity-50 cursor-not-allowed",
        )}
      >
        <RefreshCw className="w-4 h-4" />
        Sync from GitHub
      </button>

      {modalOpen &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
            <div role="dialog" aria-modal="true" className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
                <h3 className="text-sm font-semibold text-stone-800">
                  {error
                    ? "Sync Failed"
                    : hadPartialFailures
                      ? "Sync Complete (with errors)"
                      : done
                        ? "Sync Complete"
                        : "Syncing from GitHub"}
                </h3>
                {(done || error) && (
                  <button
                    onClick={() => setModalOpen(false)}
                    className="text-stone-400 hover:text-stone-600 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="px-5 py-4 space-y-3">
                {progress && progress.total > 0 && (
                  <div>
                    <div className="flex justify-between text-xs text-stone-500 mb-1">
                      <span>
                        {done
                          ? "All repos synced"
                          : `Syncing repo ${Math.min(syncedRepos.length + 1, progress.total)} of ${progress.total}`}
                      </span>
                      <span>
                        {Math.round(((done ? progress.total : syncedRepos.length) / progress.total) * 100)}%
                      </span>
                    </div>
                    <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
                          error ? "bg-red-500" : "bg-accent",
                        )}
                        style={{
                          width: `${((done ? progress.total : syncedRepos.length) / progress.total) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                {progress?.phase === "init" && (
                  <div className="flex items-center gap-2 text-xs text-stone-500">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Initializing sync...
                  </div>
                )}
                {error && (
                  <div className="flex items-center gap-2 text-xs text-red-600">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {progress.error}
                  </div>
                )}
                {progress?.phase === "syncing" && progress.repo && (
                  <div className="flex items-center gap-2 text-xs text-stone-600">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                    <span className="font-medium">{progress.repo}</span>
                  </div>
                )}
                {(syncedRepos.length > 0 || failedRepos.length > 0) && (
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {syncedRepos.map((repo) => (
                      <div key={repo} className="flex items-center gap-2 text-xs text-stone-500">
                        <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        {repo}
                      </div>
                    ))}
                    {failedRepos.map((repo) => (
                      <div key={`failed-${repo}`} className="flex items-center gap-2 text-xs text-red-600">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span className="font-medium">{repo}</span>
                        <span className="text-stone-400">— failed, will retry on next cron tick</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {(done || error) && (
                <div className="px-5 py-3 border-t border-stone-100">
                  <button
                    onClick={() => setModalOpen(false)}
                    className="w-full px-4 py-2 text-xs font-medium text-white bg-accent rounded-lg hover:bg-accent/90 cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

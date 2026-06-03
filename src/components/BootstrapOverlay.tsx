import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Spinner } from "@/components/Spinner";
import { useBootstrapStatus } from "@/hooks/useBootstrapStatus";

// How long to wait before offering an escape hatch. The bootstrap backfill
// runs as a queued background job; if it dies (terminal queue failure) the
// org's bootstrapped_at never flips and this overlay would otherwise spin
// forever. After this window we let the user proceed to the (partially
// populated) dashboard instead of trapping them.
const STUCK_AFTER_MS = 90_000;

// Full-bleed overlay shown on first visit after a fresh GitHub App install,
// while the webhook handler's bootstrapInstallation backfill runs in the
// background. Replaces the empty-board state users used to see before
// they clicked Sync.
export function BootstrapOverlay() {
  const { data } = useBootstrapStatus();
  const qc = useQueryClient();
  const [stuck, setStuck] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const bootstrapping = !!data?.bootstrapping;

  useEffect(() => {
    if (!bootstrapping) return;
    const timer = setTimeout(() => setStuck(true), STUCK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [bootstrapping]);

  if (!bootstrapping || dismissed) return null;

  function continueAnyway() {
    qc.invalidateQueries();
    setDismissed(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-50/95 backdrop-blur-sm">
      <div className="text-center max-w-sm px-6">
        {!stuck ? (
          <>
            <Spinner className="w-8 h-8 text-accent mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-stone-700 mb-1">Setting up your workspace</h2>
            <p className="text-sm text-stone-500">
              Pulling repos, members, issues, and PRs from GitHub. This usually takes
              under a minute.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-stone-700 mb-1">This is taking longer than usual</h2>
            <p className="text-sm text-stone-500 mb-4">
              Setup may still be finishing in the background, or it may have hit a snag.
              You can continue to the dashboard — if data is missing, run a sync from
              Settings, and check Background failures (admin) for details.
            </p>
            <button
              onClick={continueAnyway}
              className="text-sm font-medium text-white bg-accent hover:opacity-90 rounded-lg px-4 py-2 cursor-pointer"
            >
              Continue to dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { X, Sparkles } from "lucide-react";
import { useUnacknowledgedRepos, useAcknowledgeRepos, useIsAdmin } from "@/hooks/useGitHub";

interface NewRepoBannerProps {
  onReview: () => void;
}

// Top-of-dashboard alert that surfaces newly-discovered repos to admins. Hidden
// for non-admins (they can't act on it anyway) and self-hides when there's
// nothing to show — no skeleton state, banner just isn't rendered.
//
// Dismissal is org-wide: any admin's Dismiss-all marks every listed repo as
// acknowledged and the banner stops appearing for everyone. Per-admin
// dismissal is intentionally out of scope (would need a join table); the
// trade-off is that a fast-finger admin can mute the alert before slower
// admins see it. The TopNav dot still surfaces unacknowledged repos to anyone
// who joins later if any are still unack'd at the moment of view.
export function NewRepoBanner({ onReview }: NewRepoBannerProps) {
  const isAdmin = useIsAdmin();
  const unacked = useUnacknowledgedRepos();
  const ack = useAcknowledgeRepos();
  // A separate hide state covers the brief window between the mutation
  // resolving and React Query invalidating — without it the banner flickers
  // back on after the optimistic empty until the refetch lands.
  const [hidden, setHidden] = useState(false);

  if (!isAdmin) return null;
  if (hidden) return null;
  if (unacked.length === 0) return null;

  const previewNames = unacked.slice(0, 3).map((r) => r.name);
  const moreCount = unacked.length - previewNames.length;
  const previewText = moreCount > 0
    ? `${previewNames.join(", ")}, +${moreCount} more`
    : previewNames.join(", ");

  const handleDismissAll = () => {
    setHidden(true);
    ack.mutate(unacked.map((r) => r.name));
  };

  return (
    <div className="mb-4 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 flex items-start gap-3">
      <Sparkles className="w-5 h-5 text-accent shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-stone-800">
          <span className="font-medium">
            {unacked.length === 1
              ? "1 new repo detected"
              : `${unacked.length} new repos detected`}
          </span>
          <span className="text-stone-500">: {previewText}</span>
        </div>
        <div className="text-xs text-stone-500 mt-0.5">
          Review them in Settings to mark each one tracked or draft.
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onReview}
          className="text-xs font-medium px-2.5 py-1 rounded-md bg-accent text-white hover:bg-accent/90 cursor-pointer"
        >
          Review
        </button>
        <button
          type="button"
          onClick={handleDismissAll}
          disabled={ack.isPending}
          className="text-xs font-medium px-2.5 py-1 rounded-md text-stone-600 hover:bg-stone-100 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Dismiss all
        </button>
        <button
          type="button"
          onClick={handleDismissAll}
          disabled={ack.isPending}
          aria-label="Dismiss"
          className="p-1 rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

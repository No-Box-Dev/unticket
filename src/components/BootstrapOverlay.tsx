import { Spinner } from "@/components/Spinner";
import { useBootstrapStatus } from "@/hooks/useBootstrapStatus";

// Full-bleed overlay shown on first visit after a fresh GitHub App install,
// while the webhook handler's bootstrapInstallation backfill runs in the
// background. Replaces the empty-board state users used to see before
// they clicked Sync.
export function BootstrapOverlay() {
  const { data } = useBootstrapStatus();
  if (!data?.bootstrapping) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-50/95 backdrop-blur-sm">
      <div className="text-center max-w-sm px-6">
        <Spinner className="w-8 h-8 text-accent mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-stone-700 mb-1">Setting up your workspace</h2>
        <p className="text-sm text-stone-500">
          Pulling repos, members, issues, and PRs from GitHub. This usually takes
          under a minute.
        </p>
      </div>
    </div>
  );
}

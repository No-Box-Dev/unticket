import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useOrgs } from "@/hooks/useGitHub";
import { LoginPage } from "@/pages/LoginPage";
import { OrgPickerPage } from "@/pages/OrgPickerPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { Spinner } from "@/components/Spinner";

function ErrorBar() {
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handler = (e: Event) => {
      const { message, status } = (e as CustomEvent).detail;
      setError({ message, status });
      clearTimeout(timer);
      timer = setTimeout(() => setError(null), 10000);
    };
    window.addEventListener("gp:error", handler);
    return () => { window.removeEventListener("gp:error", handler); clearTimeout(timer); };
  }, []);

  if (!error) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[100] bg-red-50 border-b border-red-200 px-4 sm:px-8 py-1.5 flex items-center justify-between cursor-pointer"
      onClick={() => setError(null)}
    >
      <span className="text-xs text-red-600 font-mono truncate">
        {error.status ? <span className="font-semibold mr-1.5">{error.status}</span> : null}
        {error.message}
      </span>
      <span className="text-xs text-red-400 ml-2 shrink-0">dismiss</span>
    </div>
  );
}

export function App() {
  const { user, isLoading, authError, selectedOrg, setSelectedOrg } = useAuth();
  const { data: orgs, isLoading: orgsLoading } = useOrgs();

  // Validate stored org is an actual org (not personal account)
  // and auto-select if there's only one org
  useEffect(() => {
    if (!user || !orgs) return;

    const orgLogins = orgs.map((o) => o.login);

    // If selected org is the user's personal account, clear it
    if (selectedOrg && selectedOrg === user.login) {
      setSelectedOrg(null);
      return;
    }

    // Auto-select if there's only one org and none selected
    if (!selectedOrg && orgLogins.length === 1) {
      setSelectedOrg(orgLogins[0]);
    }
  }, [user, orgs, selectedOrg, setSelectedOrg]);

  if (authError) {
    return (
      <>
        <ErrorBar />
        <div className="min-h-screen bg-stone-50 flex items-center justify-center">
          <div className="text-center space-y-3 max-w-sm mx-auto px-4">
            <div className="text-amber-600 text-sm font-medium">{authError}</div>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand/90 cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      </>
    );
  }

  if (isLoading || (user && orgsLoading)) {
    return (
      <>
        <ErrorBar />
        <div className="min-h-screen bg-stone-50 flex items-center justify-center">
          <Spinner size="lg" />
        </div>
      </>
    );
  }

  if (!user) return <><ErrorBar /><LoginPage /></>;
  if (!selectedOrg) return <><ErrorBar /><OrgPickerPage /></>;
  return <><ErrorBar /><DashboardPage /></>;
}

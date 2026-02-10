import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useOrgs } from "@/hooks/useGitHub";
import { LoginPage } from "@/pages/LoginPage";
import { OrgPickerPage } from "@/pages/OrgPickerPage";
import { DashboardPage } from "@/pages/DashboardPage";

export function App() {
  const { user, isLoading, selectedOrg, setSelectedOrg } = useAuth();
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

  if (isLoading || (user && orgsLoading)) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-stone-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (!user) return <LoginPage />;
  if (!selectedOrg) return <OrgPickerPage />;
  return <DashboardPage />;
}

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useOrgs } from "@/hooks/useGitHub";
import { Activity, Building2 } from "lucide-react";

export function OrgPickerPage() {
  const { setSelectedOrg, logout } = useAuth();
  const { data: orgs, isLoading } = useOrgs();
  const [manualOrg, setManualOrg] = useState("");

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualOrg.trim();
    if (trimmed) setSelectedOrg(trimmed);
  };

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <Activity className="w-8 h-8 text-brand" />
            <h1 className="text-2xl font-bold text-stone-900">GitPulse</h1>
          </div>
          <p className="text-stone-500">
            Choose an organisation to track
          </p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-2">
          {isLoading ? (
            <p className="text-center text-stone-400 py-4">Loading orgs...</p>
          ) : (
            <>
              {orgs?.map((org) => (
                <button
                  key={org.login}
                  onClick={() => setSelectedOrg(org.login)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-stone-50 border border-transparent hover:border-stone-200 transition-colors text-left cursor-pointer"
                >
                  {org.avatar_url ? (
                    <img
                      src={org.avatar_url}
                      alt={org.login}
                      className="w-6 h-6 rounded"
                    />
                  ) : (
                    <Building2 className="w-5 h-5 text-stone-400" />
                  )}
                  <div>
                    <div className="text-sm font-medium text-stone-900">
                      {org.login}
                    </div>
                    {org.description && (
                      <div className="text-xs text-stone-400 truncate max-w-[300px]">
                        {org.description}
                      </div>
                    )}
                  </div>
                </button>
              ))}

              {orgs?.length === 0 && (
                <p className="text-center text-stone-400 py-2 text-sm">
                  No organisations listed. Your org may have third-party app restrictions.
                </p>
              )}
            </>
          )}
        </div>

        {/* Manual org entry — works even when API doesn't list the org */}
        <form onSubmit={handleManualSubmit} className="mt-4 flex gap-2">
          <input
            type="text"
            value={manualOrg}
            onChange={(e) => setManualOrg(e.target.value)}
            placeholder="Enter org name (e.g. n1healthcare)"
            className="flex-1 px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
          <button
            type="submit"
            disabled={!manualOrg.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-brand rounded-lg hover:bg-brand/90 disabled:opacity-40 cursor-pointer"
          >
            Go
          </button>
        </form>

        <button
          onClick={logout}
          className="block mx-auto mt-4 text-xs text-stone-400 hover:text-stone-600 cursor-pointer"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

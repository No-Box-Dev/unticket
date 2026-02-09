import { useAuth } from "@/lib/auth";
import { useOrgs } from "@/hooks/useGitHub";
import { Activity, Building2 } from "lucide-react";

export function OrgPickerPage() {
  const { setSelectedOrg, logout } = useAuth();
  const { data: orgs, isLoading } = useOrgs();

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
                  No organisations found. GitPulse requires a GitHub organisation.
                </p>
              )}
            </>
          )}
        </div>

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

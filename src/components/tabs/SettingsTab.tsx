import { useAuth } from "@/lib/auth";
import { useRepos } from "@/hooks/useGitHub";
import { useSettings, useSaveSettings, usePeople, useSavePeople } from "@/hooks/useConfigRepo";
import { TeamManagement } from "@/components/settings/TeamManagement";
import { PeopleManagement } from "@/components/settings/PeopleManagement";

export function SettingsTab() {
  const { user, selectedOrg, logout } = useAuth();
  const { data: repos } = useRepos();
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const { data: people } = usePeople();
  const savePeople = useSavePeople();

  return (
    <div className="max-w-2xl space-y-6">
      {/* Account */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-stone-900">Account</h2>
        <div className="flex items-center gap-3">
          {user && (
            <img
              src={user.avatar_url}
              alt={user.login}
              className="w-10 h-10 rounded-full"
            />
          )}
          <div>
            <div className="text-sm font-medium text-stone-800">
              {user?.name ?? user?.login}
            </div>
            <div className="text-xs text-stone-400">@{user?.login}</div>
          </div>
        </div>
        <div className="text-xs text-stone-400">
          Organisation: <span className="font-medium text-stone-600">{selectedOrg}</span>
        </div>
        <button
          onClick={logout}
          className="text-xs text-red-500 hover:text-red-700 cursor-pointer"
        >
          Disconnect GitHub
        </button>
      </div>

      {/* Teams */}
      {settings && repos && (
        <TeamManagement
          settings={settings}
          saveSettings={saveSettings}
          repos={repos}
        />
      )}

      {/* People */}
      {people && settings && (
        <PeopleManagement
          people={people}
          savePeople={savePeople}
          teams={settings.teams}
        />
      )}

      {/* Tracked repos */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-stone-900">
          Tracked Repositories ({repos?.length ?? 0})
        </h2>
        <p className="text-xs text-stone-400">
          All repositories in {selectedOrg} are tracked by default. Assign repos
          to teams above to organise your dashboard.
        </p>
        <div className="grid grid-cols-2 gap-1.5 max-h-60 overflow-y-auto">
          {repos?.map((repo) => (
            <div
              key={repo.id}
              className="text-xs text-stone-600 px-2 py-1 rounded bg-stone-50"
            >
              {repo.name}
              {repo.language && (
                <span className="text-stone-300 ml-1">({repo.language})</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* About */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-2">
        <h2 className="text-sm font-semibold text-stone-900">About GitPulse</h2>
        <p className="text-xs text-stone-400">
          AI-powered project management dashboard for GitHub organisations.
          Your token is stored locally — no data is sent to any server.
        </p>
      </div>
    </div>
  );
}

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
          repos={repos as any}
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
          All repositories in {selectedOrg} are tracked by default. Mark repos as
          draft to hide their issues from the Sprint view.
        </p>
        <div className="grid grid-cols-2 gap-1.5 max-h-60 overflow-y-auto">
          {repos?.map((repo) => {
            const isDraft = settings?.draftRepos?.includes(repo.name) ?? false;
            return (
              <button
                key={repo.id}
                onClick={() => {
                  if (!settings) return;
                  const current = settings.draftRepos ?? [];
                  const next = isDraft
                    ? current.filter((r) => r !== repo.name)
                    : [...current, repo.name];
                  saveSettings.mutate({ ...settings, draftRepos: next });
                }}
                className={`text-xs text-left px-2 py-1 rounded cursor-pointer transition-colors ${
                  isDraft
                    ? "bg-stone-100 text-stone-400"
                    : "bg-stone-50 text-stone-600 hover:bg-stone-100"
                }`}
              >
                {repo.name}
                {isDraft && (
                  <span className="ml-1 text-stone-300">(draft)</span>
                )}
                {!isDraft && repo.language && (
                  <span className="text-stone-300 ml-1">({repo.language})</span>
                )}
              </button>
            );
          })}
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

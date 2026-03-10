import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Github, ChevronDown } from "lucide-react";
import { LogoMark } from "@/components/LogoMark";

export function LoginPage() {
  const { authMode, loginWithToken, loginWithOAuth } = useAuth();
  const [showPAT, setShowPAT] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGitHubClick = () => {
    if (authMode === "oauth") {
      loginWithOAuth();
    } else {
      setShowPAT(true);
    }
  };

  const handlePATSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await loginWithToken(token.trim());
    } catch {
      setError("Invalid token. Make sure it has repo and read:org scopes.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-4">
            <LogoMark className="w-9 h-9" />
            <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100 font-display">Unticket</h1>
          </div>
          <p className="text-stone-500 dark:text-stone-400">
            AI-powered project management for GitHub
          </p>
        </div>

        <div className="bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-700 p-6 space-y-4">
          {/* Always show the Sign in with GitHub button */}
          <button
            onClick={handleGitHubClick}
            className="w-full flex items-center justify-center gap-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 py-2.5 rounded-lg text-sm font-medium hover:bg-stone-800 dark:hover:bg-stone-200 transition-colors cursor-pointer"
          >
            <Github className="w-5 h-5" />
            Sign in with GitHub
          </button>

          {/* PAT form — expands below the button */}
          {showPAT && (
            <>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-stone-200 dark:bg-stone-700" />
                <ChevronDown className="w-3.5 h-3.5 text-stone-300" />
                <div className="flex-1 h-px bg-stone-200 dark:bg-stone-700" />
              </div>

              <form onSubmit={handlePATSubmit} className="space-y-3">
                <p className="text-xs text-stone-500">
                  Paste a GitHub personal access token to connect your account.
                </p>
                <input
                  id="token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxx"
                  className="w-full px-3 py-2 border border-stone-300 dark:border-stone-600 rounded-lg text-sm bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                  autoFocus
                  required
                />

                <p className="text-xs text-stone-400">
                  Need a token?{" "}
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo,read:org&description=unticket.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand underline"
                  >
                    Create one here
                  </a>{" "}
                  with{" "}
                  <code className="bg-stone-100 dark:bg-stone-800 px-1 rounded">repo</code> and{" "}
                  <code className="bg-stone-100 dark:bg-stone-800 px-1 rounded">read:org</code>{" "}
                  scopes.
                </p>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading || !token.trim()}
                  className="w-full bg-brand text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-dark disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {loading ? "Connecting..." : "Connect"}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-xs text-stone-400 dark:text-stone-500 mt-4">
          Your credentials stay in your browser. No data leaves your machine.
        </p>
      </div>
    </div>
  );
}

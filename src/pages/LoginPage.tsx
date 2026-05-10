import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Github, ChevronDown } from "lucide-react";

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
    <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-display mb-3 text-stone-800"><span className="font-bold">un</span><span className="font-normal">ticket</span></h1>
          <p className="text-stone-500">
            AI-powered project management for GitHub
          </p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-6 space-y-4">
          {/* Always show the Sign in with GitHub button */}
          <button
            onClick={handleGitHubClick}
            className="w-full flex items-center justify-center gap-2 bg-stone-900 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <Github className="w-5 h-5" />
            Sign in with GitHub
          </button>

          {/* PAT form — expands below the button */}
          {showPAT && (
            <>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-stone-200" />
                <ChevronDown className="w-3.5 h-3.5 text-stone-300" />
                <div className="flex-1 h-px bg-stone-200" />
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
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                  autoFocus
                  required
                />

                <p className="text-xs text-stone-400">
                  Need a token?{" "}
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo,read:org&description=unticket.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline"
                  >
                    Create one here
                  </a>{" "}
                  with{" "}
                  <code className="bg-stone-100 px-1 rounded">repo</code> and{" "}
                  <code className="bg-stone-100 px-1 rounded">read:org</code>{" "}
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
                  className="w-full bg-accent text-white py-2 rounded-lg text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {loading ? "Connecting..." : "Connect"}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-xs text-stone-400 mt-4">
          Your credentials stay in your browser. No data leaves your machine.
        </p>
      </div>
    </div>
  );
}

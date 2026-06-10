import { useAuth } from "@/lib/auth";
import { Github } from "lucide-react";

export function LoginPage() {
  const { loginWithOAuth } = useAuth();

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-display mb-3 text-stone-800"><span className="font-bold">un</span><span className="font-normal">ticket</span></h1>
          <p className="text-stone-500">
            AI-powered project management for GitHub
          </p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-6">
          <button
            onClick={loginWithOAuth}
            className="w-full flex items-center justify-center gap-2 bg-stone-900 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <Github className="w-5 h-5" />
            Sign in with GitHub
          </button>
        </div>

        <p className="text-center text-xs text-stone-400 mt-4">
          Sign in installs the Unticket GitHub App on the orgs you choose. No personal access tokens — ever.
        </p>
      </div>
    </div>
  );
}

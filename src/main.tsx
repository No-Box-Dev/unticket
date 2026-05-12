import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth";
import { shouldNotRetry, broadcastError } from "@/lib/api";
import { tryAutoReload } from "@/lib/chunk-reload";
import { App } from "@/App";
import "./index.css";

// Global handlers for uncaught errors
window.addEventListener("unhandledrejection", (e) => {
  const err = e.reason;
  const msg = err instanceof Error ? err.message : String(err);
  broadcastError(msg);
});

window.addEventListener("error", (e) => {
  broadcastError(e.message);
});

// Auto-reload when a lazy chunk fails to load — typically after a deploy
// replaces the chunks the open SPA was holding references to. tryAutoReload
// shares a per-session budget with the ErrorBoundary so the two paths can't
// reload-loop past it.
window.addEventListener("vite:preloadError", () => {
  tryAutoReload();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: (failureCount, error) => {
        if (shouldNotRetry(error)) return false;
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

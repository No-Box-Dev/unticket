import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth";
import { shouldNotRetry, broadcastError } from "@/lib/api";
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
// replaces the chunks the open SPA was holding references to. The first
// reload picks up the new index.html, but the new chunks may not yet have
// propagated to every CDN edge, so we allow a few spaced retries before
// giving up. Tracked in sessionStorage to avoid loops across navigations.
window.addEventListener("vite:preloadError", () => {
  if (shouldAutoReload()) window.location.reload();
});

const RELOAD_KEY = "preloadErrorReloads";
const MAX_AUTO_RELOADS = 3;
const MIN_RELOAD_INTERVAL_MS = 5000;

function shouldAutoReload(): boolean {
  let entry: { count: number; last: number };
  try {
    entry = JSON.parse(sessionStorage.getItem(RELOAD_KEY) ?? '{"count":0,"last":0}');
  } catch {
    entry = { count: 0, last: 0 };
  }
  const now = Date.now();
  if (entry.count >= MAX_AUTO_RELOADS) return false;
  if (now - entry.last < MIN_RELOAD_INTERVAL_MS) return false;
  sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ count: entry.count + 1, last: now }));
  return true;
}

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

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

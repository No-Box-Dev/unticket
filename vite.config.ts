import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import type { Plugin } from "vite";

/**
 * Vite plugin that handles the OAuth callback locally during dev.
 * Exchanges the GitHub auth code for a token server-side (keeps secret safe).
 */
function oauthDevProxy(): Plugin {
  let clientId: string;
  let clientSecret: string;

  return {
    name: "oauth-dev-proxy",
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, "");
      clientId = env.VITE_GITHUB_APP_CLIENT_ID ?? "";
      clientSecret = env.GITHUB_APP_CLIENT_SECRET ?? "";
    },
    configureServer(server) {
      server.middlewares.use("/api/auth/callback", async (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const code = url.searchParams.get("code");

        if (!code) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing code" }));
          return;
        }

        if (!clientId || !clientSecret) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Set VITE_GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET in .env.local",
            }),
          );
          return;
        }

        const tokenRes = await fetch(
          "https://github.com/login/oauth/access_token",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              client_id: clientId,
              client_secret: clientSecret,
              code,
            }),
          },
        );

        const data = (await tokenRes.json()) as Record<string, string>;

        if (data.error) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: data.error_description }));
          return;
        }

        // Redirect back to app with token
        res.writeHead(302, { Location: `/?token=${data.access_token}` });
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), oauthDevProxy()],
  base: process.env.GITHUB_PAGES === "true" ? "/unticket/" : "/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        // Where the dev server forwards /api/* calls. Override with VITE_API_TARGET
        // to point at your own deployed instance (defaults to the hosted app).
        target: process.env.VITE_API_TARGET ?? "https://app.unticket.ai",
        changeOrigin: true,
        // Don't proxy the OAuth callback — handled by oauthDevProxy above
        bypass(req) {
          if (req.url?.startsWith("/api/auth/callback")) return req.url;
        },
      },
    },
  },
});

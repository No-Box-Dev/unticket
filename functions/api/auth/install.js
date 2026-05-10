// Post-install setup redirect.
// GitHub sends the user here with ?installation_id=<n>&setup_action=install (or update).
// We fetch the installation's account login, ensure an `orgs` row exists,
// store the installation_id, then redirect back to the app.

import { signAppJwt } from "../../lib/github-app";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const installationId = url.searchParams.get("installation_id");
  const setupAction = url.searchParams.get("setup_action") || "install";

  if (!installationId) {
    return Response.redirect(`${url.origin}/?install_error=missing_id`, 302);
  }

  try {
    const jwt = await signAppJwt(context.env);
    const res = await fetch(
      `https://api.github.com/app/installations/${installationId}`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "unticket",
        },
      }
    );

    if (!res.ok) {
      console.error("[unticket install] failed to fetch installation", installationId, res.status);
      return Response.redirect(`${url.origin}/?install_error=lookup_failed`, 302);
    }

    const data = await res.json();
    const accountLogin = data.account?.login;
    if (!accountLogin) {
      return Response.redirect(`${url.origin}/?install_error=no_account`, 302);
    }

    const db = context.env.DB;
    // Upsert the org and link the installation.
    await db.batch([
      db.prepare(
        `INSERT INTO orgs (github_login, installation_id) VALUES (?, ?)
         ON CONFLICT(github_login) DO UPDATE SET installation_id = excluded.installation_id`
      ).bind(accountLogin, Number(installationId)),
      db.prepare(
        `UPDATE orgs SET installation_id = NULL
         WHERE installation_id = ? AND github_login != ?`
      ).bind(Number(installationId), accountLogin),
    ]);

    return Response.redirect(
      `${url.origin}/?install_ok=1&org=${encodeURIComponent(accountLogin)}&setup=${setupAction}`,
      302
    );
  } catch (e) {
    console.error("[unticket install] error", e instanceof Error ? e.stack : e);
    return Response.redirect(`${url.origin}/?install_error=server_error`, 302);
  }
}

import { getInstallationToken } from "../../functions/lib/github-app.js";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function enumerateMonths(start, end) {
  if (!MONTH_PATTERN.test(start) || !MONTH_PATTERN.test(end) || start > end) {
    throw new Error(`Invalid audit month range: ${start}..${end}`);
  }

  const months = [];
  let [year, month] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  while ((year < endYear || (year === endYear && month <= endMonth)) && months.length < 120) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }
  return months;
}

function monthRange(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

async function githubPrCount(token, orgLogin, login, month) {
  const { start, end } = monthRange(month);
  const query = `org:${orgLogin} is:pr author:${login} created:${start}..${end}`;
  const url = new URL("https://api.github.com/search/issues");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", "1");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Unticket",
    },
  });
  if (!response.ok) {
    const reset = response.headers.get("X-RateLimit-Reset");
    const resetText = reset ? `; resets ${new Date(Number(reset) * 1000).toISOString()}` : "";
    throw new Error(`GitHub PR audit failed (${response.status}${resetText})`);
  }
  const data = await response.json();
  return Number(data.total_count ?? 0);
}

async function cachedCounts(db, orgId, login, month) {
  const rows = await db
    .prepare(
      `SELECT
         COUNT(*) AS all_prs,
         SUM(
           CASE WHEN EXISTS (
             SELECT 1 FROM repo_tracking_periods period
             WHERE period.org_id = p.org_id AND period.repo = p.repo
               AND p.created_at >= period.tracked_from
               AND (period.tracked_until IS NULL OR p.created_at < period.tracked_until)
           )
           THEN 1 ELSE 0 END
         ) AS tracked_prs
       FROM pull_requests p
       WHERE p.org_id = ? AND p.author = ? AND strftime('%Y-%m', p.created_at) = ?`,
    )
    .bind(orgId, login, month)
    .first();

  return {
    all: Number(rows?.all_prs ?? 0),
    tracked: Number(rows?.tracked_prs ?? 0),
  };
}

export async function runNextStatsAudit(env) {
  const request = await env.DB
    .prepare(
      `SELECT request.id, request.org_id, request.login, request.start_month, request.end_month,
              org.github_login, org.installation_id
       FROM github_stats_audit_requests request
       JOIN orgs org ON org.id = request.org_id
       WHERE request.status = 'pending'
       ORDER BY request.requested_at, request.id
       LIMIT 1`,
    )
    .first();
  if (!request) return null;

  await env.DB
    .prepare("UPDATE github_stats_audit_requests SET status = 'running', error = NULL WHERE id = ?")
    .bind(request.id)
    .run();

  try {
    const token = await getInstallationToken(env, request.installation_id);
    const months = enumerateMonths(request.start_month, request.end_month);
    for (const month of months) {
      const [githubCount, cached] = await Promise.all([
        githubPrCount(token, request.github_login, request.login, month),
        cachedCounts(env.DB, request.org_id, request.login, month),
      ]);
      await env.DB
        .prepare(
          `INSERT INTO github_stats_audit_months
             (request_id, org_id, login, month, github_prs, cached_all_prs, cached_tracked_prs, audited_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
           ON CONFLICT(request_id, month) DO UPDATE SET
             github_prs = excluded.github_prs,
             cached_all_prs = excluded.cached_all_prs,
             cached_tracked_prs = excluded.cached_tracked_prs,
             audited_at = excluded.audited_at`,
        )
        .bind(request.id, request.org_id, request.login, month, githubCount, cached.all, cached.tracked)
        .run();
    }
    await env.DB
      .prepare(
        `UPDATE github_stats_audit_requests
         SET status = 'completed', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), error = NULL
         WHERE id = ?`,
      )
      .bind(request.id)
      .run();
    return { requestId: request.id, months: months.length };
  } catch (error) {
    await env.DB
      .prepare(
        `UPDATE github_stats_audit_requests
         SET status = 'failed', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), error = ?
         WHERE id = ?`,
      )
      .bind(String(error?.message ?? error).slice(0, 500), request.id)
      .run();
    throw error;
  }
}

export const statsAuditInternals = { enumerateMonths, monthRange };

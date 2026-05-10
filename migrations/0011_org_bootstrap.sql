-- Track bootstrap state and webhook freshness per org.
--
-- bootstrapped_at: set once when the install webhook finishes the initial
-- backfill (repos + members + features + per-repo issues/PRs). The dashboard
-- treats `bootstrapped_at IS NULL` as "still loading" and polls until it's
-- set, so users never see an empty board on first install.
--
-- last_event_at: bumped on every webhook write. The reconcile cron uses it
-- to flag installations that have gone silent (no events for 24h+) for
-- admin visibility, separate from healthy installs that simply have no
-- activity.

ALTER TABLE orgs ADD COLUMN bootstrapped_at TEXT;
ALTER TABLE orgs ADD COLUMN last_event_at TEXT;

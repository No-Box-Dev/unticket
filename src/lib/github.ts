import { Octokit } from "octokit";

let octokitInstance: Octokit | null = null;

export function getOctokit(): Octokit {
  if (!octokitInstance) {
    const token = localStorage.getItem("gp_token");
    if (!token) throw new Error("Not authenticated");
    octokitInstance = new Octokit({ auth: token });
  }
  return octokitInstance;
}

export function resetOctokit() {
  octokitInstance = null;
}

export async function fetchUser() {
  const ok = getOctokit();
  const { data } = await ok.rest.users.getAuthenticated();
  return data;
}

export async function fetchOrgs() {
  const ok = getOctokit();
  const { data } = await ok.rest.orgs.listForAuthenticatedUser();
  return data;
}

export async function fetchRepos(org: string) {
  const ok = getOctokit();
  const { data } = await ok.rest.repos.listForOrg({
    org,
    sort: "pushed",
    per_page: 100,
  });
  return data;
}

export async function fetchOpenPRs(owner: string, repo: string) {
  const ok = getOctokit();
  const { data } = await ok.rest.pulls.list({
    owner,
    repo,
    state: "open",
    per_page: 50,
    sort: "updated",
    direction: "desc",
  });
  return data;
}

export async function fetchOpenIssues(owner: string, repo: string) {
  const ok = getOctokit();
  const { data } = await ok.rest.issues.listForRepo({
    owner,
    repo,
    state: "open",
    per_page: 50,
    sort: "updated",
    direction: "desc",
  });
  // Filter out PRs (GitHub treats PRs as issues)
  return data.filter((issue) => !issue.pull_request);
}

export async function fetchMilestones(owner: string, repo: string) {
  const ok = getOctokit();
  const { data } = await ok.rest.issues.listMilestones({
    owner,
    repo,
    state: "open",
    sort: "due_on",
    direction: "asc",
  });
  return data;
}

export async function fetchRepoActivity(owner: string, repo: string) {
  const ok = getOctokit();
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const { data } = await ok.rest.repos.listCommits({
    owner,
    repo,
    since: since.toISOString(),
    per_page: 100,
  });
  return data;
}

export async function fetchClosedIssues(owner: string, repo: string, since?: string) {
  const ok = getOctokit();
  const { data } = await ok.rest.issues.listForRepo({
    owner,
    repo,
    state: "closed",
    per_page: 100,
    sort: "updated",
    direction: "desc",
    ...(since ? { since } : {}),
  });
  return data.filter((issue) => !issue.pull_request);
}

export async function fetchMergedPRs(owner: string, repo: string, since?: string) {
  const ok = getOctokit();
  const { data } = await ok.rest.pulls.list({
    owner,
    repo,
    state: "closed",
    per_page: 100,
    sort: "updated",
    direction: "desc",
  });
  // Filter to only merged PRs, and optionally by date
  return data.filter((pr) => {
    if (!pr.merged_at) return false;
    if (since && new Date(pr.merged_at) < new Date(since)) return false;
    return true;
  });
}

export async function fetchOrgMembers(org: string) {
  const ok = getOctokit();
  const { data } = await ok.rest.orgs.listMembers({ org, per_page: 100 });
  return data;
}

export async function fetchAllIssues(owner: string, repo: string, since?: string) {
  const ok = getOctokit();
  const { data } = await ok.rest.issues.listForRepo({
    owner,
    repo,
    state: "all",
    per_page: 100,
    sort: "updated",
    direction: "desc",
    ...(since ? { since } : {}),
  });
  return data.filter((issue) => !issue.pull_request);
}

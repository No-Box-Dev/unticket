import { useParams } from "react-router-dom";
import { PrList } from "@/components/lists/PrList";
import { PageShell } from "@/pages/details/PageShell";

export function RepoPrsPage() {
  const { repo } = useParams<{ repo: string }>();
  return (
    <PageShell backTo="/?tab=prs" backLabel="Back to PRs">
      <PrList
        title={`PRs in ${repo}`}
        filter={{ repo, state: "all" }}
        showRepoColumn={false}
        emptyMessage="No pull requests in this repo"
      />
    </PageShell>
  );
}

export function AuthorPrsPage() {
  const { login } = useParams<{ login: string }>();
  return (
    <PageShell backTo="/?tab=prs" backLabel="Back to PRs">
      <PrList
        title={`PRs by ${login}`}
        filter={{ author: login, state: "all" }}
        emptyMessage="No pull requests by this author"
      />
    </PageShell>
  );
}

export function DraftPrsPage() {
  return (
    <PageShell backTo="/?tab=prs" backLabel="Back to PRs">
      <PrList
        title="Draft pull requests"
        filter={{ state: "open", draft: true }}
        emptyMessage="No drafts."
      />
    </PageShell>
  );
}

export function StalePrsPage() {
  return (
    <PageShell backTo="/?tab=prs" backLabel="Back to PRs">
      <PrList
        title="Stale pull requests"
        filter={{ state: "open", stale: true }}
        emptyMessage="No stale PRs."
      />
    </PageShell>
  );
}

import { useParams } from "react-router-dom";
import { IssueList } from "@/components/lists/IssueList";
import { PageShell } from "@/pages/details/PageShell";

export function RepoIssuesPage() {
  const { repo } = useParams<{ repo: string }>();
  return (
    <PageShell backTo="/?tab=issues" backLabel="Back to issues">
      <IssueList
        title={`Issues in ${repo}`}
        filter={{ repo, state: "all" }}
        showRepoColumn={false}
        emptyMessage="No issues in this repo"
      />
    </PageShell>
  );
}

export function StaleIssuesPage() {
  return (
    <PageShell backTo="/?tab=issues" backLabel="Back to issues">
      <IssueList
        title="Stale issues"
        filter={{ state: "open", stale: true }}
        defaultSort="created_at"
        defaultSortDir="asc"
        emptyMessage="No stale issues — nice work."
      />
    </PageShell>
  );
}

export function LabelIssuesPage() {
  const { label } = useParams<{ label: string }>();
  return (
    <PageShell backTo="/?tab=issues" backLabel="Back to issues">
      <IssueList
        title={`Issues labeled "${label}"`}
        filter={{ label, state: "all" }}
        emptyMessage="No issues with this label"
      />
    </PageShell>
  );
}

export function AssigneeIssuesPage() {
  const { login } = useParams<{ login: string }>();
  return (
    <PageShell backTo="/?tab=issues" backLabel="Back to issues">
      <IssueList
        title={`Issues assigned to ${login}`}
        filter={{ assignee: login, state: "all" }}
        emptyMessage="No issues assigned"
      />
    </PageShell>
  );
}

export function UnassignedIssuesPage() {
  return (
    <PageShell backTo="/?tab=issues" backLabel="Back to issues">
      <IssueList
        title="Unassigned open issues"
        filter={{ assignee: null, state: "open" }}
        emptyMessage="All open issues are assigned."
      />
    </PageShell>
  );
}

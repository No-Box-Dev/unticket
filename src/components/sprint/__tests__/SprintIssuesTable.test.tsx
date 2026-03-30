/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SprintIssuesTable } from "../SprintIssuesTable";

const makeIssue = (overrides: Partial<any> = {}) => ({
  id: 1,
  number: 42,
  title: "Fix bug",
  state: "open",
  created_at: "2026-02-01T00:00:00Z",
  closed_at: null,
  user: { login: "alice" },
  assignees: [{ login: "alice" }],
  labels: [],
  html_url: "https://github.com/org/repo/issues/42",
  repo: "my-repo",
  ...overrides,
});

describe("SprintIssuesTable", () => {
  it("shows loading state", () => {
    const { container } = render(<SprintIssuesTable openIssues={[]} closedIssues={[]} isLoading={true} />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows empty state when no issues", () => {
    render(<SprintIssuesTable openIssues={[]} closedIssues={[]} isLoading={false} />);
    expect(screen.getByText("No open issues found")).toBeInTheDocument();
  });

  it("renders open issue row", () => {
    const issue = makeIssue();
    render(<SprintIssuesTable openIssues={[issue]} closedIssues={[]} isLoading={false} />);
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("Fix bug")).toBeInTheDocument();
    expect(screen.getByText("my-repo")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("shows open count in toggle button", () => {
    const issues = [makeIssue(), makeIssue({ id: 2, number: 43 })];
    render(<SprintIssuesTable openIssues={issues} closedIssues={[]} isLoading={false} />);
    expect(screen.getByText("Open (2)")).toBeInTheDocument();
  });

  it("shows closed count in toggle button", () => {
    const open = [makeIssue()];
    const closed = [makeIssue({ id: 2, number: 43, state: "closed", closed_at: "2026-02-10T00:00:00Z" })];
    render(<SprintIssuesTable openIssues={open} closedIssues={closed} isLoading={false} />);
    expect(screen.getByText("Closed (1)")).toBeInTheDocument();
  });

  it("shows dash for unassigned issues", () => {
    const issue = makeIssue({ assignees: [] });
    render(<SprintIssuesTable openIssues={[issue]} closedIssues={[]} isLoading={false} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows age in days", () => {
    const issue = makeIssue({ created_at: new Date(Date.now() - 14 * 86400000).toISOString() });
    render(<SprintIssuesTable openIssues={[issue]} closedIssues={[]} isLoading={false} />);
    expect(screen.getByText("14d")).toBeInTheDocument();
  });
});

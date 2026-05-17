import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/components/lists/IssueList", () => ({
  IssueList: ({
    title,
    emptyMessage,
    filter,
  }: {
    title: string;
    emptyMessage: string;
    filter: Record<string, unknown>;
  }) => (
    <div data-testid="issue-list">
      <h2>{title}</h2>
      <p data-testid="empty">{emptyMessage}</p>
      <p data-testid="filter">{JSON.stringify(filter)}</p>
    </div>
  ),
}));

import {
  RepoIssuesPage,
  StaleIssuesPage,
  LabelIssuesPage,
  AssigneeIssuesPage,
  UnassignedIssuesPage,
} from "../IssueListPages";

describe("IssueListPages", () => {
  it("RepoIssuesPage filters by :repo param", () => {
    render(
      <MemoryRouter initialEntries={["/repos/api/issues"]}>
        <Routes>
          <Route path="/repos/:repo/issues" element={<RepoIssuesPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Issues in api")).toBeInTheDocument();
    expect(screen.getByTestId("filter").textContent).toContain('"repo":"api"');
  });

  it("StaleIssuesPage filters open + stale", () => {
    render(
      <MemoryRouter>
        <StaleIssuesPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Stale issues")).toBeInTheDocument();
    expect(screen.getByTestId("filter").textContent).toContain('"stale":true');
  });

  it("LabelIssuesPage filters by :label param", () => {
    render(
      <MemoryRouter initialEntries={["/labels/bug/issues"]}>
        <Routes>
          <Route path="/labels/:label/issues" element={<LabelIssuesPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Issues labeled "bug"')).toBeInTheDocument();
    expect(screen.getByTestId("filter").textContent).toContain('"label":"bug"');
  });

  it("AssigneeIssuesPage filters by :login param", () => {
    render(
      <MemoryRouter initialEntries={["/people/bob/issues"]}>
        <Routes>
          <Route path="/people/:login/issues" element={<AssigneeIssuesPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Issues assigned to bob")).toBeInTheDocument();
    expect(screen.getByTestId("filter").textContent).toContain('"assignee":"bob"');
  });

  it("UnassignedIssuesPage filters assignee=null + state=open", () => {
    render(
      <MemoryRouter>
        <UnassignedIssuesPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Unassigned open issues")).toBeInTheDocument();
    expect(screen.getByTestId("filter").textContent).toContain('"assignee":null');
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/components/lists/PrList", () => ({
  PrList: ({
    title,
    emptyMessage,
    filter,
    showRepoColumn,
  }: {
    title: string;
    emptyMessage: string;
    filter: Record<string, unknown>;
    showRepoColumn?: boolean;
  }) => (
    <div data-testid="pr-list">
      <h2>{title}</h2>
      <p data-testid="empty">{emptyMessage}</p>
      <p data-testid="filter">{JSON.stringify(filter)}</p>
      <p data-testid="show-repo">{String(showRepoColumn ?? true)}</p>
    </div>
  ),
}));

import {
  RepoPrsPage,
  AuthorPrsPage,
  DraftPrsPage,
  StalePrsPage,
} from "../PrListPages";

describe("PrListPages", () => {
  it("RepoPrsPage uses the :repo param and hides the repo column", () => {
    render(
      <MemoryRouter initialEntries={["/repos/api/prs"]}>
        <Routes>
          <Route path="/repos/:repo/prs" element={<RepoPrsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("PRs in api")).toBeInTheDocument();
    expect(screen.getByTestId("show-repo").textContent).toBe("false");
    expect(screen.getByTestId("filter").textContent).toContain('"repo":"api"');
  });

  it("AuthorPrsPage filters by author login", () => {
    render(
      <MemoryRouter initialEntries={["/people/alice/prs"]}>
        <Routes>
          <Route path="/people/:login/prs" element={<AuthorPrsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("PRs by alice")).toBeInTheDocument();
    expect(screen.getByTestId("filter").textContent).toContain('"author":"alice"');
  });

  it("DraftPrsPage filters draft + open", () => {
    render(
      <MemoryRouter>
        <DraftPrsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Draft pull requests")).toBeInTheDocument();
    expect(screen.getByTestId("filter").textContent).toContain('"draft":true');
  });

  it("StalePrsPage filters stale + open", () => {
    render(
      <MemoryRouter>
        <StalePrsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Stale pull requests")).toBeInTheDocument();
    expect(screen.getByTestId("filter").textContent).toContain('"stale":true');
  });
});

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

import { PageShell } from "../PageShell";

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

describe("PageShell", () => {
  it("renders children inside the main area", () => {
    render(
      <MemoryRouter>
        <PageShell>
          <p>Inner content</p>
        </PageShell>
      </MemoryRouter>,
    );
    expect(screen.getByText("Inner content")).toBeInTheDocument();
  });

  it("renders default 'Back' label when none is provided", () => {
    render(
      <MemoryRouter>
        <PageShell>
          <p>x</p>
        </PageShell>
      </MemoryRouter>,
    );
    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("renders a Link with the backTo target when backTo is set", () => {
    render(
      <MemoryRouter initialEntries={["/somewhere"]}>
        <PageShell backTo="/?tab=prs" backLabel="Back to PRs">
          <p>x</p>
        </PageShell>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /Back to PRs/i });
    expect(link).toHaveAttribute("href", "/?tab=prs");
  });

  it("clicking the back anchor without backTo navigates home when history is empty", () => {
    Object.defineProperty(window.history, "length", { configurable: true, value: 1 });
    render(
      <MemoryRouter initialEntries={["/foo"]}>
        <Routes>
          <Route
            path="/foo"
            element={
              <PageShell>
                <p>x</p>
              </PageShell>
            }
          />
          <Route path="/" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByTestId("loc").textContent).toBe("/");
  });
});

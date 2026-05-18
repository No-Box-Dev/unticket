import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation, Link } from "react-router-dom";

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

  it("exposes the backTo target via href so middle-click / open-in-new-tab works", () => {
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

  it("falls back to backTo when this is the first page in session (deep link / refresh)", () => {
    render(
      <MemoryRouter initialEntries={["/foo"]}>
        <Routes>
          <Route
            path="/foo"
            element={
              <PageShell backTo="/?tab=prs" backLabel="Back to PRs">
                <p>x</p>
              </PageShell>
            }
          />
          <Route path="/" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Back to PRs"));
    expect(screen.getByTestId("loc").textContent).toBe("/?tab=prs");
  });

  it("falls back to home when no backTo is provided and there is no in-app history", () => {
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

  it("steps back through in-app history instead of jumping to backTo", () => {
    function FromPage() {
      return <Link to="/detail">go detail</Link>;
    }
    function DetailPage() {
      return (
        <PageShell backTo="/?tab=prs" backLabel="Back to PRs">
          <p>detail</p>
        </PageShell>
      );
    }
    render(
      <MemoryRouter initialEntries={["/list"]}>
        <Routes>
          <Route path="/list" element={<FromPage />} />
          <Route path="/detail" element={<DetailPage />} />
          <Route path="/" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    // Navigate /list -> /detail so location.key is non-"default"
    fireEvent.click(screen.getByText("go detail"));
    expect(screen.getByText("detail")).toBeInTheDocument();
    // Back should land back on /list (not /?tab=prs)
    fireEvent.click(screen.getByText("Back to PRs"));
    expect(screen.getByText("go detail")).toBeInTheDocument();
  });
});

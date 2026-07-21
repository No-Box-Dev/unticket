import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "../ErrorBoundary";

// Suppress React error boundary console.error noise in test output
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  sessionStorage.clear();
});

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Test explosion");
  return <div>Child content</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <div>All good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("shows error message when child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test explosion")).toBeInTheDocument();
  });

  it("shows Retry button in error state", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("retry button resets the error state", async () => {
    const user = userEvent.setup();
    // Use a flag to control whether the child throws.
    // We need a wrapper that can change behavior between renders.
    let shouldThrow = true;
    function ConditionalChild() {
      if (shouldThrow) throw new Error("Boom");
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <ConditionalChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Fix the child so next render won't throw
    shouldThrow = false;

    await user.click(screen.getByText("Retry"));
    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });

  it("auto-reloads immediately when a chunk-load error is caught (no user click needed)", () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });

    function ChunkErrorChild(): React.JSX.Element {
      throw new Error("Failed to fetch dynamically imported module: https://app.unticket.ai/assets/IssuesTab-DNuPGSj7.js");
    }

    render(
      <ErrorBoundary>
        <ChunkErrorChild />
      </ErrorBoundary>,
    );

    // componentDidCatch fired tryAutoReload, which called window.location.reload
    // — without the user clicking anything.
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("stops auto-reloading once the per-session budget is exhausted and shows the manual fallback", async () => {
    const user = userEvent.setup();
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });

    // Simulate the budget already being spent: 3 reloads in the recent past.
    sessionStorage.setItem(
      "preloadErrorReloads",
      JSON.stringify({ count: 3, last: Date.now() }),
    );

    function ChunkErrorChild(): React.JSX.Element {
      throw new Error("Failed to fetch dynamically imported module: https://app.unticket.ai/assets/CurrentTab-XYZ.js");
    }

    render(
      <ErrorBoundary>
        <ChunkErrorChild />
      </ErrorBoundary>,
    );

    // Auto-reload was attempted but the budget blocked it.
    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.getByText("A new version was deployed")).toBeInTheDocument();

    // The fallback button still works as a manual reload.
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("calls window.location.reload after 3 retries (retryCount >= 2 on third click)", async () => {
    const user = userEvent.setup();
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });

    // Child that always throws — forces retry to hit error state again each time
    function AlwaysThrows(): React.JSX.Element {
      throw new Error("Persistent error");
    }

    render(
      <ErrorBoundary>
        <AlwaysThrows />
      </ErrorBoundary>,
    );

    // retryCount starts at 0. Click 1 → retryCount becomes 1 (re-renders, throws again).
    await user.click(screen.getByText("Retry"));
    expect(reloadMock).not.toHaveBeenCalled();

    // Click 2 → retryCount becomes 2 (re-renders, throws again).
    await user.click(screen.getByText("Retry"));
    expect(reloadMock).not.toHaveBeenCalled();

    // Click 3 → retryCount is 2, which is >= 2, so reload is called.
    await user.click(screen.getByText("Retry"));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});

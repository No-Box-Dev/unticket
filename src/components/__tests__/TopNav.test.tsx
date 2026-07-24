import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Un-mock TopNav — the global test-setup stubs it (so PageShell-based
// pages don't need to wire AuthProvider) but this file is where we
// exercise the real component.
vi.unmock("@/components/TopNav");

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));
vi.mock("@/hooks/useGitHub", () => ({
  useRateLimit: vi.fn(),
  useUnacknowledgedRepos: vi.fn(),
  useIsAdmin: vi.fn(),
}));

import { TopNav } from "../TopNav";
import { useAuth } from "@/lib/auth";
import { useRateLimit, useUnacknowledgedRepos, useIsAdmin } from "@/hooks/useGitHub";

const mockAuth = useAuth as unknown as ReturnType<typeof vi.fn>;
const mockRate = useRateLimit as unknown as ReturnType<typeof vi.fn>;
const mockUnacked = useUnacknowledgedRepos as unknown as ReturnType<typeof vi.fn>;
const mockIsAdmin = useIsAdmin as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockAuth.mockReturnValue({
    user: { login: "alice", avatar_url: "https://x/a.png", name: "Alice" },
    setSelectedOrg: vi.fn(),
    logout: vi.fn(),
  });
  mockRate.mockReturnValue({ data: { remaining: 1000, limit: 5000 } });
  mockUnacked.mockReturnValue([]);
  mockIsAdmin.mockReturnValue(false);
});

describe("TopNav", () => {
  it("renders the logo and every primary nav item", () => {
    render(<TopNav activeTab="sprint" onTabChange={vi.fn()} />);
    // Both desktop + mobile nav lists render — multiple matches expected.
    expect(screen.getAllByText("Features").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Feed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Current").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Issues").length).toBeGreaterThan(0);
  });

  it("calls onTabChange when a nav item is clicked", () => {
    const onTabChange = vi.fn();
    render(<TopNav activeTab="sprint" onTabChange={onTabChange} />);
    fireEvent.click(screen.getAllByText("Current")[0]);
    expect(onTabChange).toHaveBeenCalledWith("current");
  });

  it("clicking the gear icon switches to settings", () => {
    const onTabChange = vi.fn();
    render(<TopNav activeTab="sprint" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByTitle("Settings"));
    expect(onTabChange).toHaveBeenCalledWith("settings");
  });

  it("does not show the rate-limit dot when remaining is healthy", () => {
    render(<TopNav activeTab="sprint" onTabChange={vi.fn()} />);
    expect(document.querySelector(".bg-severity-mid")).toBeNull();
  });

  it("shows the rate-limit dot when remaining < 20% of limit", () => {
    mockRate.mockReturnValue({ data: { remaining: 100, limit: 5000 } });
    render(<TopNav activeTab="sprint" onTabChange={vi.fn()} />);
    expect(document.querySelector(".bg-severity-mid")).not.toBeNull();
  });

  it("clicking the avatar toggles the user menu (Sign Out + Switch Organisation)", () => {
    render(<TopNav activeTab="sprint" onTabChange={vi.fn()} />);
    fireEvent.click(screen.getByAltText("alice").closest("button")!);
    expect(screen.getByText("Sign Out")).toBeInTheDocument();
    expect(screen.getByText("Switch Organisation")).toBeInTheDocument();
  });

  it("does not show sync actions in the user menu", () => {
    render(<TopNav activeTab="sprint" onTabChange={vi.fn()} />);
    fireEvent.click(screen.getByAltText("alice").closest("button")!);
    expect(screen.queryByText("Sync features")).not.toBeInTheDocument();
    expect(screen.queryByText("Sync from GitHub")).not.toBeInTheDocument();
  });
});

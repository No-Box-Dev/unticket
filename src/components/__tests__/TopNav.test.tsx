import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));
vi.mock("@/hooks/useGitHub", () => ({
  useRateLimit: vi.fn(),
  useTriggerFeatureSync: vi.fn(),
}));
vi.mock("@/components/SyncFromGithub", () => ({
  SyncFromGithubMenuItem: ({ onTrigger }: { onTrigger: () => void }) => (
    <button onClick={onTrigger}>Sync from GitHub</button>
  ),
  SyncFromGithubModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="sync-modal" /> : null,
}));

import { TopNav } from "../TopNav";
import { useAuth } from "@/lib/auth";
import { useRateLimit, useTriggerFeatureSync } from "@/hooks/useGitHub";

const mockAuth = useAuth as unknown as ReturnType<typeof vi.fn>;
const mockRate = useRateLimit as unknown as ReturnType<typeof vi.fn>;
const mockSync = useTriggerFeatureSync as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockAuth.mockReturnValue({
    user: { login: "alice", avatar_url: "https://x/a.png", name: "Alice" },
    setSelectedOrg: vi.fn(),
    logout: vi.fn(),
  });
  mockRate.mockReturnValue({ data: { remaining: 1000, limit: 5000 } });
  mockSync.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

describe("TopNav", () => {
  it("renders the logo and every primary nav item", () => {
    render(<TopNav activeTab="sprint" onTabChange={vi.fn()} />);
    // Both desktop + mobile nav lists render — multiple matches expected.
    expect(screen.getAllByText("Features").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Issues").length).toBeGreaterThan(0);
  });

  it("calls onTabChange when a nav item is clicked", () => {
    const onTabChange = vi.fn();
    render(<TopNav activeTab="sprint" onTabChange={onTabChange} />);
    fireEvent.click(screen.getAllByText("PR")[0]);
    expect(onTabChange).toHaveBeenCalledWith("prs");
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

  it("clicking the avatar toggles the user menu (Sign Out + Sync features)", () => {
    render(<TopNav activeTab="sprint" onTabChange={vi.fn()} />);
    // Avatar button — open the menu via the ChevronDown sibling button.
    fireEvent.click(screen.getByAltText("alice").closest("button")!);
    expect(screen.getByText("Sign Out")).toBeInTheDocument();
    expect(screen.getByText("Sync features")).toBeInTheDocument();
  });

  it("clicking 'Sync features' calls the mutation", () => {
    const mutate = vi.fn();
    mockSync.mockReturnValue({ mutate, isPending: false });
    render(<TopNav activeTab="sprint" onTabChange={vi.fn()} />);
    fireEvent.click(screen.getByAltText("alice").closest("button")!);
    fireEvent.click(screen.getByText("Sync features"));
    expect(mutate).toHaveBeenCalled();
  });

  it("clicking 'Sync from GitHub' opens the modal", () => {
    render(<TopNav activeTab="sprint" onTabChange={vi.fn()} />);
    fireEvent.click(screen.getByAltText("alice").closest("button")!);
    fireEvent.click(screen.getByText("Sync from GitHub"));
    expect(screen.getByTestId("sync-modal")).toBeInTheDocument();
  });
});

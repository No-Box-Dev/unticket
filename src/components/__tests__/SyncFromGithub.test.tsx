import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/github", () => ({
  triggerSyncWithProgress: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => {
  const qc = { invalidateQueries: vi.fn() };
  return { useQueryClient: () => qc };
});

import { SyncFromGithubMenuItem, SyncFromGithubModal } from "../SyncFromGithub";
import { triggerSyncWithProgress } from "@/lib/github";

const mockSync = triggerSyncWithProgress as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockSync.mockReset();
});

describe("SyncFromGithubMenuItem", () => {
  it("renders 'Sync from GitHub' label", () => {
    render(<SyncFromGithubMenuItem onTrigger={vi.fn()} />);
    expect(screen.getByText("Sync from GitHub")).toBeInTheDocument();
  });

  it("calls onTrigger when clicked", () => {
    const onTrigger = vi.fn();
    render(<SyncFromGithubMenuItem onTrigger={onTrigger} />);
    fireEvent.click(screen.getByText("Sync from GitHub"));
    expect(onTrigger).toHaveBeenCalled();
  });
});

describe("SyncFromGithubModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<SyncFromGithubModal open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("starts the sync when opened and renders the Syncing header", async () => {
    mockSync.mockImplementation((cb) => {
      cb({ phase: "init", total: 0 });
      return new Promise(() => {}); // never resolves — simulates in-flight
    });
    render(<SyncFromGithubModal open onClose={vi.fn()} />);
    expect(await screen.findByText("Syncing from GitHub")).toBeInTheDocument();
    expect(mockSync).toHaveBeenCalledWith(expect.any(Function), true);
  });

  it("shows the error message when the sync ends in error", async () => {
    mockSync.mockImplementation(async (cb) => {
      cb({ phase: "error", error: "boom", total: 0 });
    });
    render(<SyncFromGithubModal open onClose={vi.fn()} />);
    expect(await screen.findByText("Sync Failed")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("shows 'Sync Complete' on done and the Close button calls onClose", async () => {
    mockSync.mockImplementation(async (cb) => {
      cb({ phase: "syncing", repo: "api", total: 1 });
      cb({ phase: "done", total: 1, failed: [] });
    });
    const onClose = vi.fn();
    render(<SyncFromGithubModal open onClose={onClose} />);
    expect(await screen.findByText("Sync Complete")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows 'Sync Complete (with errors)' when there are failed repos", async () => {
    mockSync.mockImplementation(async (cb) => {
      cb({ phase: "done", total: 2, failed: ["broken"] });
    });
    render(<SyncFromGithubModal open onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("Sync Complete (with errors)")).toBeInTheDocument(),
    );
    expect(screen.getByText("broken")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/auth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useGitHub", () => ({
  useRepos: vi.fn(),
  useOrgMembers: vi.fn(),
}));
vi.mock("@/hooks/useConfigRepo", () => ({
  useSettings: vi.fn(),
  useSaveSettings: vi.fn(),
  usePeople: vi.fn(),
  useSavePeople: vi.fn(),
}));
vi.mock("@/hooks/useNoxlink", () => ({
  useFeedProjects: vi.fn(),
}));
vi.mock("@/lib/noxlink-api", () => ({
  backfillProjectPrs: vi.fn(),
}));
vi.mock("@/lib/pr-links", () => ({
  backfillFeatureMatches: vi.fn(),
  unlinkAllPRs: vi.fn(),
}));
vi.mock("@/lib/github", () => ({
  triggerSyncWithProgress: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => {
  const qc = { invalidateQueries: vi.fn() };
  return { useQueryClient: () => qc };
});

import { SettingsTab } from "../SettingsTab";
import { useAuth } from "@/lib/auth";
import { useRepos, useOrgMembers } from "@/hooks/useGitHub";
import {
  useSettings,
  useSaveSettings,
  usePeople,
  useSavePeople,
} from "@/hooks/useConfigRepo";
import { useFeedProjects } from "@/hooks/useNoxlink";

const mAuth = useAuth as unknown as ReturnType<typeof vi.fn>;
const mRepos = useRepos as unknown as ReturnType<typeof vi.fn>;
const mOrgMembers = useOrgMembers as unknown as ReturnType<typeof vi.fn>;
const mSettings = useSettings as unknown as ReturnType<typeof vi.fn>;
const mSaveSettings = useSaveSettings as unknown as ReturnType<typeof vi.fn>;
const mPeople = usePeople as unknown as ReturnType<typeof vi.fn>;
const mSavePeople = useSavePeople as unknown as ReturnType<typeof vi.fn>;
const mProjects = useFeedProjects as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mAuth.mockReturnValue({
    user: { login: "alice", avatar_url: "https://x/a.png", name: "Alice" },
    selectedOrg: "acme",
    logout: vi.fn(),
  });
  mRepos.mockReturnValue({
    data: [
      { id: 1, name: "api", language: "TypeScript" },
      { id: 2, name: "web", language: "TypeScript" },
    ],
  });
  mOrgMembers.mockReturnValue({ data: [] });
  mSettings.mockReturnValue({ data: { draftRepos: [], excludedMembers: [] } });
  mSaveSettings.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  });
  mPeople.mockReturnValue({ data: [] });
  mSavePeople.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  });
  mProjects.mockReturnValue({ data: [] });
});

describe("SettingsTab", () => {
  it("renders the account section with user info", () => {
    render(<SettingsTab />);
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
  });

  it("renders Tracked Repositories count from useRepos data", () => {
    render(<SettingsTab />);
    expect(screen.getByText(/Tracked Repositories \(2\)/)).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
  });

  it("clicking a repo button toggles its draft state via saveSettings", () => {
    const save = vi.fn();
    mSaveSettings.mockReturnValue({ mutate: save, mutateAsync: vi.fn(), isPending: false });
    render(<SettingsTab />);
    fireEvent.click(screen.getByText("api"));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ draftRepos: ["api"] }),
    );
  });

  it("renders the GitHub App install section", () => {
    render(<SettingsTab />);
    expect(screen.getByText("GitHub App")).toBeInTheDocument();
    expect(screen.getByText(/Install or manage Unticket/i)).toBeInTheDocument();
  });

  it("renders the Data Sync section with a Full Re-sync button", () => {
    render(<SettingsTab />);
    expect(screen.getByText("Data Sync")).toBeInTheDocument();
    expect(screen.getByText("Full Re-sync")).toBeInTheDocument();
  });
});

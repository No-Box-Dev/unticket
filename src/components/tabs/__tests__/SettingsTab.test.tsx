import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useGitHub", () => ({
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
import { useOrgMembers } from "@/hooks/useGitHub";
import {
  useSettings,
  useSaveSettings,
  usePeople,
  useSavePeople,
} from "@/hooks/useConfigRepo";
import { useFeedProjects } from "@/hooks/useNoxlink";

const mAuth = useAuth as unknown as ReturnType<typeof vi.fn>;
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
  mOrgMembers.mockReturnValue({ data: [] });
  mSettings.mockReturnValue({ data: { excludedMembers: [] } });
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

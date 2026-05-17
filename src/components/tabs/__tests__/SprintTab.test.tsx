import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useConfigRepo", () => ({
  useFeatures: vi.fn(),
  usePeople: vi.fn(),
  useCreateFeature: vi.fn(),
  useUpdateFeature: vi.fn(),
  useDeleteFeature: vi.fn(),
  useCreateConfigRepo: vi.fn(),
  useCleanDoneFeatures: vi.fn(),
}));
vi.mock("@/hooks/useGitHub", () => ({
  useIsAdmin: vi.fn(),
  useActiveMembers: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));
vi.mock("@/hooks/usePRLinks", () => ({
  useLinkPR: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlinkPR: () => ({ mutate: vi.fn(), isPending: false }),
  useLinkedPRs: () => ({ data: [] }),
}));
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

import { SprintTab } from "../SprintTab";
import {
  useFeatures,
  usePeople,
  useCreateFeature,
  useUpdateFeature,
  useDeleteFeature,
  useCreateConfigRepo,
  useCleanDoneFeatures,
} from "@/hooks/useConfigRepo";
import { useIsAdmin, useActiveMembers } from "@/hooks/useGitHub";
import { useAuth } from "@/lib/auth";

const mFeatures = useFeatures as unknown as ReturnType<typeof vi.fn>;
const mPeople = usePeople as unknown as ReturnType<typeof vi.fn>;
const mCreate = useCreateFeature as unknown as ReturnType<typeof vi.fn>;
const mUpdate = useUpdateFeature as unknown as ReturnType<typeof vi.fn>;
const mDelete = useDeleteFeature as unknown as ReturnType<typeof vi.fn>;
const mCreateRepo = useCreateConfigRepo as unknown as ReturnType<typeof vi.fn>;
const mCleanDone = useCleanDoneFeatures as unknown as ReturnType<typeof vi.fn>;
const mAdmin = useIsAdmin as unknown as ReturnType<typeof vi.fn>;
const mMembers = useActiveMembers as unknown as ReturnType<typeof vi.fn>;
const mAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mFeatures.mockReset();
  mPeople.mockReturnValue({ data: [] });
  mCreate.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mUpdate.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mDelete.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mCreateRepo.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mCleanDone.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mAdmin.mockReturnValue(false);
  mMembers.mockReturnValue({ data: [] });
  mAuth.mockReturnValue({ user: { login: "alice" } });
});

function renderTab() {
  return render(
    <MemoryRouter>
      <SprintTab />
    </MemoryRouter>,
  );
}

describe("SprintTab", () => {
  it("renders a spinner while loading", () => {
    mFeatures.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderTab();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders the setup CTA when there are no features (data null)", () => {
    mFeatures.mockReturnValue({ data: null, isLoading: false });
    renderTab();
    expect(screen.getByRole("heading", { name: /Set up unticket/i })).toBeInTheDocument();
  });

  it("renders the kanban columns when features load", () => {
    mFeatures.mockReturnValue({ data: [], isLoading: false });
    renderTab();
    expect(screen.getByText("To do")).toBeInTheDocument();
    expect(screen.getByText("Testing on staging")).toBeInTheDocument();
    expect(screen.getByText("Ready for production")).toBeInTheDocument();
    expect(screen.getByText("On production")).toBeInTheDocument();
  });

  it("renders feature cards in the right columns", () => {
    mFeatures.mockReturnValue({
      data: [
        { id: 1, title: "Add login", owners: ["alice"], status: "todo", plan: "", url: "x" },
        { id: 2, title: "Ship payments", owners: [], status: "production", plan: "", url: "y" },
      ],
      isLoading: false,
    });
    renderTab();
    expect(screen.getByText("Add login")).toBeInTheDocument();
    expect(screen.getByText("Ship payments")).toBeInTheDocument();
  });
});

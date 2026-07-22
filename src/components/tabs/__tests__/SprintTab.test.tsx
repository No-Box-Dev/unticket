import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useConfigRepo", () => ({
  useFeatures: vi.fn(),
  usePeople: vi.fn(),
  useSettings: vi.fn(),
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
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
// FeatureCard now calls useSpecs to render inline spec chips. Stub so
// SprintTab tests don't need a QueryClient / AuthProvider.
vi.mock("@/hooks/useSpecs", () => ({
  useSpecs: () => ({ data: [] }),
}));

import { SprintTab } from "../SprintTab";
import {
  useFeatures,
  usePeople,
  useSettings,
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
const mSettings = useSettings as unknown as ReturnType<typeof vi.fn>;
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
  mSettings.mockReturnValue({ data: null });
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
    expect(screen.getByText("Specced")).toBeInTheDocument();
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

  it("filters features to the logged-in owner with the Me toggle", () => {
    mFeatures.mockReturnValue({
      data: [
        { id: 1, title: "Alice feature", owners: ["alice"], status: "todo" },
        { id: 2, title: "Bob feature", owners: ["bob"], status: "todo" },
      ],
      isLoading: false,
    });
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Me" }));
    expect(screen.getByText("Alice feature")).toBeInTheDocument();
    expect(screen.queryByText("Bob feature")).not.toBeInTheDocument();
  });

  it("renders the admin-configured stages instead of the defaults", () => {
    mSettings.mockReturnValue({
      data: {
        boardStages: [
          { id: "todo", label: "Backlog", color: "#94a3b8" },
          { id: "doing", label: "Doing", color: "#b89464" },
          { id: "shipped", label: "Shipped", color: "#6e9970" },
        ],
      },
    });
    mFeatures.mockReturnValue({
      data: [{ id: 1, title: "Add login", owners: [], status: "doing" }],
      isLoading: false,
    });
    renderTab();
    // "Backlog" appears twice: once as the admin's stage label (column
    // header) and once as the Board/Backlog view-toggle label — assert
    // that at least one shows up rather than requiring uniqueness.
    expect(screen.getAllByText("Backlog").length).toBeGreaterThan(0);
    expect(screen.getByText("Doing")).toBeInTheDocument();
    expect(screen.getByText("Shipped")).toBeInTheDocument();
    expect(screen.queryByText("To do")).not.toBeInTheDocument();
    expect(screen.queryByText("On production")).not.toBeInTheDocument();
  });
});

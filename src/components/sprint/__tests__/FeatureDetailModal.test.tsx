import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/usePRLinks", () => ({
  useLinkPR: vi.fn(),
  useUnlinkPR: vi.fn(),
  useLinkedPRs: vi.fn(),
}));
vi.mock("@/hooks/useConfigRepo", () => ({
  useSettings: () => ({ data: null }),
}));
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

import { FeatureDetailModal } from "../FeatureDetailModal";
import { useLinkPR, useUnlinkPR, useLinkedPRs } from "@/hooks/usePRLinks";
import type { Feature } from "@/lib/types";

const mockUseLinkPR = useLinkPR as unknown as ReturnType<typeof vi.fn>;
const mockUseUnlinkPR = useUnlinkPR as unknown as ReturnType<typeof vi.fn>;
const mockUseLinkedPRs = useLinkedPRs as unknown as ReturnType<typeof vi.fn>;

function renderModal(
  feature: Feature,
  opts: { onUpdate?: (f: Feature) => void; onClose?: () => void } = {},
) {
  return render(
    <MemoryRouter>
      <FeatureDetailModal
        feature={feature}
        allPeople={["alice", "bob"]}
        onClose={opts.onClose ?? vi.fn()}
        onUpdate={opts.onUpdate ?? vi.fn()}
      />
    </MemoryRouter>,
  );
}

const baseFeature: Feature = {
  id: 42,
  title: "Login flow",
  owners: ["alice"],
  status: "todo",
  plan: "Some markdown plan",
  url: "https://github.com/x/y/issues/42",
};

beforeEach(() => {
  mockUseLinkPR.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseUnlinkPR.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseLinkedPRs.mockReturnValue({ data: [] });
});

describe("FeatureDetailModal", () => {
  it("renders title and plan markdown", () => {
    renderModal(baseFeature);
    const titleInput = screen.getByDisplayValue("Login flow") as HTMLInputElement;
    expect(titleInput).toBeInTheDocument();
    expect(screen.getByTestId("markdown").textContent).toBe("Some markdown plan");
  });

  it("clicking the backdrop calls onClose", () => {
    const onClose = vi.fn();
    renderModal(baseFeature, { onClose });
    // The backdrop is the outermost fixed div — find by its handler indirectly by clicking
    // outside the dialog. We use the dialog parent.
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking inside the dialog does not call onClose", () => {
    const onClose = vi.fn();
    renderModal(baseFeature, { onClose });
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("changing status fires onUpdate with the new status (synchronous, no debounce)", () => {
    const onUpdate = vi.fn();
    renderModal(baseFeature, { onUpdate });
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "ready" } });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "ready" }));
  });

  it("shows 'No description.' when plan is empty", () => {
    renderModal({ ...baseFeature, plan: "" });
    expect(screen.getByText("No description.")).toBeInTheDocument();
  });

  it("clicking Edit opens the textarea and Save fires onUpdate with the new plan", () => {
    const onUpdate = vi.fn();
    renderModal(baseFeature, { onUpdate });
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    // The title input is also a textbox — find the one prefilled with the plan content.
    const textarea = screen.getByDisplayValue("Some markdown plan") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Updated plan" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ plan: "Updated plan" }));
  });

  it("clicking Link PR shows the form, and clicking Link calls the link mutation", () => {
    const mutate = vi.fn();
    mockUseLinkPR.mockReturnValue({ mutate, isPending: false });
    renderModal(baseFeature);
    fireEvent.click(screen.getByRole("button", { name: /link pr/i }));
    fireEvent.change(screen.getByPlaceholderText("repo name"), { target: { value: "api" } });
    fireEvent.change(screen.getByPlaceholderText("123"), { target: { value: "55" } });
    fireEvent.click(screen.getByRole("button", { name: /^link$/i }));
    expect(mutate).toHaveBeenCalledWith(
      { featureNumber: 42, prRepo: "api", prNumber: 55 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("Link button is disabled when inputs are empty", () => {
    renderModal(baseFeature);
    fireEvent.click(screen.getByRole("button", { name: /link pr/i }));
    const linkBtn = screen.getByRole("button", { name: /^link$/i });
    expect(linkBtn).toBeDisabled();
  });

  it("renders linked PRs and unlink button fires the unlink mutation", () => {
    const mutate = vi.fn();
    mockUseUnlinkPR.mockReturnValue({ mutate, isPending: false });
    renderModal({
      ...baseFeature,
      linkedPRs: [{ repo: "api", number: 100 }],
    });
    // "api#100" appears twice (title fallback + the repo#number tag) — use getAllByText.
    expect(screen.getAllByText("api#100").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTitle("Unlink PR"));
    expect(mutate).toHaveBeenCalledWith(
      { featureNumber: 42, prRepo: "api", prNumber: 100 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useConfigRepo", () => ({
  useSettings: () => ({ data: null }),
}));
// The Linked Specs section fires useSpecs/useSpecFolders which need auth +
// react-query context — this stub keeps the modal test focused on the
// non-Specs behaviour that these cases actually assert.
vi.mock("../FeatureLinkedSpecsSection", () => ({
  FeatureLinkedSpecsSection: () => null,
}));
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

import { FeatureDetailModal } from "../FeatureDetailModal";
import type { Feature } from "@/lib/types";

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
  url: "https://github.com/x/y/issues/42",
};

describe("FeatureDetailModal", () => {
  it("renders the title input", () => {
    renderModal(baseFeature);
    const titleInput = screen.getByDisplayValue("Login flow") as HTMLInputElement;
    expect(titleInput).toBeInTheDocument();
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

  it("editing the title fires onUpdate with the new title (debounced 500ms)", async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();
    renderModal(baseFeature, { onUpdate });
    const title = screen.getByDisplayValue("Login flow") as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Login flow v2" } });
    vi.advanceTimersByTime(500);
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ title: "Login flow v2" }));
    vi.useRealTimers();
  });

  it("no longer renders a Description section (Specs replace it)", () => {
    renderModal(baseFeature);
    expect(screen.queryByText(/description/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });
});

// Legacy plan-block tests removed: FeatureDetailModal no longer renders a
// Description section — all content lives in linked Specs.
describe.skip("FeatureDetailModal plan (retired)", () => {
  it("legacy Edit → textarea → Save flow", () => {
    const onUpdate = vi.fn();
    renderModal(baseFeature, { onUpdate });
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    const textarea = screen.getByDisplayValue("Some markdown plan") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Updated plan" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ plan: "Updated plan" }));
  });
});

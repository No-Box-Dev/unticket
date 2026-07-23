import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const updateMutate = vi.fn();

vi.mock("@/hooks/useSpecs", () => ({
  useUpdateSpec: () => ({ mutate: updateMutate, isPending: false }),
  useSetSpecArchived: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useGitHub", () => ({
  useIsAdmin: () => false,
}));
vi.mock("@/hooks/useConfigRepo", () => ({
  useSettings: () => ({ data: null }),
}));
vi.mock("../SpecSourcesSection", () => ({
  SpecSourcesSection: () => null,
}));

import { SpecDetailModal } from "../SpecDetailModal";
import type { Spec } from "@/lib/types";

const spec: Spec = {
  id: 7,
  featureNumber: null,
  isPrimary: false,
  title: "Original spec",
  description: "Original description",
  links: [],
  archived: false,
  archivedAt: null,
  createdBy: "alice",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

describe("SpecDetailModal", () => {
  it("keeps edits local until Save is clicked", () => {
    updateMutate.mockClear();
    render(<SpecDetailModal spec={spec} features={[]} onClose={vi.fn()} />);

    fireEvent.change(screen.getByDisplayValue("Original description"), {
      target: { value: "Changed description" },
    });
    expect(updateMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, description: "Changed description" }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("asks before closing with unsaved changes", async () => {
    const onClose = vi.fn();
    render(<SpecDetailModal spec={spec} features={[]} onClose={onClose} />);
    fireEvent.change(screen.getByDisplayValue("Original spec"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Close spec" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Feature, Spec } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  createSpec: vi.fn(),
  createFeature: vi.fn(),
}));

vi.mock("@/hooks/useSpecs", () => ({
  useCreateSpec: () => ({ mutateAsync: mocks.createSpec, isPending: false }),
}));
vi.mock("@/hooks/useConfigRepo", () => ({
  useCreateFeature: () => ({ mutateAsync: mocks.createFeature, isPending: false }),
}));
vi.mock("@/lib/board-stages", () => ({
  useBoardStages: () => [{ id: "todo", label: "To do", color: "#999999" }],
}));

import { SpecEditorForm } from "../SpecEditorForm";

const feature: Feature = {
  id: 42,
  title: "Linked feature",
  owners: [],
  status: "todo",
};

beforeEach(() => {
  mocks.createSpec.mockReset();
  mocks.createFeature.mockReset();
});

describe("SpecEditorForm feature flow", () => {
  it("creates the full spec linked to the locked feature and returns", async () => {
    const created: Spec = {
      id: 7,
      featureNumber: 42,
      isPrimary: false,
      title: "Detailed spec",
      description: "Full details",
      links: [],
      archived: false,
      archivedAt: null,
      createdBy: "alice",
      createdAt: "2026-07-24",
      updatedAt: "2026-07-24",
    };
    mocks.createSpec.mockResolvedValue(created);
    const onCreated = vi.fn();

    render(
      <SpecEditorForm
        features={[feature]}
        initialFeatureNumber={42}
        lockedFeatureNumber={42}
        onClose={vi.fn()}
        onCreated={onCreated}
      />,
    );

    expect(screen.getByText("Linked feature")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Unfiled")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Optional — defaults to the feature's title"), {
      target: { value: "Detailed spec" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Notes, context/), {
      target: { value: "Full details" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create spec" }));

    await waitFor(() => {
      expect(mocks.createSpec).toHaveBeenCalledWith(expect.objectContaining({
        title: "Detailed spec",
        description: "Full details",
        featureNumber: 42,
      }));
      expect(onCreated).toHaveBeenCalledWith(created);
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Spec } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  specs: [] as Spec[],
  update: vi.fn(),
}));

vi.mock("@/hooks/useSpecs", () => ({
  useSpecs: () => ({ data: mocks.specs }),
  useUpdateSpec: () => ({ mutate: mocks.update }),
  useCreateSpec: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { FeatureLinkedSpecsSection } from "../FeatureLinkedSpecsSection";

function spec(id: number, title: string, isPrimary = false): Spec {
  return {
    id,
    featureNumber: 42,
    isPrimary,
    title,
    description: "",
    links: [],
    archived: false,
    archivedAt: null,
    createdBy: "alice",
    createdAt: "2026-07-20T00:00:00Z",
    updatedAt: "2026-07-20T00:00:00Z",
  };
}

beforeEach(() => {
  mocks.specs = [];
  mocks.update.mockReset();
});

describe("FeatureLinkedSpecsSection primary spec", () => {
  it("does not show a primary selector for a feature with one spec", () => {
    mocks.specs = [spec(1, "Only spec")];
    render(<FeatureLinkedSpecsSection featureNumber={42} featureTitle="Feature" />);

    expect(screen.queryByRole("button", { name: /set .* as primary spec/i })).not.toBeInTheDocument();
  });

  it("allows one of multiple specs to be selected as primary", async () => {
    mocks.specs = [spec(1, "First spec", true), spec(2, "Second spec")];
    render(<FeatureLinkedSpecsSection featureNumber={42} featureTitle="Feature" />);

    expect(screen.getByRole("button", { name: "Set First spec as primary spec" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "Set Second spec as primary spec" }));
    expect(mocks.update).toHaveBeenCalledWith({ id: 2, isPrimary: true });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Spec } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  specs: [] as Spec[],
  update: vi.fn(),
  editorProps: null as null | Record<string, unknown>,
}));

vi.mock("@/hooks/useSpecs", () => ({
  useSpecs: () => ({ data: mocks.specs }),
  useUpdateSpec: () => ({ mutate: mocks.update }),
  useCreateSpec: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/specs/SpecEditorForm", () => ({
  SpecEditorForm: (props: Record<string, unknown>) => {
    mocks.editorProps = props;
    return <div role="dialog" aria-label="Full spec editor">Full spec editor</div>;
  },
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
  mocks.editorProps = null;
});

describe("FeatureLinkedSpecsSection primary spec", () => {
  it("does not show a primary selector for a feature with one spec", () => {
    mocks.specs = [spec(1, "Only spec")];
    render(<FeatureLinkedSpecsSection featureNumber={42} features={[]} />);

    expect(screen.queryByRole("button", { name: /set .* as primary spec/i })).not.toBeInTheDocument();
  });

  it("allows one of multiple specs to be selected as primary", async () => {
    mocks.specs = [spec(1, "First spec", true), spec(2, "Second spec")];
    render(<FeatureLinkedSpecsSection featureNumber={42} features={[]} />);

    expect(screen.getByRole("button", { name: "Set First spec as primary spec" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "Set Second spec as primary spec" }));
    expect(mocks.update).toHaveBeenCalledWith({ id: 2, isPrimary: true });
  });

  it("opens the full spec editor already linked to the current feature", async () => {
    const feature = { id: 42, title: "Feature", owners: [], status: "todo" };
    render(
      <FeatureLinkedSpecsSection
        featureNumber={42}
        features={[feature]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Add spec" }));

    expect(screen.getByRole("dialog", { name: "Full spec editor" })).toBeInTheDocument();
    expect(mocks.editorProps).toEqual(expect.objectContaining({
      features: [feature],
      initialFeatureNumber: 42,
      lockedFeatureNumber: 42,
    }));
  });
});

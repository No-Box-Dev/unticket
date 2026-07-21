import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FeatureCard } from "../FeatureCard";
import { DEFAULT_BOARD_STAGES } from "@/lib/board-stages";
import type { Feature } from "@/lib/types";

const baseFeature: Feature = {
  id: 1,
  title: "Test Feature",
  owners: [],
  status: "todo",
};

const defaultProps = {
  feature: baseFeature,
  stages: DEFAULT_BOARD_STAGES,
  allPeople: ["alice", "bob"],
  // FeatureCard now reads its specs from a prop passed down by SprintTab
  // (which fetches once and buckets by feature number). Empty list keeps
  // these tests focused on card behaviour.
  ownSpecs: [],
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
  onOpenDetail: vi.fn(),
};

describe("FeatureCard", () => {
  it("renders feature title without truncation", () => {
    const longTitle = "This is a very long feature title that should not be truncated";
    const feat = { ...baseFeature, title: longTitle };
    render(<FeatureCard {...defaultProps} feature={feat} />);
    expect(screen.getByText(longTitle)).toBeInTheDocument();
  });

  it("title click calls onOpenDetail", async () => {
    const onOpenDetail = vi.fn();
    render(<FeatureCard {...defaultProps} onOpenDetail={onOpenDetail} />);
    await userEvent.click(screen.getByText("Test Feature"));
    expect(onOpenDetail).toHaveBeenCalledWith(baseFeature);
  });

  it("Delete button calls onDelete when admin", async () => {
    const onDelete = vi.fn();
    render(<FeatureCard {...defaultProps} onDelete={onDelete} isAdmin />);
    await userEvent.click(screen.getByTitle("Remove"));
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("hides Delete button for non-admins", () => {
    render(<FeatureCard {...defaultProps} />);
    expect(screen.queryByTitle("Remove")).not.toBeInTheDocument();
  });

  it("last-stage feature has reduced opacity", () => {
    // "production" is the last DEFAULT_BOARD_STAGES entry → opacity-60.
    const prodFeature = { ...baseFeature, status: "production" };
    const { container } = render(<FeatureCard {...defaultProps} feature={prodFeature} />);
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("opacity-60");
  });

  it("first-stage feature is full opacity", () => {
    const { container } = render(<FeatureCard {...defaultProps} />);
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).not.toContain("opacity-60");
  });

  it("arrow keys move the feature between configured stages", async () => {
    const onUpdate = vi.fn();
    render(<FeatureCard {...defaultProps} onUpdate={onUpdate} draggable />);
    const card = screen.getByRole("listitem");
    card.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "staging" }),
    );
  });

  it("shows drag handle when draggable", () => {
    const { container } = render(<FeatureCard {...defaultProps} draggable />);
    const wrapper = container.firstElementChild!;
    expect(wrapper.getAttribute("draggable")).toBe("true");
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeatureCard } from "../FeatureCard";
import type { Feature } from "@/lib/types";

const baseFeature: Feature = {
  id: 1,
  title: "Test Feature",
  team: "Engineering",
  owners: [],
  status: "plan",
  sprint: 1,
  effort: "medium",
  priority: "high",
};

const defaultProps = {
  feature: baseFeature,
  allPeople: ["alice", "bob"],
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
  onOpenDetail: vi.fn(),
  mode: "sprint" as const,
};

describe("FeatureCard", () => {
  it("renders feature title without truncation", () => {
    const longTitle = "This is a very long feature title that should not be truncated";
    const feat = { ...baseFeature, title: longTitle };
    render(<FeatureCard {...defaultProps} feature={feat} />);
    expect(screen.getByText(longTitle)).toBeInTheDocument();
  });

  it("renders effort tag", () => {
    render(<FeatureCard {...defaultProps} />);
    expect(screen.getByText("Medium")).toBeInTheDocument();
  });

  it("renders priority tag", () => {
    render(<FeatureCard {...defaultProps} />);
    expect(screen.getByTitle("Priority: high")).toBeInTheDocument();
  });

  it("title click calls onOpenDetail", async () => {
    const onOpenDetail = vi.fn();
    render(<FeatureCard {...defaultProps} onOpenDetail={onOpenDetail} />);
    await userEvent.click(screen.getByText("Test Feature"));
    expect(onOpenDetail).toHaveBeenCalledWith(baseFeature);
  });

  it("Delete button calls onDelete", async () => {
    const onDelete = vi.fn();
    render(<FeatureCard {...defaultProps} onDelete={onDelete} />);
    await userEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("shows Backlog button in sprint mode", () => {
    render(<FeatureCard {...defaultProps} />);
    expect(screen.getByText("Backlog")).toBeInTheDocument();
  });

  it("Backlog button moves to backlog", async () => {
    const onUpdate = vi.fn();
    render(<FeatureCard {...defaultProps} onUpdate={onUpdate} />);
    await userEvent.click(screen.getByText("Backlog"));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "future", sprint: null }),
    );
  });

  it("shows 'Sprint' in backlog mode", () => {
    render(<FeatureCard {...defaultProps} mode="backlog" currentSprint={2} />);
    expect(screen.getByText("Sprint")).toBeInTheDocument();
    expect(screen.queryByText("Backlog")).not.toBeInTheDocument();
  });

  it("Sprint button updates sprint and status", async () => {
    const onUpdate = vi.fn();
    render(<FeatureCard {...defaultProps} mode="backlog" currentSprint={2} onUpdate={onUpdate} />);
    await userEvent.click(screen.getByText("Sprint"));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ sprint: 2, status: "plan" }),
    );
  });

  it("production feature has reduced opacity", () => {
    const prodFeature = { ...baseFeature, status: "production" as const };
    const { container } = render(<FeatureCard {...defaultProps} feature={prodFeature} />);
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("opacity-60");
  });

  it("shows drag handle when draggable", () => {
    const { container } = render(<FeatureCard {...defaultProps} draggable />);
    const wrapper = container.firstElementChild!;
    expect(wrapper.getAttribute("draggable")).toBe("true");
  });
});

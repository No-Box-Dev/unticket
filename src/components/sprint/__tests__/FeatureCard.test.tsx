import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeatureCard } from "../FeatureCard";
import type { Feature } from "@/lib/types";

const baseFeature: Feature = {
  id: "feat-1",
  title: "Test Feature",
  team: "Engineering",
  owners: [],
  status: "active",
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
  it("renders feature title", () => {
    render(<FeatureCard {...defaultProps} />);
    expect(screen.getByText("Test Feature")).toBeInTheDocument();
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

  it("shows Done button in sprint mode for active features", () => {
    render(<FeatureCard {...defaultProps} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("Done button calls onUpdate with status 'done'", async () => {
    const onUpdate = vi.fn();
    render(<FeatureCard {...defaultProps} onUpdate={onUpdate} />);
    await userEvent.click(screen.getByText("Done"));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "done" }));
  });

  it("Delete button calls onDelete", async () => {
    const onDelete = vi.fn();
    render(<FeatureCard {...defaultProps} onDelete={onDelete} />);
    await userEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalledWith("feat-1");
  });

  it("shows Future button in sprint mode", () => {
    render(<FeatureCard {...defaultProps} />);
    expect(screen.getByText("Future")).toBeInTheDocument();
  });

  it("Future button moves to backlog", async () => {
    const onUpdate = vi.fn();
    render(<FeatureCard {...defaultProps} onUpdate={onUpdate} />);
    await userEvent.click(screen.getByText("Future"));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "future", sprint: null }),
    );
  });

  it("shows 'Move to Sprint' in backlog mode", () => {
    render(<FeatureCard {...defaultProps} mode="backlog" currentSprint={2} />);
    expect(screen.getByText("Move to Sprint")).toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    expect(screen.queryByText("Future")).not.toBeInTheDocument();
  });

  it("Move to Sprint updates sprint and status", async () => {
    const onUpdate = vi.fn();
    render(<FeatureCard {...defaultProps} mode="backlog" currentSprint={2} onUpdate={onUpdate} />);
    await userEvent.click(screen.getByText("Move to Sprint"));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ sprint: 2, status: "active" }),
    );
  });

  it("done feature has reduced opacity", () => {
    const doneFeature = { ...baseFeature, status: "done" as const };
    const { container } = render(<FeatureCard {...defaultProps} feature={doneFeature} />);
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("opacity-50");
  });

  it("done feature does not show Done or Future buttons", () => {
    const doneFeature = { ...baseFeature, status: "done" as const };
    render(<FeatureCard {...defaultProps} feature={doneFeature} />);
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    expect(screen.queryByText("Future")).not.toBeInTheDocument();
  });
});

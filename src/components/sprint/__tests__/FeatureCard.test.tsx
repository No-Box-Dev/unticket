import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeatureCard } from "../FeatureCard";
import type { Feature } from "@/lib/types";

const baseFeature: Feature = {
  id: 1,
  title: "Test Feature",
  owners: [],
  status: "todo",
};

const defaultProps = {
  feature: baseFeature,
  allPeople: ["alice", "bob"],
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
  onOpenDetail: vi.fn(),
  mode: "active" as const,
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

  it("Delete button calls onDelete when admin (after confirm)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onDelete = vi.fn();
    render(<FeatureCard {...defaultProps} onDelete={onDelete} isAdmin />);
    await userEvent.click(screen.getByTitle("Remove"));
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("hides Delete button for non-admins", () => {
    render(<FeatureCard {...defaultProps} />);
    expect(screen.queryByTitle("Delete")).not.toBeInTheDocument();
  });

  it("shows Move to Backlog button in active mode", () => {
    render(<FeatureCard {...defaultProps} />);
    expect(screen.getByTitle("Move to Backlog")).toBeInTheDocument();
  });

  it("Move to Backlog button moves to backlog", async () => {
    const onUpdate = vi.fn();
    render(<FeatureCard {...defaultProps} onUpdate={onUpdate} />);
    await userEvent.click(screen.getByTitle("Move to Backlog"));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "future" }),
    );
  });

  it("shows Move to To do in backlog mode", () => {
    render(<FeatureCard {...defaultProps} mode="backlog" />);
    expect(screen.getByTitle("Move to To do")).toBeInTheDocument();
    expect(screen.queryByTitle("Move to Backlog")).not.toBeInTheDocument();
  });

  it("Move to To do button updates status", async () => {
    const onUpdate = vi.fn();
    render(<FeatureCard {...defaultProps} mode="backlog" onUpdate={onUpdate} />);
    await userEvent.click(screen.getByTitle("Move to To do"));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "todo" }),
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

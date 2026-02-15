import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PriorityTag } from "../PriorityTag";

describe("PriorityTag", () => {
  it("renders with correct title for each priority", () => {
    const { rerender } = render(<PriorityTag priority="high" onChange={() => {}} />);
    expect(screen.getByTitle("Priority: high")).toBeInTheDocument();

    rerender(<PriorityTag priority="medium" onChange={() => {}} />);
    expect(screen.getByTitle("Priority: medium")).toBeInTheDocument();

    rerender(<PriorityTag priority="low" onChange={() => {}} />);
    expect(screen.getByTitle("Priority: low")).toBeInTheDocument();

    rerender(<PriorityTag priority="none" onChange={() => {}} />);
    expect(screen.getByTitle("Priority: none")).toBeInTheDocument();
  });

  it("cycles none → low on click", async () => {
    const onChange = vi.fn();
    render(<PriorityTag priority="none" onChange={onChange} />);
    await userEvent.click(screen.getByTitle("Priority: none"));
    expect(onChange).toHaveBeenCalledWith("low");
  });

  it("cycles low → medium on click", async () => {
    const onChange = vi.fn();
    render(<PriorityTag priority="low" onChange={onChange} />);
    await userEvent.click(screen.getByTitle("Priority: low"));
    expect(onChange).toHaveBeenCalledWith("medium");
  });

  it("cycles medium → high on click", async () => {
    const onChange = vi.fn();
    render(<PriorityTag priority="medium" onChange={onChange} />);
    await userEvent.click(screen.getByTitle("Priority: medium"));
    expect(onChange).toHaveBeenCalledWith("high");
  });

  it("cycles high → none on click", async () => {
    const onChange = vi.fn();
    render(<PriorityTag priority="high" onChange={onChange} />);
    await userEvent.click(screen.getByTitle("Priority: high"));
    expect(onChange).toHaveBeenCalledWith("none");
  });

  it("renders filled flag for high/medium/low, unfilled for none", () => {
    const { container, rerender } = render(<PriorityTag priority="high" onChange={() => {}} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("fill")).toBe("currentColor");

    rerender(<PriorityTag priority="none" onChange={() => {}} />);
    const svg2 = container.querySelector("svg")!;
    expect(svg2.getAttribute("fill")).toBe("none");
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { BarChart } from "../BarChart";

const data = [
  { weekStart: "2026-01-01", value: 1 },
  { weekStart: "2026-01-08", value: 5 },
  { weekStart: "2026-01-15", value: 3 },
];

describe("BarChart", () => {
  it("renders nothing when data is empty", () => {
    const { container } = render(<BarChart data={[]} color="#000" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one bar per data point", () => {
    const { container } = render(<BarChart data={data} color="#3b82f6" />);
    // The inner colored bars have backgroundColor inline style.
    const bars = container.querySelectorAll("div[style*='background-color']");
    expect(bars.length).toBe(3);
  });

  it("calls onBarClick with the weekStart when a bar is clicked", () => {
    const onBarClick = vi.fn();
    const { container } = render(
      <BarChart data={data} color="#3b82f6" onBarClick={onBarClick} />,
    );
    // The clickable wrapper is the first level — pick the second one (index 1).
    const wrappers = container.querySelectorAll(".relative.flex-1");
    fireEvent.click(wrappers[1]);
    expect(onBarClick).toHaveBeenCalledWith("2026-01-08");
  });

  it("does not render a hover value before mouseenter", () => {
    const { container } = render(<BarChart data={data} color="#3b82f6" />);
    expect(container.querySelector("[class*='-top-5']")).toBeNull();
  });

  it("shows the hover value tooltip on mouseenter", () => {
    const { container } = render(<BarChart data={data} color="#3b82f6" />);
    const wrappers = container.querySelectorAll(".relative.flex-1");
    fireEvent.mouseEnter(wrappers[1]);
    // The hover element renders the bar's value (5) for index 1.
    expect(container.textContent).toContain("5");
  });

  it("renders weekday-style labels when daily=true", () => {
    const { container } = render(<BarChart data={data} color="#000" daily />);
    // Day-style label includes the weekday name; e.g. "1 Thu"
    expect(container.textContent).toMatch(/\d+\s*[A-Z][a-z]{2}/);
  });
});

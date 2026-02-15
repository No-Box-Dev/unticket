import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "../Sparkline";
import type { WeeklyBucket } from "@/lib/types";

function makeBuckets(values: number[]): WeeklyBucket[] {
  return values.map((value, i) => ({
    weekStart: `2026-0${Math.min(i + 1, 9)}-01`,
    value,
  }));
}

describe("Sparkline", () => {
  it("returns null for less than 2 data points", () => {
    const { container } = render(<Sparkline data={[]} color="#000" />);
    expect(container.firstChild).toBeNull();

    const { container: c2 } = render(
      <Sparkline data={makeBuckets([5])} color="#000" />,
    );
    expect(c2.firstChild).toBeNull();
  });

  it("renders SVG for 2+ data points", () => {
    const { container } = render(
      <Sparkline data={makeBuckets([5, 10])} color="#000" />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("renders polyline and polygon", () => {
    const { container } = render(
      <Sparkline data={makeBuckets([5, 10, 3])} color="#ff0000" />,
    );
    expect(container.querySelector("polyline")).not.toBeNull();
    expect(container.querySelector("polygon")).not.toBeNull();
  });

  it("renders current value dot (circle)", () => {
    const { container } = render(
      <Sparkline data={makeBuckets([5, 10])} color="#000" />,
    );
    expect(container.querySelector("circle")).not.toBeNull();
  });

  it("uses the provided color", () => {
    const { container } = render(
      <Sparkline data={makeBuckets([5, 10])} color="#ff0000" />,
    );
    const polyline = container.querySelector("polyline")!;
    expect(polyline.getAttribute("stroke")).toBe("#ff0000");
  });

  it("does not render labels by default", () => {
    const { container } = render(
      <Sparkline data={makeBuckets([5, 10])} color="#000" />,
    );
    expect(container.querySelectorAll("text")).toHaveLength(0);
  });

  it("renders labels when labels prop is true", () => {
    const { container } = render(
      <Sparkline data={makeBuckets([5, 10])} color="#000" labels />,
    );
    expect(container.querySelectorAll("text").length).toBeGreaterThanOrEqual(2);
  });

  it("respects custom width and height", () => {
    const { container } = render(
      <Sparkline data={makeBuckets([5, 10])} color="#000" width={300} height={100} />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("300");
    expect(svg.getAttribute("height")).toBe("100");
  });
});

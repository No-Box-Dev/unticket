import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CircularProgress } from "../CircularProgress";

describe("CircularProgress", () => {
  it("renders an SVG of the given size", () => {
    const { container } = render(<CircularProgress value={50} color="#000" size={64} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("64");
    expect(svg?.getAttribute("height")).toBe("64");
  });

  it("renders both the track and progress circles", () => {
    const { container } = render(<CircularProgress value={50} color="red" />);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it("uses the provided progress color on the second circle", () => {
    const { container } = render(<CircularProgress value={75} color="rebeccapurple" />);
    const circles = container.querySelectorAll("circle");
    expect(circles[1].getAttribute("stroke")).toBe("rebeccapurple");
  });

  it("clamps value below 0 (offset == circumference, no progress visible)", () => {
    const { container } = render(<CircularProgress value={-100} color="red" size={48} strokeWidth={4} />);
    const radius = (48 - 4) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = container.querySelectorAll("circle")[1].getAttribute("stroke-dashoffset");
    expect(Number(offset)).toBeCloseTo(circumference, 5);
  });

  it("clamps value above 100 (offset == 0, fully complete)", () => {
    const { container } = render(<CircularProgress value={500} color="red" />);
    const offset = container.querySelectorAll("circle")[1].getAttribute("stroke-dashoffset");
    expect(Number(offset)).toBeCloseTo(0, 5);
  });
});

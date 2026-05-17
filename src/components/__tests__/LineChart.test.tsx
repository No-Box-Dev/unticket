import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LineChart } from "../LineChart";

describe("LineChart", () => {
  it("renders nothing when given no lines", () => {
    const { container } = render(<LineChart lines={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when all lines are empty", () => {
    const { container } = render(
      <LineChart lines={[{ data: [], color: "red", label: "A" }]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render a path for a line with fewer than 2 points", () => {
    const { container } = render(
      <LineChart
        lines={[{ data: [{ x: 0, y: 1 }], color: "red", label: "A" }]}
      />,
    );
    // SVG exists (line.data.length > 0 passes the `every` check),
    // but the actual `<path>` element only renders for length >= 2.
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("path")).toBeNull();
  });

  it("draws one <path> per non-empty multi-point line", () => {
    const { container } = render(
      <LineChart
        lines={[
          { data: [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }], color: "red", label: "A" },
          { data: [{ x: 0, y: 5 }, { x: 1, y: 4 }], color: "blue", label: "B", dashed: true },
        ]}
      />,
    );
    expect(container.querySelectorAll("path")).toHaveLength(2);
  });

  it("renders the legend label for every line", () => {
    const { container } = render(
      <LineChart
        lines={[
          { data: [{ x: 0, y: 1 }, { x: 1, y: 2 }], color: "red", label: "Series A" },
          { data: [{ x: 0, y: 3 }, { x: 1, y: 4 }], color: "blue", label: "Series B" },
        ]}
      />,
    );
    expect(container.textContent).toContain("Series A");
    expect(container.textContent).toContain("Series B");
  });

  it("uses the xLabel formatter for axis ticks when provided", () => {
    const { container } = render(
      <LineChart
        lines={[{ data: [{ x: 0, y: 1 }, { x: 6, y: 4 }], color: "red", label: "A" }]}
        xLabel={(v) => `wk${v}`}
      />,
    );
    expect(container.textContent).toMatch(/wk0/);
  });
});

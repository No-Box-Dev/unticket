import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SortIcon } from "../SortIcon";

describe("SortIcon", () => {
  it("renders nothing when the column is not the active sort key", () => {
    const { container } = render(
      <SortIcon column="title" activeSortKey="age" activeSortDirection="asc" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a chevron-up SVG when active and direction is asc", () => {
    const { container } = render(
      <SortIcon column="title" activeSortKey="title" activeSortDirection="asc" />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // ChevronUp polyline has y values increasing top-to-bottom in the path data
    expect(svg!.outerHTML).toMatch(/chevron-up|m18\s+15|18 15/i);
  });

  it("renders a chevron-down SVG when active and direction is desc", () => {
    const { container } = render(
      <SortIcon column="title" activeSortKey="title" activeSortDirection="desc" />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.outerHTML).toMatch(/chevron-down|m6\s+9|6 9/i);
  });
});

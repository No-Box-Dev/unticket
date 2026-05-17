import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatCard } from "../StatCard";

describe("StatCard", () => {
  it("renders label and value", () => {
    render(<StatCard label="Open issues" value={42} icon={<svg data-testid="i" />} />);
    expect(screen.getByText("Open issues")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders string value", () => {
    render(<StatCard label="Status" value="OK" icon={<svg />} />);
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("shows a skeleton placeholder when loading", () => {
    const { container } = render(
      <StatCard label="x" value={0} icon={<svg />} loading />,
    );
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("renders the icon node", () => {
    render(<StatCard label="x" value={1} icon={<svg data-testid="icon" />} />);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("applies extra className to the outer container", () => {
    const { container } = render(
      <StatCard label="x" value={1} icon={<svg />} className="custom-class" />,
    );
    expect((container.firstChild as HTMLElement).className).toMatch(/custom-class/);
  });
});

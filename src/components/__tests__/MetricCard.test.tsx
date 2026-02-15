import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricCard } from "../MetricCard";
import type { MetricData } from "@/lib/types";

const baseMetric: MetricData = {
  current: 12,
  previous: 8,
  change: 4,
  history: [
    { weekStart: "2026-01-01", value: 5 },
    { weekStart: "2026-01-08", value: 8 },
    { weekStart: "2026-01-15", value: 12 },
  ],
};

describe("MetricCard", () => {
  it("displays title", () => {
    render(<MetricCard title="PRs Merged" metric={baseMetric} color="#3b82f6" />);
    expect(screen.getByText("PRs Merged")).toBeInTheDocument();
  });

  it("displays current value", () => {
    render(<MetricCard title="PRs Merged" metric={baseMetric} color="#3b82f6" />);
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows positive change text with +", () => {
    render(<MetricCard title="PRs Merged" metric={baseMetric} color="#3b82f6" />);
    expect(screen.getByText("+4 from last wk")).toBeInTheDocument();
  });

  it("shows negative change text", () => {
    const metric = { ...baseMetric, change: -3 };
    render(<MetricCard title="Issues" metric={metric} color="#ef4444" />);
    expect(screen.getByText("-3 from last wk")).toBeInTheDocument();
  });

  it("shows 'No change' for zero change", () => {
    const metric = { ...baseMetric, change: 0 };
    render(<MetricCard title="Issues" metric={metric} color="#ef4444" />);
    expect(screen.getByText("No change")).toBeInTheDocument();
  });

  it("positive change shows green text by default", () => {
    const { container } = render(
      <MetricCard title="PRs" metric={baseMetric} color="#3b82f6" />,
    );
    const changeSpan = container.querySelector(".text-green-600");
    expect(changeSpan).not.toBeNull();
  });

  it("negative change shows red text by default", () => {
    const metric = { ...baseMetric, change: -2 };
    const { container } = render(
      <MetricCard title="Issues" metric={metric} color="#ef4444" />,
    );
    const changeSpan = container.querySelector(".text-red-500");
    expect(changeSpan).not.toBeNull();
  });

  it("invertTrend flips color logic — decrease is green", () => {
    const metric = { ...baseMetric, change: -3 };
    const { container } = render(
      <MetricCard title="Issues Remaining" metric={metric} color="#ef4444" invertTrend />,
    );
    // Decrease should be green when inverted
    const greenSpan = container.querySelector(".text-green-600");
    expect(greenSpan).not.toBeNull();
  });

  it("invertTrend — increase is red", () => {
    const { container } = render(
      <MetricCard title="Issues Remaining" metric={baseMetric} color="#ef4444" invertTrend />,
    );
    const redSpan = container.querySelector(".text-red-500");
    expect(redSpan).not.toBeNull();
  });

  it("renders Sparkline", () => {
    const { container } = render(
      <MetricCard title="PRs" metric={baseMetric} color="#3b82f6" />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

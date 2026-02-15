import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EffortTag } from "../EffortTag";

describe("EffortTag", () => {
  it("renders correct label for each effort level", () => {
    const { rerender } = render(<EffortTag effort="low" onChange={() => {}} />);
    expect(screen.getByText("Low")).toBeInTheDocument();

    rerender(<EffortTag effort="medium" onChange={() => {}} />);
    expect(screen.getByText("Medium")).toBeInTheDocument();

    rerender(<EffortTag effort="high" onChange={() => {}} />);
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("cycles medium → low on click", async () => {
    const onChange = vi.fn();
    render(<EffortTag effort="medium" onChange={onChange} />);
    await userEvent.click(screen.getByText("Medium"));
    expect(onChange).toHaveBeenCalledWith("low");
  });

  it("cycles low → high on click", async () => {
    const onChange = vi.fn();
    render(<EffortTag effort="low" onChange={onChange} />);
    await userEvent.click(screen.getByText("Low"));
    expect(onChange).toHaveBeenCalledWith("high");
  });

  it("cycles high → medium on click", async () => {
    const onChange = vi.fn();
    render(<EffortTag effort="high" onChange={onChange} />);
    await userEvent.click(screen.getByText("High"));
    expect(onChange).toHaveBeenCalledWith("medium");
  });

  it("has correct title attribute", () => {
    render(<EffortTag effort="medium" onChange={() => {}} />);
    expect(screen.getByTitle("Click to cycle effort")).toBeInTheDocument();
  });
});

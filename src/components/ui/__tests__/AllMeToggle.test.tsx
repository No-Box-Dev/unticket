import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AllMeToggle } from "../AllMeToggle";

describe("AllMeToggle", () => {
  it("shows the active scope and changes it", () => {
    const onChange = vi.fn();
    render(<AllMeToggle me={false} onChange={onChange} />);

    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Me" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

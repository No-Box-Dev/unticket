import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Spinner } from "../Spinner";

describe("Spinner", () => {
  it("renders with default md size classes", () => {
    const { container } = render(<Spinner />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toMatch(/h-6/);
    expect(el.className).toMatch(/w-6/);
    expect(el.className).toMatch(/animate-spin/);
  });

  it("renders sm size classes when size='sm'", () => {
    const { container } = render(<Spinner size="sm" />);
    expect((container.firstChild as HTMLElement).className).toMatch(/h-4/);
  });

  it("renders lg size classes when size='lg'", () => {
    const { container } = render(<Spinner size="lg" />);
    expect((container.firstChild as HTMLElement).className).toMatch(/h-8/);
  });

  it("merges extra className prop", () => {
    const { container } = render(<Spinner className="text-red-500" />);
    expect((container.firstChild as HTMLElement).className).toMatch(/text-red-500/);
  });
});

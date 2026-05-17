import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/useBootstrapStatus", () => ({
  useBootstrapStatus: vi.fn(),
}));

import { BootstrapOverlay } from "../BootstrapOverlay";
import { useBootstrapStatus } from "@/hooks/useBootstrapStatus";

const mockHook = useBootstrapStatus as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockHook.mockReset();
});

describe("BootstrapOverlay", () => {
  it("renders nothing when data is undefined (still loading)", () => {
    mockHook.mockReturnValue({ data: undefined });
    const { container } = render(<BootstrapOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when bootstrapping is false", () => {
    mockHook.mockReturnValue({ data: { bootstrapping: false } });
    const { container } = render(<BootstrapOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the overlay message when bootstrapping is true", () => {
    mockHook.mockReturnValue({ data: { bootstrapping: true } });
    render(<BootstrapOverlay />);
    expect(screen.getByText("Setting up your workspace")).toBeInTheDocument();
    expect(screen.getByText(/Pulling repos, members, issues, and PRs/)).toBeInTheDocument();
  });
});

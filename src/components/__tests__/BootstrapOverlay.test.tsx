import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useBootstrapStatus", () => ({
  useBootstrapStatus: vi.fn(),
}));

import { BootstrapOverlay } from "../BootstrapOverlay";
import { useBootstrapStatus } from "@/hooks/useBootstrapStatus";

const mockHook = useBootstrapStatus as unknown as ReturnType<typeof vi.fn>;

// BootstrapOverlay calls useQueryClient (to refetch on "continue anyway"),
// so it must render inside a provider.
function renderOverlay() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BootstrapOverlay />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockHook.mockReset();
});

describe("BootstrapOverlay", () => {
  it("renders nothing when data is undefined (still loading)", () => {
    mockHook.mockReturnValue({ data: undefined });
    const { container } = renderOverlay();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when bootstrapping is false", () => {
    mockHook.mockReturnValue({ data: { bootstrapping: false } });
    const { container } = renderOverlay();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the overlay message when bootstrapping is true", () => {
    mockHook.mockReturnValue({ data: { bootstrapping: true } });
    renderOverlay();
    expect(screen.getByText("Setting up your workspace")).toBeInTheDocument();
    expect(screen.getByText(/Pulling repos, members, issues, and PRs/)).toBeInTheDocument();
  });
});

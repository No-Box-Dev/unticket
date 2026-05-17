import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useConfigRepo", () => ({
  useFeatures: vi.fn(),
  usePeople: vi.fn(),
}));
vi.mock("@/hooks/useGitHub", () => ({
  useActiveMembers: vi.fn(),
}));

import { CommandPalette } from "../CommandPalette";
import { useFeatures, usePeople } from "@/hooks/useConfigRepo";
import { useActiveMembers } from "@/hooks/useGitHub";

const mockFeatures = useFeatures as unknown as ReturnType<typeof vi.fn>;
const mockPeople = usePeople as unknown as ReturnType<typeof vi.fn>;
const mockMembers = useActiveMembers as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFeatures.mockReturnValue({ data: [] });
  mockPeople.mockReturnValue({ data: [] });
  mockMembers.mockReturnValue({ data: [] });
});

function renderPalette(onNavigate = vi.fn()) {
  return render(
    <MemoryRouter>
      <CommandPalette onNavigate={onNavigate} />
    </MemoryRouter>,
  );
}

function openWithCmdK() {
  fireEvent.keyDown(document, { key: "k", metaKey: true });
}

describe("CommandPalette", () => {
  it("is closed by default (renders nothing)", () => {
    const { container } = renderPalette();
    expect(container).toBeEmptyDOMElement();
  });

  it("opens on CMD+K and shows tab items as default results", () => {
    renderPalette();
    openWithCmdK();
    expect(screen.getByPlaceholderText("Search features, people...")).toBeInTheDocument();
    expect(screen.getByText("Features")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    renderPalette();
    openWithCmdK();
    expect(screen.getByPlaceholderText("Search features, people...")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Search features, people...")).toBeNull();
  });

  it("filters by feature title when searching", () => {
    mockFeatures.mockReturnValue({
      data: [
        { id: 1, title: "Login flow", owners: ["alice"], status: "todo" },
        { id: 2, title: "Sprint board", owners: [], status: "todo" },
      ],
    });
    renderPalette();
    openWithCmdK();
    const input = screen.getByPlaceholderText("Search features, people...");
    fireEvent.change(input, { target: { value: "Login" } });
    expect(screen.getByText("Login flow")).toBeInTheDocument();
    expect(screen.queryByText("Sprint board")).toBeNull();
  });

  it("clicking a tab result calls onNavigate with that tab ID", () => {
    const onNavigate = vi.fn();
    renderPalette(onNavigate);
    openWithCmdK();
    fireEvent.click(screen.getByText("Issues"));
    expect(onNavigate).toHaveBeenCalledWith("issues");
  });

  it("shows 'No results' when query matches nothing", () => {
    renderPalette();
    openWithCmdK();
    fireEvent.change(screen.getByPlaceholderText("Search features, people..."), {
      target: { value: "zzzzzzz" },
    });
    expect(screen.getByText("No results")).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useSpecs", () => ({
  useSpecs: () => ({
    data: [
      { id: 1, featureNumber: 10, isPrimary: false, title: "Alice spec", description: "", links: [], archived: false, archivedAt: null, createdBy: "alice", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      { id: 2, featureNumber: 20, isPrimary: false, title: "Bob spec", description: "", links: [], archived: false, archivedAt: null, createdBy: "bob", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useConfigRepo", () => ({
  useFeatures: () => ({ data: [
    { id: 10, title: "Alice feature", status: "todo", owners: ["alice"] },
    { id: 20, title: "Bob feature", status: "todo", owners: ["bob"] },
  ] }),
  useSettings: () => ({ data: null }),
}));
vi.mock("@/hooks/useGitHub", () => ({
  useActiveMembers: () => ({ data: [{ login: "alice" }, { login: "bob" }] }),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { login: "alice" } }),
}));

import { SpecsTab } from "../SpecsTab";

describe("SpecsTab", () => {
  it("filters specs through their feature owner with the Me toggle", () => {
    render(<MemoryRouter><SpecsTab /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Me" }));

    expect(screen.getByText("Alice spec")).toBeInTheDocument();
    expect(screen.queryByText("Bob spec")).not.toBeInTheDocument();
  });
});

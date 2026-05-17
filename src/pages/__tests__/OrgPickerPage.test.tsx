import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/auth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useGitHub", () => ({ useOrgs: vi.fn() }));

import { OrgPickerPage } from "../OrgPickerPage";
import { useAuth } from "@/lib/auth";
import { useOrgs } from "@/hooks/useGitHub";

const mAuth = useAuth as unknown as ReturnType<typeof vi.fn>;
const mOrgs = useOrgs as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mAuth.mockReset();
  mOrgs.mockReset();
});

describe("OrgPickerPage", () => {
  it("shows the spinner while orgs are loading", () => {
    mAuth.mockReturnValue({ setSelectedOrg: vi.fn(), logout: vi.fn() });
    mOrgs.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<OrgPickerPage />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders an empty-state message when there are no orgs", () => {
    mAuth.mockReturnValue({ setSelectedOrg: vi.fn(), logout: vi.fn() });
    mOrgs.mockReturnValue({ data: [], isLoading: false });
    render(<OrgPickerPage />);
    expect(screen.getByText(/No organisations listed/i)).toBeInTheDocument();
  });

  it("calls setSelectedOrg when a listed org is clicked", () => {
    const setSelectedOrg = vi.fn();
    mAuth.mockReturnValue({ setSelectedOrg, logout: vi.fn() });
    mOrgs.mockReturnValue({
      data: [{ login: "acme", avatar_url: "https://x/a.png", description: "" }],
      isLoading: false,
    });
    render(<OrgPickerPage />);
    fireEvent.click(screen.getByText("acme"));
    expect(setSelectedOrg).toHaveBeenCalledWith("acme");
  });

  it("manual entry submits the trimmed value", () => {
    const setSelectedOrg = vi.fn();
    mAuth.mockReturnValue({ setSelectedOrg, logout: vi.fn() });
    mOrgs.mockReturnValue({ data: [], isLoading: false });
    render(<OrgPickerPage />);
    fireEvent.change(screen.getByPlaceholderText(/Enter org name/i), {
      target: { value: "  beta  " },
    });
    fireEvent.click(screen.getByText("Go"));
    expect(setSelectedOrg).toHaveBeenCalledWith("beta");
  });

  it("clicking 'Sign out' calls logout", () => {
    const logout = vi.fn();
    mAuth.mockReturnValue({ setSelectedOrg: vi.fn(), logout });
    mOrgs.mockReturnValue({ data: [], isLoading: false });
    render(<OrgPickerPage />);
    fireEvent.click(screen.getByText("Sign out"));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

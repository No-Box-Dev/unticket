import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/auth", () => ({ useAuth: vi.fn() }));

import { LoginPage } from "../LoginPage";
import { useAuth } from "@/lib/auth";

const mAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mAuth.mockReset();
});

describe("LoginPage", () => {
  it("calls loginWithOAuth when the GitHub button is clicked", () => {
    const loginWithOAuth = vi.fn();
    mAuth.mockReturnValue({ loginWithOAuth });
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Sign in with GitHub"));
    expect(loginWithOAuth).toHaveBeenCalledTimes(1);
  });

  it("does not expose any personal-access-token entry path", () => {
    mAuth.mockReturnValue({ loginWithOAuth: vi.fn() });
    render(<LoginPage />);
    expect(screen.queryByPlaceholderText(/ghp_/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/Paste a GitHub/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Connect$/ })).not.toBeInTheDocument();
  });
});

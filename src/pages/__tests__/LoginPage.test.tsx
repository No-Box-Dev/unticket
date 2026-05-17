import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/auth", () => ({ useAuth: vi.fn() }));

import { LoginPage } from "../LoginPage";
import { useAuth } from "@/lib/auth";

const mAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mAuth.mockReset();
});

describe("LoginPage", () => {
  it("calls loginWithOAuth when authMode is oauth and the button is clicked", () => {
    const loginWithOAuth = vi.fn();
    mAuth.mockReturnValue({
      authMode: "oauth",
      loginWithOAuth,
      loginWithToken: vi.fn(),
    });
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Sign in with GitHub"));
    expect(loginWithOAuth).toHaveBeenCalledTimes(1);
  });

  it("shows the PAT form when authMode is pat and the button is clicked", () => {
    mAuth.mockReturnValue({
      authMode: "pat",
      loginWithOAuth: vi.fn(),
      loginWithToken: vi.fn(),
    });
    render(<LoginPage />);
    expect(screen.queryByPlaceholderText(/ghp_/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Sign in with GitHub"));
    expect(screen.getByPlaceholderText(/ghp_/i)).toBeInTheDocument();
  });

  it("calls loginWithToken with the trimmed token on submit", async () => {
    const loginWithToken = vi.fn().mockResolvedValue(undefined);
    mAuth.mockReturnValue({
      authMode: "pat",
      loginWithOAuth: vi.fn(),
      loginWithToken,
    });
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Sign in with GitHub"));
    const input = screen.getByPlaceholderText(/ghp_/i);
    fireEvent.change(input, { target: { value: "  ghp_abc  " } });
    fireEvent.click(screen.getByText("Connect"));
    await waitFor(() => expect(loginWithToken).toHaveBeenCalledWith("ghp_abc"));
  });

  it("shows an error message when loginWithToken rejects", async () => {
    const loginWithToken = vi.fn().mockRejectedValue(new Error("nope"));
    mAuth.mockReturnValue({
      authMode: "pat",
      loginWithOAuth: vi.fn(),
      loginWithToken,
    });
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Sign in with GitHub"));
    fireEvent.change(screen.getByPlaceholderText(/ghp_/i), {
      target: { value: "ghp_x" },
    });
    fireEvent.click(screen.getByText("Connect"));
    await waitFor(() =>
      expect(screen.getByText(/Invalid token/i)).toBeInTheDocument(),
    );
  });
});

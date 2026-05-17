import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/hooks/useNoxlink", () => ({
  useFeedActors: vi.fn(),
  usePatchActor: vi.fn(),
}));

import { ActorVoiceCard } from "../ActorVoiceCard";
import { useFeedActors, usePatchActor } from "@/hooks/useNoxlink";

const mockUseFeedActors = useFeedActors as unknown as ReturnType<typeof vi.fn>;
const mockUsePatchActor = usePatchActor as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockUseFeedActors.mockReset();
  mockUsePatchActor.mockReset();
});

describe("ActorVoiceCard", () => {
  it("shows a spinner while actors are loading", () => {
    mockUseFeedActors.mockReturnValue({ data: undefined, isLoading: true });
    mockUsePatchActor.mockReturnValue({ mutateAsync: vi.fn() });
    const { container } = render(<ActorVoiceCard githubLogin="alice" />);
    // Spinner uses `animate-spin`
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows the no-actor message when no actor matches the login", () => {
    mockUseFeedActors.mockReturnValue({ data: [], isLoading: false });
    mockUsePatchActor.mockReturnValue({ mutateAsync: vi.fn() });
    render(<ActorVoiceCard githubLogin="ghost" />);
    expect(screen.getByText(/no actor row yet/i)).toBeInTheDocument();
  });

  it("renders the editor with the current tone when an actor exists", () => {
    mockUseFeedActors.mockReturnValue({
      data: [{ id: "actor_alice", github_login: "alice", tone: "Dry", kind: "person" }],
      isLoading: false,
    });
    mockUsePatchActor.mockReturnValue({ mutateAsync: vi.fn() });
    render(<ActorVoiceCard githubLogin="alice" />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Dry");
    expect(screen.getByText("person")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save voice/i })).toBeDisabled();
  });

  it("enables Save when the textarea diverges from the original tone", () => {
    mockUseFeedActors.mockReturnValue({
      data: [{ id: "actor_alice", github_login: "alice", tone: "Dry", kind: "person" }],
      isLoading: false,
    });
    mockUsePatchActor.mockReturnValue({ mutateAsync: vi.fn() });
    render(<ActorVoiceCard githubLogin="alice" />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Calmer" } });
    expect(screen.getByRole("button", { name: /save voice/i })).not.toBeDisabled();
  });

  it("calls patch.mutateAsync with the trimmed value and shows Saved on success", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    mockUseFeedActors.mockReturnValue({
      data: [{ id: "actor_alice", github_login: "alice", tone: "", kind: "person" }],
      isLoading: false,
    });
    mockUsePatchActor.mockReturnValue({ mutateAsync });
    render(<ActorVoiceCard githubLogin="alice" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Warm  " } });
    fireEvent.click(screen.getByRole("button", { name: /save voice/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        id: "actor_alice",
        fields: { tone: "Warm" },
      }),
    );
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("passes null tone when the textarea is cleared", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    mockUseFeedActors.mockReturnValue({
      data: [{ id: "actor_alice", github_login: "alice", tone: "old", kind: "person" }],
      isLoading: false,
    });
    mockUsePatchActor.mockReturnValue({ mutateAsync });
    render(<ActorVoiceCard githubLogin="alice" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /save voice/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        id: "actor_alice",
        fields: { tone: null },
      }),
    );
  });

  it("shows the error message when mutateAsync rejects", async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error("boom"));
    mockUseFeedActors.mockReturnValue({
      data: [{ id: "actor_alice", github_login: "alice", tone: "", kind: "person" }],
      isLoading: false,
    });
    mockUsePatchActor.mockReturnValue({ mutateAsync });
    render(<ActorVoiceCard githubLogin="alice" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: /save voice/i }));
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });
});

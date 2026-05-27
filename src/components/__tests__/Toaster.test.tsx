import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Toaster } from "../Toaster";

function emit(message: string, status?: number) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("ut:error", { detail: { message, status } }),
    );
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Toaster", () => {
  it("renders nothing until a ut:error event fires", () => {
    const { container } = render(<Toaster />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the message and status badge on ut:error", () => {
    render(<Toaster />);
    emit("Boom", 403);
    expect(screen.getByRole("alert")).toHaveTextContent("Boom");
    expect(screen.getByText("403")).toBeInTheDocument();
  });

  it("omits the status badge when no status is given", () => {
    render(<Toaster />);
    emit("Just a message");
    expect(screen.getByText("Just a message")).toBeInTheDocument();
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("dismisses a toast when the dismiss button is clicked", () => {
    render(<Toaster />);
    emit("Boom", 500);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText("Boom")).not.toBeInTheDocument();
  });

  it("dedupes an identical message+status still on screen", () => {
    render(<Toaster />);
    emit("Same", 500);
    emit("Same", 500);
    expect(screen.getAllByText("Same")).toHaveLength(1);
  });

  it("stacks distinct toasts but caps the stack at 4", () => {
    render(<Toaster />);
    emit("one");
    emit("two");
    emit("three");
    emit("four");
    emit("five");
    expect(screen.getAllByRole("alert")).toHaveLength(4);
    // Oldest ("one") was dropped; newest is kept.
    expect(screen.queryByText("one")).not.toBeInTheDocument();
    expect(screen.getByText("five")).toBeInTheDocument();
  });

  it("auto-dismisses after the TTL", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    emit("Temporary", 500);
    expect(screen.getByText("Temporary")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.queryByText("Temporary")).not.toBeInTheDocument();
  });

  it("does not reset an existing toast's timer when a new one arrives", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    emit("first");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // A second toast 5s later must not extend the first toast's lifetime.
    emit("second");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    // 8s elapsed for "first" → gone; "second" (3s old) still on screen.
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });
});

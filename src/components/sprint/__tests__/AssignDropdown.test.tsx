import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssignDropdown } from "../AssignDropdown";

describe("AssignDropdown", () => {
  it("shows '+ Assign' when no owners", () => {
    render(<AssignDropdown owners={[]} allPeople={["alice"]} onChange={() => {}} />);
    expect(screen.getByText("+ Assign")).toBeInTheDocument();
  });

  it("shows owner names when populated", () => {
    render(<AssignDropdown owners={["alice", "bob"]} allPeople={["alice", "bob"]} onChange={() => {}} />);
    expect(screen.getByText("alice, bob")).toBeInTheDocument();
  });

  it("opens dropdown on click", async () => {
    render(<AssignDropdown owners={[]} allPeople={["alice", "bob"]} onChange={() => {}} />);
    await userEvent.click(screen.getByText("+ Assign"));
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
  });

  it("toggles person on checkbox click", async () => {
    const onChange = vi.fn();
    render(<AssignDropdown owners={[]} allPeople={["alice"]} onChange={onChange} />);

    await userEvent.click(screen.getByText("+ Assign"));
    await userEvent.click(screen.getByRole("checkbox"));

    expect(onChange).toHaveBeenCalledWith(["alice"]);
  });

  it("removes person when already selected", async () => {
    const onChange = vi.fn();
    render(<AssignDropdown owners={["alice"]} allPeople={["alice"]} onChange={onChange} />);

    await userEvent.click(screen.getByText("alice"));
    await userEvent.click(screen.getByRole("checkbox"));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("closes dropdown on outside click", async () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <AssignDropdown owners={[]} allPeople={["alice"]} onChange={() => {}} />
      </div>,
    );

    await userEvent.click(screen.getByText("+ Assign"));
    expect(screen.getByText("alice")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("outside"));
    // Dropdown should be closed — the "alice" label inside the dropdown should be gone
    // (the checkbox label, not the button text)
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows 'No people configured' when allPeople is empty", async () => {
    render(<AssignDropdown owners={[]} allPeople={[]} onChange={() => {}} />);
    await userEvent.click(screen.getByText("+ Assign"));
    expect(screen.getByText("No people configured")).toBeInTheDocument();
  });
});

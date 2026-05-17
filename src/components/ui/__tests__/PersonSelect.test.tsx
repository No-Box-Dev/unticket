import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonSelect } from "../PersonSelect";

const options = [
  { value: "alice", label: "Alice" },
  { value: "bob", label: "Bob" },
  { value: "carol", label: "Carol" },
];

describe("PersonSelect", () => {
  it("renders the placeholder when value is null", () => {
    render(<PersonSelect value={null} onChange={() => {}} options={options} placeholder="All people" />);
    expect(screen.getByText("All people")).toBeInTheDocument();
  });

  it("renders the selected single label", () => {
    render(<PersonSelect value="bob" onChange={() => {}} options={options} />);
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("opens the dropdown on click and lists every option", async () => {
    const user = userEvent.setup();
    render(<PersonSelect value={null} onChange={() => {}} options={options} />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
  });

  it("calls onChange with the option value in single mode", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PersonSelect value={null} onChange={onChange} options={options} />);
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByText("Alice"));
    expect(onChange).toHaveBeenCalledWith("alice");
  });

  it("clears selection (calls onChange with null) when re-clicking the same option in single mode", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PersonSelect value="alice" onChange={onChange} options={options} />);
    await user.click(screen.getByRole("button"));
    // "Alice" also appears in the trigger — pick the last one (in the open portal).
    const aliceNodes = screen.getAllByText("Alice");
    await user.click(aliceNodes[aliceNodes.length - 1]);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("multi mode renders '<n> selected' label and toggles values", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PersonSelect value={["alice", "bob"]} onChange={onChange} options={options} multi />);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByText("Carol"));
    expect(onChange).toHaveBeenCalledWith(["alice", "bob", "carol"]);
  });

  it("multi mode unselecting the last value calls onChange(null)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PersonSelect value={["alice"]} onChange={onChange} options={options} multi />);
    await user.click(screen.getByRole("button"));
    const aliceNodes = screen.getAllByText("Alice");
    await user.click(aliceNodes[aliceNodes.length - 1]);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

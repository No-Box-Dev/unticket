import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoleSection } from "../RoleSection";
import type { SubIssue } from "@/lib/github-features";
import type { PersonRole } from "@/lib/types";

const mockRole: PersonRole = {
  id: 100,
  number: 10,
  title: "Frontend Developer",
  assignee: "alice",
  state: "open",
  html_url: "https://github.com/org/gitpulse/issues/10",
};

const mockTasks: SubIssue[] = [
  {
    id: 200,
    number: 20,
    title: "Build login page",
    state: "open",
    assignees: ["alice"],
    html_url: "https://github.com/org/gitpulse/issues/20",
    points: 3,
    roleNumber: 10,
  },
  {
    id: 201,
    number: 21,
    title: "Add validation",
    state: "closed",
    assignees: [],
    html_url: "https://github.com/org/gitpulse/issues/21",
    points: 2,
    roleNumber: 10,
  },
];

const defaultProps = {
  role: mockRole,
  tasks: mockTasks,
  totalPoints: 5,
  donePoints: 2,
  onToggleTask: vi.fn(),
  onDeleteTask: vi.fn(),
  onUpdateTaskPoints: vi.fn(),
  onUpdateTaskTitle: vi.fn(),
  onAddTask: vi.fn(),
  onDeleteRole: vi.fn(),
  isAdding: false,
};

describe("RoleSection — TaskRow inline editing", () => {
  it("renders task title as text by default", () => {
    render(<RoleSection {...defaultProps} />);
    expect(screen.getByText("Build login page")).toBeInTheDocument();
    // Should not have an input for the title
    expect(screen.queryByDisplayValue("Build login page")).not.toBeInTheDocument();
  });

  it("click on title shows an input with the current title", async () => {
    const user = userEvent.setup();
    render(<RoleSection {...defaultProps} />);

    await user.click(screen.getByText("Build login page"));

    const input = screen.getByDisplayValue("Build login page");
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe("INPUT");
  });

  it("pressing Enter calls onUpdateTaskTitle with the new title", async () => {
    const onUpdateTaskTitle = vi.fn();
    const user = userEvent.setup();
    render(<RoleSection {...defaultProps} onUpdateTaskTitle={onUpdateTaskTitle} />);

    await user.click(screen.getByText("Build login page"));

    const input = screen.getByDisplayValue("Build login page");
    await user.clear(input);
    await user.type(input, "Build login page v2{Enter}");

    expect(onUpdateTaskTitle).toHaveBeenCalledWith(mockTasks[0], "Build login page v2");
  });

  it("pressing Escape reverts to display mode without calling update", async () => {
    const onUpdateTaskTitle = vi.fn();
    const user = userEvent.setup();
    render(<RoleSection {...defaultProps} onUpdateTaskTitle={onUpdateTaskTitle} />);

    await user.click(screen.getByText("Build login page"));

    const input = screen.getByDisplayValue("Build login page");
    await user.clear(input);
    await user.type(input, "Something else{Escape}");

    // Should revert to text display
    expect(screen.getByText("Build login page")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Something else")).not.toBeInTheDocument();
    expect(onUpdateTaskTitle).not.toHaveBeenCalled();
  });

  it("blur calls onUpdateTaskTitle", async () => {
    const onUpdateTaskTitle = vi.fn();
    const user = userEvent.setup();
    render(<RoleSection {...defaultProps} onUpdateTaskTitle={onUpdateTaskTitle} />);

    await user.click(screen.getByText("Build login page"));

    const input = screen.getByDisplayValue("Build login page");
    await user.clear(input);
    await user.type(input, "Blurred title");
    await user.tab(); // triggers blur

    expect(onUpdateTaskTitle).toHaveBeenCalledWith(mockTasks[0], "Blurred title");
  });

  it("blur with unchanged title does not call onUpdateTaskTitle", async () => {
    const onUpdateTaskTitle = vi.fn();
    const user = userEvent.setup();
    render(<RoleSection {...defaultProps} onUpdateTaskTitle={onUpdateTaskTitle} />);

    await user.click(screen.getByText("Build login page"));
    // Don't change the value, just blur
    await user.tab();

    expect(onUpdateTaskTitle).not.toHaveBeenCalled();
  });
});

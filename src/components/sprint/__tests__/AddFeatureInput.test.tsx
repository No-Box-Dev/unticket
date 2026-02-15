import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddFeatureInput } from "../AddFeatureInput";

describe("AddFeatureInput", () => {
  it("shows 'Add Feature' button initially", () => {
    render(<AddFeatureInput onAdd={() => {}} />);
    expect(screen.getByText("Add Feature")).toBeInTheDocument();
  });

  it("does not show input initially", () => {
    render(<AddFeatureInput onAdd={() => {}} />);
    expect(screen.queryByPlaceholderText("Feature title...")).not.toBeInTheDocument();
  });

  it("reveals input on button click", async () => {
    render(<AddFeatureInput onAdd={() => {}} />);
    await userEvent.click(screen.getByText("Add Feature"));
    expect(screen.getByPlaceholderText("Feature title...")).toBeInTheDocument();
  });

  it("submits on Enter and clears input", async () => {
    const onAdd = vi.fn();
    render(<AddFeatureInput onAdd={onAdd} />);

    await userEvent.click(screen.getByText("Add Feature"));
    const input = screen.getByPlaceholderText("Feature title...");
    await userEvent.type(input, "New feature{Enter}");

    expect(onAdd).toHaveBeenCalledWith("New feature");
    // Should hide the input after submit
    expect(screen.queryByPlaceholderText("Feature title...")).not.toBeInTheDocument();
  });

  it("submits on Add button click", async () => {
    const onAdd = vi.fn();
    render(<AddFeatureInput onAdd={onAdd} />);

    await userEvent.click(screen.getByText("Add Feature"));
    const input = screen.getByPlaceholderText("Feature title...");
    await userEvent.type(input, "Another feature");
    await userEvent.click(screen.getByText("Add"));

    expect(onAdd).toHaveBeenCalledWith("Another feature");
  });

  it("cancels on Escape", async () => {
    render(<AddFeatureInput onAdd={() => {}} />);
    await userEvent.click(screen.getByText("Add Feature"));

    const input = screen.getByPlaceholderText("Feature title...");
    await userEvent.type(input, "draft");
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByPlaceholderText("Feature title...")).not.toBeInTheDocument();
    expect(screen.getByText("Add Feature")).toBeInTheDocument();
  });

  it("does not submit empty input", async () => {
    const onAdd = vi.fn();
    render(<AddFeatureInput onAdd={onAdd} />);

    await userEvent.click(screen.getByText("Add Feature"));
    await userEvent.keyboard("{Enter}");

    expect(onAdd).not.toHaveBeenCalled();
  });

  it("does not submit whitespace-only input", async () => {
    const onAdd = vi.fn();
    render(<AddFeatureInput onAdd={onAdd} />);

    await userEvent.click(screen.getByText("Add Feature"));
    const input = screen.getByPlaceholderText("Feature title...");
    await userEvent.type(input, "   {Enter}");

    expect(onAdd).not.toHaveBeenCalled();
  });
});

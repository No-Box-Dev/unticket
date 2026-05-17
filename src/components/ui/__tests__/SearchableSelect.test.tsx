import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchableSelect } from "../SearchableSelect";

const options = [
  { value: "api", label: "api" },
  { value: "web", label: "web" },
  { value: "infra", label: "infra" },
];

describe("SearchableSelect", () => {
  it("shows the placeholder when no value selected", () => {
    render(<SearchableSelect value="" onChange={() => {}} options={options} placeholder="Pick a repo" />);
    expect(screen.getByText("Pick a repo")).toBeInTheDocument();
  });

  it("shows the selected option's label", () => {
    render(<SearchableSelect value="web" onChange={() => {}} options={options} />);
    expect(screen.getByText("web")).toBeInTheDocument();
  });

  it("opens the dropdown on trigger click and lists every option", async () => {
    const user = userEvent.setup();
    render(<SearchableSelect value="" onChange={() => {}} options={options} />);
    await user.click(screen.getByRole("button"));
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("filters options by the search input (case-insensitive)", async () => {
    const user = userEvent.setup();
    render(<SearchableSelect value="" onChange={() => {}} options={options} />);
    await user.click(screen.getByRole("button"));
    const search = screen.getByPlaceholderText("Search...");
    await user.type(search, "AP");
    const visible = screen.getAllByRole("option");
    expect(visible).toHaveLength(1);
    expect(visible[0].textContent).toBe("api");
  });

  it("calls onChange with the value when an option is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchableSelect value="" onChange={onChange} options={options} />);
    await user.click(screen.getByRole("button", { name: /select/i }));
    await user.click(screen.getByRole("option", { name: "infra" }));
    expect(onChange).toHaveBeenCalledWith("infra");
  });

  it("renders 'No matches' when the search excludes everything", async () => {
    const user = userEvent.setup();
    render(<SearchableSelect value="" onChange={() => {}} options={options} />);
    await user.click(screen.getByRole("button"));
    await user.type(screen.getByPlaceholderText("Search..."), "zzzzz");
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("closes on Escape from the search input", async () => {
    const user = userEvent.setup();
    render(<SearchableSelect value="" onChange={() => {}} options={options} />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByPlaceholderText("Search..."), { key: "Escape" });
    expect(screen.queryByPlaceholderText("Search...")).toBeNull();
  });

  it("selects the highlighted option on Enter after ArrowDown", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchableSelect value="" onChange={onChange} options={options} />);
    await user.click(screen.getByRole("button"));
    const search = screen.getByPlaceholderText("Search...");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("api");
  });
});

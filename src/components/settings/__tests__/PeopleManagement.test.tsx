import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PeopleManagement } from "../PeopleManagement";
import type { Person, OrgSettings } from "@/lib/types";

function makeMutation(): any {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    isIdle: true,
    status: "idle",
    reset: vi.fn(),
  };
}

const orgMembers = [
  { login: "alice", avatar_url: "https://x/a.png", kind: "human" as const },
  { login: "bot-1", avatar_url: "https://x/b.png", kind: "bot" as const },
  { login: "carol", avatar_url: "https://x/c.png", kind: "human" as const },
];

const people: Person[] = [
  { github: "alice", name: "Alice Liddell", role: "Eng" },
];

const settings: OrgSettings = { excludedMembers: ["carol"] };

describe("PeopleManagement", () => {
  it("shows the active/total header", () => {
    render(
      <PeopleManagement
        people={people}
        savePeople={makeMutation()}
        orgMembers={orgMembers}
        settings={settings}
        saveSettings={makeMutation()}
      />,
    );
    // 2 active out of 3
    expect(screen.getByText("People (2/3)")).toBeInTheDocument();
  });

  it("renders the Bot chip for bot-kind members", () => {
    render(
      <PeopleManagement
        people={people}
        savePeople={makeMutation()}
        orgMembers={orgMembers}
        settings={settings}
        saveSettings={makeMutation()}
      />,
    );
    expect(screen.getByText("Bot")).toBeInTheDocument();
  });

  it("toggling a member calls saveSettings.mutate with the next excludedMembers", () => {
    const saveSettings = makeMutation();
    render(
      <PeopleManagement
        people={people}
        savePeople={makeMutation()}
        orgMembers={orgMembers}
        settings={settings}
        saveSettings={saveSettings}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    // alice (active) → uncheck
    fireEvent.click(checkboxes[0]);
    expect(saveSettings.mutate).toHaveBeenCalledWith({
      excludedMembers: ["carol", "alice"],
    });
  });

  it("clicking edit then save calls savePeople.mutate with an updated person", () => {
    const savePeople = makeMutation();
    render(
      <PeopleManagement
        people={people}
        savePeople={savePeople}
        orgMembers={orgMembers}
        settings={settings}
        saveSettings={makeMutation()}
      />,
    );
    fireEvent.click(screen.getAllByRole("button").filter((b) => b.querySelector(".lucide-pencil"))[0]);
    fireEvent.change(screen.getByPlaceholderText("Role..."), { target: { value: "Lead" } });
    fireEvent.click(screen.getByTitle("Save"));
    expect(savePeople.mutate).toHaveBeenCalled();
    const next = savePeople.mutate.mock.calls[0][0] as Person[];
    const alice = next.find((p) => p.github === "alice");
    expect(alice?.role).toBe("Lead");
  });

  it("Escape cancels editing", () => {
    render(
      <PeopleManagement
        people={people}
        savePeople={makeMutation()}
        orgMembers={orgMembers}
        settings={settings}
        saveSettings={makeMutation()}
      />,
    );
    fireEvent.click(screen.getAllByRole("button").filter((b) => b.querySelector(".lucide-pencil"))[0]);
    const nameInput = screen.getByPlaceholderText("Display name...");
    fireEvent.keyDown(nameInput, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Display name...")).toBeNull();
  });

  it("renders 'No organisation members found' when orgMembers is empty", () => {
    render(
      <PeopleManagement
        people={[]}
        savePeople={makeMutation()}
        orgMembers={[]}
        settings={{ excludedMembers: [] }}
        saveSettings={makeMutation()}
      />,
    );
    expect(screen.getByText(/No organisation members found/)).toBeInTheDocument();
  });
});

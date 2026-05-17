import { describe, it, expect } from "vitest";
import { ACTOR_SYSTEM, buildActorMessage } from "../prompt.js";

describe("ACTOR_SYSTEM", () => {
  it("is a non-empty string", () => {
    expect(typeof ACTOR_SYSTEM).toBe("string");
    expect(ACTOR_SYSTEM.length).toBeGreaterThan(100);
  });

  it("forbids 'SKIP' output (load-bearing — narrator depends on it)", () => {
    expect(ACTOR_SYSTEM).toMatch(/never output ["']SKIP["']/i);
  });
});

describe("buildActorMessage", () => {
  const base = {
    actorName: "Jane",
    actorTone: "Dry but warm",
    projectName: "unticket",
    event: {
      type: "github:pr:merged",
      summary: "PR #1: do thing",
      created_at: "2026-05-17T10:11:12Z",
      payload: { pr: { number: 1, title: "do thing", additions: 5, deletions: 2, changed_files: 3 } },
    },
  };

  it("includes actor name and project", () => {
    const out = buildActorMessage(base);
    expect(out).toContain("You are Jane.");
    expect(out).toContain("Project: unticket");
  });

  it("includes the tone when present", () => {
    expect(buildActorMessage(base)).toContain("Tone: Dry but warm");
  });

  it("omits the Tone line when blank or missing", () => {
    expect(buildActorMessage({ ...base, actorTone: "" })).not.toMatch(/^Tone:/m);
    expect(buildActorMessage({ ...base, actorTone: "   " })).not.toMatch(/^Tone:/m);
    expect(buildActorMessage({ ...base, actorTone: undefined })).not.toMatch(/^Tone:/m);
  });

  it("formats PR merged event with title + diff stats", () => {
    const out = buildActorMessage(base);
    expect(out).toContain("PR merged");
    expect(out).toContain("#1");
    expect(out).toContain('"do thing"');
    expect(out).toContain("(+5 −2, 3 files)");
  });

  it("uses 'PR opened' / 'PR closed (no merge)' / 'PR reopened' verbs", () => {
    for (const [type, verb] of [
      ["github:pr:opened", "PR opened"],
      ["github:pr:closed", "PR closed (no merge)"],
      ["github:pr:reopened", "PR reopened"],
    ]) {
      const out = buildActorMessage({ ...base, event: { ...base.event, type } });
      expect(out).toContain(verb);
    }
  });

  it("extracts the first substantial body line for PR events (capped at 240 chars)", () => {
    const longLine = "This is a meaningful description line that should be picked up by the formatter";
    const out = buildActorMessage({
      ...base,
      event: {
        ...base.event,
        payload: { pr: { number: 1, title: "t", body: `## Header\n- short\n${longLine}` } },
      },
    });
    expect(out).toContain(longLine);
    expect(out).not.toContain("## Header"); // headers stripped
  });

  it("formats github:push events with branch + commit count + first commit subject", () => {
    const out = buildActorMessage({
      ...base,
      event: {
        ...base.event,
        type: "github:push",
        payload: {
          ref: "refs/heads/main",
          commits: [{ message: "fix: thing\nlonger description" }, { message: "second" }],
        },
      },
    });
    expect(out).toContain("push to main");
    expect(out).toContain("2 commits");
    expect(out).toContain('"fix: thing"');
    expect(out).not.toContain("longer description");
  });

  it("singularizes 'commit' when there's exactly one", () => {
    const out = buildActorMessage({
      ...base,
      event: {
        ...base.event,
        type: "github:push",
        payload: { ref: "refs/heads/main", commits: [{ message: "one" }] },
      },
    });
    expect(out).toContain("1 commit ");
  });

  it("formats release / issue / unknown events as type + summary", () => {
    for (const type of ["github:release:published", "github:issue:opened", "github:issue:closed", "custom:weird"]) {
      const out = buildActorMessage({
        ...base,
        event: { ...base.event, type, summary: "summary line" },
      });
      expect(out).toContain("summary line");
    }
  });
});

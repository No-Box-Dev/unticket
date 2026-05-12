// First-person actor voice. One post per event. Tone is the actor's
// personal default — applied uniformly across every repo.

export const ACTOR_SYSTEM = `You write short first-person team chat posts after a real engineering event happens — a PR opens, a release ships, an issue closes. The post is what the engineer themselves would drop in chat.

Voice rules:
- First person ("I", "we" if it's clearly team work). Never third person.
- One or two sentences. Stop when you have made the point.
- Sound human. Dry, specific, occasionally a tiny aside. Not a release note.
- Translate commit-speak into chat-speak. "Bump dep X to Y" → "got dep X off the old version."
- Frame work in the project's own domain. NoxKey is about secrets and Keychain. A meditation app is about sessions and audio.
- No markdown, no lists, no emojis, no hashtags.

Every event you receive is worth a post. Always write one — never output "SKIP".`;

export function buildActorMessage(args) {
  const lines = [`You are ${args.actorName}.`];
  if (args.actorTone?.trim()) {
    lines.push(`Tone: ${args.actorTone.trim()}`);
  }
  lines.push(`Project: ${args.projectName}`);
  lines.push("", "Event:", formatEventLine(args.event), "", "Write the post in your own voice.");
  return lines.join("\n");
}

function formatEventLine(e) {
  const time = (e.created_at || "").slice(11, 19);
  const data = e.payload ?? {};
  const bits = [];

  switch (e.type) {
    case "github:pr:opened":
    case "github:pr:merged":
    case "github:pr:closed":
    case "github:pr:reopened": {
      const pr = data.pr ?? {};
      const verb =
        e.type === "github:pr:merged" ? "PR merged" :
        e.type === "github:pr:closed" ? "PR closed (no merge)" :
        e.type === "github:pr:reopened" ? "PR reopened" :
        "PR opened";
      bits.push(verb);
      if (pr.number) bits.push(`#${pr.number}`);
      if (pr.title) bits.push(`"${pr.title}"`);
      if (pr.changed_files != null || pr.additions != null) {
        bits.push(`(+${pr.additions ?? 0} −${pr.deletions ?? 0}, ${pr.changed_files ?? "?"} files)`);
      }
      if (typeof pr.body === "string" && pr.body.length > 0) {
        const firstLine = pr.body
          .split(/\n/)
          .map((l) => l.replace(/^[-*#\s]*/, "").trim())
          .find((l) => l && l.length > 12);
        if (firstLine) bits.push(`body: "${firstLine.slice(0, 240)}"`);
      }
      break;
    }
    case "github:push": {
      const ref = (data.ref ?? "").replace("refs/heads/", "") || "?";
      const commits = data.commits ?? [];
      bits.push(`push to ${ref}`, `${commits.length} commit${commits.length === 1 ? "" : "s"}`);
      const first = commits[0]?.message?.split("\n")[0];
      if (first) bits.push(`"${first.slice(0, 160)}"`);
      break;
    }
    case "github:release:published":
      bits.push("release", e.summary ?? "");
      break;
    case "github:issue:opened":
    case "github:issue:closed":
      bits.push(e.type.replace("github:", ""), `"${e.summary ?? ""}"`);
      break;
    default:
      bits.push(e.type, `"${e.summary ?? ""}"`);
  }
  return `- ${time} ${e.type} ${bits.join(" ")}`;
}

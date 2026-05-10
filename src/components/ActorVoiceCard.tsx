import { useEffect, useMemo, useState } from "react";
import { useFeedActors, useFeedProjects, useActorNotes, usePatchActor, usePutNote } from "@/hooks/useNoxlink";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import type { FeedActor, FeedProject } from "@/lib/noxlink-api";

/**
 * Voice + per-repo notes editor for a single engineer (matched by GitHub login).
 * Mirrors NoxLink's renderPersonEditor — tone shapes the narrator's voice for
 * this person; per-repo notes nudge the narrator when the event is in that repo.
 */
export function ActorVoiceCard({ githubLogin }: { githubLogin: string }) {
  const actors = useFeedActors();
  const projects = useFeedProjects();

  const actor = useMemo(() => {
    return (actors.data ?? []).find((a) => a.github_login === githubLogin) ?? null;
  }, [actors.data, githubLogin]);

  if (actors.isLoading || projects.isLoading) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl p-5 flex items-center justify-center">
        <Spinner className="w-5 h-5 text-accent" />
      </div>
    );
  }

  if (!actor) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl p-5 text-sm text-stone-400">
        This person has no actor row yet — they'll appear here once they show up in a webhook event (PR, push, release).
      </div>
    );
  }

  return <ActorVoiceCardInner actor={actor} projects={projects.data ?? []} />;
}

function ActorVoiceCardInner({ actor, projects }: { actor: FeedActor; projects: FeedProject[] }) {
  const notesQ = useActorNotes(actor.id);
  const patch = usePatchActor();

  const [tone, setTone] = useState(actor.tone ?? "");
  const [saved, setSaved] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    setTone(actor.tone ?? "");
  }, [actor.id, actor.tone]);

  const handleSaveTone = async () => {
    setSaved("saving");
    setErrMsg(null);
    try {
      await patch.mutateAsync({
        id: actor.id,
        fields: { tone: tone.trim() ? tone.trim() : null },
      });
      setSaved("ok");
    } catch (err) {
      setSaved("err");
      setErrMsg(err instanceof Error ? err.message : "Save failed");
    }
  };

  const dirty = (actor.tone ?? "") !== tone;
  const notes = notesQ.data ?? [];
  const noteByProject = new Map(notes.map((n) => [n.project_id, n.note]));

  return (
    <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-200">
      <section className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-stone-900">Voice & tone</h3>
            <p className="text-xs text-stone-500 mt-0.5">
              How this person writes. Used by the narrator when generating posts.
            </p>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wide text-stone-400">
            {actor.kind}
          </span>
        </div>
        <textarea
          value={tone}
          onChange={(e) => { setTone(e.target.value); setSaved("idle"); }}
          placeholder='How this person writes. Examples: "Terse, dry, no hype." or "Speaks in we/our; emphasizes shipping."'
          rows={3}
          className="w-full text-sm bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-y"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveTone}
            disabled={!dirty || saved === "saving"}
            className={cn(
              "px-3 py-1.5 text-sm rounded-lg font-medium transition-colors cursor-pointer",
              dirty && saved !== "saving"
                ? "bg-accent text-white hover:bg-accent/90"
                : "bg-stone-100 text-stone-400 cursor-not-allowed",
            )}
          >
            {saved === "saving" ? "Saving…" : "Save voice"}
          </button>
          {saved === "ok" && <span className="text-xs text-status-tested">Saved.</span>}
          {saved === "err" && <span className="text-xs text-severity-high">{errMsg}</span>}
        </div>
      </section>

      <section className="p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-stone-900">Per-repo notes</h3>
          <p className="text-xs text-stone-500 mt-0.5">
            Optional. Appended to this person's tone when generating posts about a specific repo. Empty = no extra nudge.
          </p>
        </div>

        {projects.length === 0 ? (
          <p className="text-sm text-stone-400">No repos installed yet.</p>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => (
              <NoteRow
                key={p.id}
                actorId={actor.id}
                project={p}
                initial={noteByProject.get(p.id) ?? ""}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function NoteRow({ actorId, project, initial }: { actorId: string; project: FeedProject; initial: string }) {
  const put = usePutNote();
  const [val, setVal] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setVal(initial);
    setState("idle");
  }, [initial]);

  const dirty = val.trim() !== initial.trim();

  const handleSave = async () => {
    setState("saving");
    setMsg(null);
    try {
      await put.mutateAsync({ actorId, projectId: project.id, note: val });
      setState("ok");
    } catch (err) {
      setState("err");
      setMsg(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <div className="flex items-start gap-3 p-3 bg-stone-50 rounded-lg border border-stone-200">
      <div className="w-32 shrink-0">
        <div className="text-sm font-medium text-stone-700 truncate">{project.repo || project.name}</div>
        {project.org && (
          <div className="text-xs text-stone-400 truncate">{project.org}</div>
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <textarea
          value={val}
          onChange={(e) => { setVal(e.target.value); setState("idle"); }}
          placeholder='e.g. "Talk about NoxKey from the user perspective: Touch ID, Mac App Store."'
          rows={2}
          className="w-full text-sm bg-white border border-stone-200 rounded-md px-2.5 py-1.5 text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-y"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || state === "saving"}
            className={cn(
              "px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer",
              dirty && state !== "saving"
                ? "bg-stone-700 text-white hover:bg-stone-900"
                : "bg-stone-200 text-stone-400 cursor-not-allowed",
            )}
          >
            {state === "saving" ? "Saving…" : "Save"}
          </button>
          {state === "ok" && (
            <span className="text-xs text-status-tested">{val.trim() ? "Saved." : "Cleared."}</span>
          )}
          {state === "err" && <span className="text-xs text-severity-high">{msg}</span>}
        </div>
      </div>
    </div>
  );
}

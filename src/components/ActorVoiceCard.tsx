import { useMemo, useState } from "react";
import { useFeedActors, usePatchActor } from "@/hooks/useNoxlink";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import type { FeedActor } from "@/lib/noxlink-api";

/**
 * Voice editor for a single engineer (matched by GitHub login). Tone shapes
 * the narrator's voice for this person across every repo — there is no
 * per-repo override.
 */
export function ActorVoiceCard({ githubLogin }: { githubLogin: string }) {
  const actors = useFeedActors();

  const actor = useMemo(() => {
    return (actors.data ?? []).find((a) => a.github_login === githubLogin) ?? null;
  }, [actors.data, githubLogin]);

  if (actors.isLoading) {
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

  // Key on actor.id so React unmounts/remounts when the selected engineer
  // changes — that resets the local tone/saved state without a useEffect sync.
  return <ActorVoiceCardInner key={actor.id} actor={actor} />;
}

function ActorVoiceCardInner({ actor }: { actor: FeedActor }) {
  const patch = usePatchActor();

  const [tone, setTone] = useState(actor.tone ?? "");
  const [saved, setSaved] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

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

  return (
    <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-stone-900">Feed voice &amp; tone</h3>
          <p className="text-xs text-stone-500 mt-0.5">
            Shapes how this person sounds in the <span className="font-medium text-stone-600">Feed</span> — applied to every auto-generated post across every repo. Anyone in the org can edit it.
          </p>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wide text-stone-400">
          {actor.kind}
        </span>
      </div>
      <textarea
        value={tone}
        onChange={(e) => { setTone(e.target.value); setSaved("idle"); }}
        placeholder='How this person writes in Feed posts. Examples: "Terse, dry, no hype." or "Speaks in we/our; emphasizes shipping."'
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
    </div>
  );
}

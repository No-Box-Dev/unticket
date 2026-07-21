import { useEffect, useState } from "react";
import { X } from "lucide-react";
import Markdown from "react-markdown";
import { fetchAttachmentBlob } from "@/lib/specs-api";
import { Spinner } from "@/components/Spinner";
import type { SpecAttachment } from "@/lib/types";

interface Props {
  specId: number;
  attachment: SpecAttachment;
  onClose: () => void;
}

// In-app viewer for spec attachments. The outer wrapper owns the modal
// shell + backdrop; the inner ViewerContent is keyed by attachment.id so
// it unmounts + remounts when the user switches to a different file,
// which lets us keep the fetch/load state as plain useState + effect
// without needing an in-effect setState reset.
//
// Renderable kinds:
//   - PDF: <iframe src=blob-url>. Browser handles the PDF viewer.
//   - HTML: <iframe sandbox> with a blob URL. Sandbox strips scripts /
//     forms / same-origin access, so a hostile upload can't execute JS
//     or reach back into the app. Relative asset paths inside the HTML
//     won't resolve (blob origin is unique) — acceptable for single-file
//     spec docs.
//   - Markdown: fetched as text, rendered via react-markdown (same lib
//     the Spec description uses).
// DOCX / "other" isn't openable — those get download-only in the list.
export function SpecAttachmentViewer({ specId, attachment, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-xl w-full max-w-5xl mx-4 max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100">
          <h3
            className="text-sm font-semibold text-stone-800 truncate"
            title={attachment.filename}
          >
            {attachment.filename}
          </h3>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 cursor-pointer"
            aria-label="Close viewer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <ViewerContent key={attachment.id} specId={specId} attachment={attachment} />
      </div>
    </div>
  );
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; blobUrl: string | null; markdown: string | null };

function ViewerContent({ specId, attachment }: { specId: number; attachment: SpecAttachment }) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;

    (async () => {
      try {
        const blob = await fetchAttachmentBlob(specId, attachment.id);
        if (cancelled) return;
        if (attachment.kind === "markdown") {
          const text = await blob.text();
          if (!cancelled) setState({ phase: "ready", blobUrl: null, markdown: text });
        } else {
          const url = URL.createObjectURL(blob);
          currentUrl = url;
          if (!cancelled) setState({ phase: "ready", blobUrl: url, markdown: null });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            phase: "error",
            message: err instanceof Error ? err.message : "Failed to load attachment",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [specId, attachment.id, attachment.kind]);

  return (
    <div className="flex-1 min-h-0 flex">
      {state.phase === "loading" && (
        <div className="flex-1 flex items-center justify-center py-16">
          <Spinner className="w-6 h-6 text-accent" />
        </div>
      )}
      {state.phase === "error" && (
        <div className="flex-1 flex items-center justify-center py-16 text-sm text-red-500">
          {state.message}
        </div>
      )}
      {state.phase === "ready" && attachment.kind === "markdown" && state.markdown !== null && (
        <div className="flex-1 overflow-y-auto px-6 py-5 prose prose-sm prose-stone max-w-none">
          <Markdown>{state.markdown}</Markdown>
        </div>
      )}
      {state.phase === "ready" && attachment.kind === "pdf" && state.blobUrl && (
        <iframe
          title={attachment.filename}
          src={state.blobUrl}
          className="flex-1 w-full min-h-[60vh] border-0"
        />
      )}
      {state.phase === "ready" && attachment.kind === "html" && state.blobUrl && (
        <iframe
          title={attachment.filename}
          src={state.blobUrl}
          // `sandbox` with no allow-* tokens strips scripts, forms,
          // same-origin, popups — the HTML renders like a static
          // document with CSS + images (data: URIs) only.
          sandbox=""
          className="flex-1 w-full min-h-[60vh] border-0 bg-white"
        />
      )}
    </div>
  );
}

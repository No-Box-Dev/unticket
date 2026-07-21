import { useCallback, useMemo, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  Loader2,
  Plus,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  deleteAttachment,
  fetchAttachmentBlob,
  fetchAttachments,
  uploadAttachment,
} from "@/lib/specs-api";
import { broadcastError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { SpecAttachmentViewer } from "./SpecAttachmentViewer";
import type { SpecAttachment, SpecLink } from "@/lib/types";

// Combined "Sources" section for the Spec detail modal. Users can add
// either an external URL (link row) or upload a file (attachment row);
// both live under one header so the mental model is "how do I get to the
// content that describes this spec" rather than "is it hosted or attached."
//
// - Link rows: label + URL + open + trash. When there's 2+ valid links,
//   each row gets the primary-link star (matches SpecLinksSection).
// - Attachment rows: icon + filename + KIND + size + eye (if openable) +
//   download + trash. No star yet — the FeatureCard chip still opens the
//   primary LINK; attachments aren't primary candidates.

const ACCEPT = ".md,.pdf,.docx,.html";

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  specId: number;
  links: SpecLink[];
  onLinksChange: (links: SpecLink[]) => void;
}

export function SpecSourcesSection({ specId, links, onLinksChange }: Props) {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();

  // --- Link rows (mirror SpecLinksSection's editable buffer) ---

  const [linkRows, setLinkRows] = useState<SpecLink[]>(() =>
    links.length
      ? links.map((l) => ({ url: l.url, label: l.label ?? "", primary: l.primary }))
      : [],
  );

  const commitLinks = useCallback(
    (next: SpecLink[]) => {
      const validRows = next
        .map((r) => ({
          url: r.url.trim(),
          label: (r.label ?? "").trim(),
          primary: !!r.primary,
        }))
        .filter((r) => isHttpUrl(r.url));
      let sawPrimary = false;
      const cleaned = validRows.map((r) => {
        const isPrimary = r.primary && !sawPrimary;
        if (isPrimary) sawPrimary = true;
        const base: SpecLink = r.label ? { url: r.url, label: r.label } : { url: r.url };
        return isPrimary ? { ...base, primary: true } : base;
      });
      onLinksChange(cleaned);
    },
    [onLinksChange],
  );

  function updateLinkRow(i: number, patch: Partial<SpecLink>) {
    const next = linkRows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    setLinkRows(next);
    commitLinks(next);
  }

  function markPrimary(i: number) {
    const next = linkRows.map((r, idx) => ({ ...r, primary: idx === i }));
    setLinkRows(next);
    commitLinks(next);
  }

  function clearPrimary() {
    const next = linkRows.map((r) => ({ ...r, primary: false }));
    setLinkRows(next);
    commitLinks(next);
  }

  function addLinkRow() {
    setLinkRows([...linkRows, { url: "", label: "" }]);
  }

  function removeLinkRow(i: number) {
    const next = linkRows.filter((_, idx) => idx !== i);
    setLinkRows(next);
    commitLinks(next);
  }

  const validLinkCount = linkRows.filter((r) => isHttpUrl(r.url)).length;
  const showPrimaryStars = validLinkCount > 1;
  const primaryIdx = linkRows.findIndex((r) => r.primary && isHttpUrl(r.url));

  // --- Attachments (delegated to /api/specs/:id/attachments) ---

  const [viewer, setViewer] = useState<SpecAttachment | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listKey = useMemo(
    () => ["specAttachments", selectedOrg, specId] as const,
    [selectedOrg, specId],
  );

  const listQ = useQuery({
    queryKey: listKey,
    queryFn: async () => (await fetchAttachments(specId)).attachments,
    enabled: !!selectedOrg && specId > 0,
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadAttachment(specId, file),
    onSuccess: (created) => {
      qc.setQueryData<SpecAttachment[]>(listKey, (old) =>
        old ? [created, ...old] : [created],
      );
    },
    onError: (err) => {
      broadcastError(err instanceof Error ? err.message : "Upload failed");
    },
  });

  const deleteAttachMut = useMutation({
    mutationFn: (attachmentId: number) => deleteAttachment(specId, attachmentId),
    onSuccess: (_res, attachmentId) => {
      qc.setQueryData<SpecAttachment[]>(listKey, (old) =>
        old ? old.filter((a) => a.id !== attachmentId) : old,
      );
    },
  });

  const onPickFile = useCallback(() => inputRef.current?.click(), []);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      for (const file of Array.from(files)) {
        try {
          await uploadMut.mutateAsync(file);
        } catch {
          break;
        }
      }
      if (inputRef.current) inputRef.current.value = "";
    },
    [uploadMut],
  );

  const attachments = listQ.data ?? [];

  const hasAny = linkRows.length > 0 || attachments.length > 0;

  return (
    <div>
      <span className="text-xs text-stone-500 block mb-1.5">Sources</span>

      {!hasAny && (
        <p className="text-xs text-stone-400 italic mb-2">
          No links or files yet. Attach anything that describes this spec —
          a Figma URL, a design doc, a PDF, an HTML export.
        </p>
      )}

      <div className="space-y-2">
        {linkRows.map((row, i) => {
          const valid = isHttpUrl(row.url);
          const isPrimary =
            valid && (row.primary || (primaryIdx === -1 && i === 0));
          return (
            <div key={`link-${i}`} className="flex items-center gap-2">
              {showPrimaryStars && valid && (
                <button
                  type="button"
                  onClick={() => (row.primary ? clearPrimary() : markPrimary(i))}
                  className={cn(
                    "shrink-0 cursor-pointer",
                    isPrimary ? "text-amber-500" : "text-stone-300 hover:text-amber-400",
                  )}
                  title={row.primary ? "Primary link (click to unset)" : "Mark as primary"}
                  aria-pressed={!!row.primary}
                >
                  <Star size={14} fill={isPrimary ? "currentColor" : "none"} />
                </button>
              )}
              <LinkIcon size={12} className="shrink-0 text-stone-400" />
              <input
                value={row.label ?? ""}
                onChange={(e) => updateLinkRow(i, { label: e.target.value })}
                placeholder="Label (optional)"
                className="w-1/3 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-700 focus:outline-none focus:border-accent"
              />
              <input
                value={row.url}
                onChange={(e) => updateLinkRow(i, { url: e.target.value })}
                placeholder="https://…"
                className="flex-1 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-700 focus:outline-none focus:border-accent"
              />
              {valid && (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-stone-400 hover:text-accent"
                  title="Open"
                  aria-label="Open link"
                >
                  <ExternalLink size={14} />
                </a>
              )}
              <button
                type="button"
                onClick={() => removeLinkRow(i)}
                className="shrink-0 text-stone-300 hover:text-red-500 cursor-pointer"
                title="Remove"
                aria-label="Remove link"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}

        {attachments.map((a) => (
          <AttachmentRow
            key={`att-${a.id}`}
            attachment={a}
            specId={specId}
            onOpenInModal={() => setViewer(a)}
            onDelete={() => deleteAttachMut.mutate(a.id)}
            deleting={deleteAttachMut.isPending && deleteAttachMut.variables === a.id}
          />
        ))}
      </div>

      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={addLinkRow}
          className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-accent cursor-pointer"
        >
          <Plus size={12} /> Add link
        </button>
        <button
          type="button"
          onClick={onPickFile}
          disabled={uploadMut.isPending}
          className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-accent cursor-pointer disabled:opacity-60"
        >
          {uploadMut.isPending ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Uploading…
            </>
          ) : (
            <>
              <Upload size={12} /> Upload file
            </>
          )}
        </button>
        <span className="text-[11px] text-stone-400">
          .md · .pdf · .docx · .html · max 10&nbsp;MB
        </span>
      </div>

      {viewer && (
        <SpecAttachmentViewer
          specId={specId}
          attachment={viewer}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

interface RowProps {
  attachment: SpecAttachment;
  specId: number;
  onOpenInModal: () => void;
  onDelete: () => void;
  deleting: boolean;
}

function AttachmentRow({ attachment, specId, onOpenInModal, onDelete, deleting }: RowProps) {
  const [downloading, setDownloading] = useState(false);
  const [opening, setOpening] = useState(false);
  const openable = attachment.kind !== "docx" && attachment.kind !== "other";

  // HTML uploads open in a brand new browser tab (blob URL, rendered by
  // the browser as a real page). Everything else openable — Markdown, PDF
  // — uses the in-app modal viewer.
  async function openInNewTab() {
    // Open the tab synchronously so we're still inside the user gesture
    // window and popup blockers don't kill it. We swap the location to
    // the blob URL once it's ready.
    const w = window.open("about:blank", "_blank");
    setOpening(true);
    try {
      const blob = await fetchAttachmentBlob(specId, attachment.id);
      const url = URL.createObjectURL(blob);
      if (w) {
        w.location.href = url;
        // Give the tab time to actually load the resource before
        // dropping the blob URL. 60s is generous — Chromium keeps the
        // resource cached in the tab once loaded, so revocation just
        // frees the URL entry.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        // Popup blocked — fall back to opening in the current tab.
        window.location.href = url;
      }
    } catch (err) {
      if (w) w.close();
      broadcastError(err instanceof Error ? err.message : "Failed to open");
    } finally {
      setOpening(false);
    }
  }

  const handleOpen = () => {
    if (opening) return;
    if (attachment.kind === "html") openInNewTab();
    else onOpenInModal();
  };

  async function triggerDownload() {
    setDownloading(true);
    try {
      const blob = await fetchAttachmentBlob(specId, attachment.id, { download: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = attachment.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      broadcastError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1.5">
      <FileText size={12} className="shrink-0 text-stone-400" />
      {openable ? (
        <button
          type="button"
          onClick={handleOpen}
          disabled={opening}
          className="flex-1 min-w-0 truncate text-left text-xs text-stone-700 hover:text-accent hover:underline cursor-pointer disabled:opacity-60"
          title={attachment.filename}
          aria-label={`Open ${attachment.filename}${attachment.kind === "html" ? " in new tab" : ""}`}
        >
          {attachment.filename}
        </button>
      ) : (
        <span className="flex-1 truncate text-xs text-stone-700" title={attachment.filename}>
          {attachment.filename}
        </span>
      )}
      <span
        className="shrink-0 text-[10px] text-stone-400 tabular-nums"
        title={`${attachment.size} bytes`}
      >
        {attachment.kind.toUpperCase()} · {fmtSize(attachment.size)}
      </span>
      {attachment.kind === "html" && (
        <ExternalLink
          size={11}
          className="shrink-0 text-stone-400"
          aria-label="Opens in a new tab"
        />
      )}
      <button
        type="button"
        onClick={triggerDownload}
        disabled={downloading}
        className="shrink-0 text-stone-400 hover:text-accent cursor-pointer disabled:opacity-60"
        title="Download"
        aria-label={`Download ${attachment.filename}`}
      >
        {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        className="shrink-0 text-stone-300 hover:text-red-500 cursor-pointer disabled:opacity-60"
        title="Remove"
        aria-label={`Remove ${attachment.filename}`}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

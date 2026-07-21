import { useCallback, useRef, useState } from "react";
import { Download, Eye, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  deleteAttachment,
  fetchAttachmentBlob,
  fetchAttachments,
  uploadAttachment,
} from "@/lib/specs-api";
import { broadcastError } from "@/lib/api";
import { SpecAttachmentViewer } from "./SpecAttachmentViewer";
import type { SpecAttachment } from "@/lib/types";

interface Props {
  specId: number;
}

const ACCEPT = ".md,.pdf,.docx,.html";

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function SpecAttachmentsSection({ specId }: Props) {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [viewer, setViewer] = useState<SpecAttachment | null>(null);

  const listKey = ["specAttachments", selectedOrg, specId] as const;

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

  const deleteMut = useMutation({
    mutationFn: (attachmentId: number) => deleteAttachment(specId, attachmentId),
    onSuccess: (_res, attachmentId) => {
      qc.setQueryData<SpecAttachment[]>(listKey, (old) =>
        old ? old.filter((a) => a.id !== attachmentId) : old,
      );
    },
  });

  const onPick = useCallback(() => inputRef.current?.click(), []);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      // Serial upload — a user picking 5 files at once shouldn't fire 5
      // concurrent 10 MB streams. The optimistic prepend keeps the UI
      // responsive after each success.
      for (const file of Array.from(files)) {
        try {
          await uploadMut.mutateAsync(file);
        } catch {
          // Toast surfaced by onError; stop the batch so the user isn't
          // spammed by cascade failures for the same reason.
          break;
        }
      }
      if (inputRef.current) inputRef.current.value = "";
    },
    [uploadMut],
  );

  const attachments = listQ.data ?? [];

  return (
    <div>
      <span className="text-xs text-stone-500 block mb-1.5">Attachments</span>
      {attachments.length === 0 ? (
        <p className="text-xs text-stone-400 italic mb-2">
          No documents attached yet.
        </p>
      ) : (
        <ul className="space-y-1.5 mb-2">
          {attachments.map((a) => (
            <AttachmentRow
              key={a.id}
              attachment={a}
              specId={specId}
              onOpen={() => setViewer(a)}
              onDelete={() => deleteMut.mutate(a.id)}
              deleting={deleteMut.isPending && deleteMut.variables === a.id}
            />
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
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
          onClick={onPick}
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
  onOpen: () => void;
  onDelete: () => void;
  deleting: boolean;
}

function AttachmentRow({ attachment, specId, onOpen, onDelete, deleting }: RowProps) {
  const [downloading, setDownloading] = useState(false);
  const kindLabel = attachment.kind.toUpperCase();
  const openable = attachment.kind !== "docx" && attachment.kind !== "other";

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
      // Give the browser a beat to start the download before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      broadcastError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <li className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1.5">
      <FileText size={12} className="shrink-0 text-stone-400" />
      <span className="flex-1 truncate text-xs text-stone-700" title={attachment.filename}>
        {attachment.filename}
      </span>
      <span className="shrink-0 text-[10px] text-stone-400 tabular-nums" title={`${attachment.size} bytes`}>
        {kindLabel} · {fmtSize(attachment.size)}
      </span>
      {openable && (
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 text-stone-400 hover:text-accent cursor-pointer"
          title="Open"
          aria-label={`Open ${attachment.filename}`}
        >
          <Eye size={13} />
        </button>
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
    </li>
  );
}

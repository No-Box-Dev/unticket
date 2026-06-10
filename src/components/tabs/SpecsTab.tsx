import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import { ExternalLink, FileText, FileCode, Folder, Link as LinkIcon, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useSpecs, useSpec, useSpecFile } from "@/hooks/useSpecs";
import { useFeatures, useSettings, useSaveSettings } from "@/hooks/useConfigRepo";
import { specContentUrl } from "@/lib/specs-api";
import { Spinner } from "@/components/Spinner";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import type { OrgSettings } from "@/lib/types";

export function SpecsTab() {
  const specs = useSpecs();
  const [openSpec, setOpenSpec] = useState<string | null>(null);

  if (specs.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="w-6 h-6 text-accent" />
      </div>
    );
  }
  if (specs.isError) {
    return <div className="max-w-3xl mx-auto py-10 text-center text-stone-400">Failed to load specs.</div>;
  }

  const data = specs.data;
  if (!data?.configured) {
    return (
      <div className="max-w-2xl mx-auto py-10 text-center text-stone-500 space-y-3">
        <Folder className="w-10 h-10 mx-auto text-stone-300" />
        <h2 className="text-lg font-semibold text-stone-700">Specs not configured</h2>
        <p className="text-sm">
          An admin can point Specs at a GitHub repo + root folder under{" "}
          <span className="font-medium">Settings → Specs source</span>. Each
          top-level folder there will appear here as a spec.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-semibold text-stone-800">Specs</h1>
        <p className="text-xs text-stone-400 font-mono truncate">
          {data.repo}
          {data.rootPath ? `/${data.rootPath}` : ""}
        </p>
      </div>

      {data.specs.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl p-10 text-center text-stone-400">
          No spec folders found under{" "}
          <code className="font-mono text-stone-600">{data.repo}/{data.rootPath || "(repo root)"}</code>.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {data.specs.map((s) => (
            <SpecCard key={s.name} name={s.name} onOpen={() => setOpenSpec(s.name)} />
          ))}
        </div>
      )}

      {openSpec && <SpecDetailModal name={openSpec} onClose={() => setOpenSpec(null)} />}
    </div>
  );
}

function SpecCard({ name, onOpen }: { name: string; onOpen: () => void }) {
  const { data: settings } = useSettings();
  const linkedFeature = settings?.specLinks?.[name];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left bg-white border border-stone-200 rounded-xl px-5 py-4 hover:border-stone-300 hover:shadow-sm transition-all cursor-pointer space-y-1.5"
    >
      <div className="flex items-center gap-2">
        <Folder className="w-4 h-4 text-stone-400 shrink-0" />
        <span className="text-sm font-semibold text-stone-800 truncate">{name}</span>
      </div>
      {linkedFeature != null && (
        <div className="flex items-center gap-1 text-[11px] text-stone-500">
          <LinkIcon className="w-3 h-3" />
          Feature #{linkedFeature}
        </div>
      )}
    </button>
  );
}

function SpecDetailModal({ name, onClose }: { name: string; onClose: () => void }) {
  const spec = useSpec(name);
  const [openFile, setOpenFile] = useState<string | null>(null);

  return (
    <div
      className="fixed inset-0 z-40 bg-stone-900/40 flex items-stretch md:items-center justify-center p-0 md:p-6"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-4xl max-h-[100vh] md:max-h-[90vh] flex flex-col rounded-none md:rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 px-5 py-3 border-b border-stone-200 shrink-0">
          <Folder className="w-4 h-4 text-stone-400" />
          <h2 className="text-sm font-semibold text-stone-800 flex-1 truncate">{name}</h2>
          <FeatureLinkPicker specName={name} />
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-[200px,1fr]">
          <nav className="border-b md:border-b-0 md:border-r border-stone-200 overflow-y-auto bg-stone-50/60 max-h-[200px] md:max-h-full">
            {spec.isLoading ? (
              <div className="p-4"><Spinner size="sm" /></div>
            ) : spec.isError ? (
              <div className="p-4 text-xs text-red-500">Failed to load.</div>
            ) : (spec.data?.files ?? []).length === 0 ? (
              <div className="p-4 text-xs text-stone-400">No files in this spec.</div>
            ) : (
              <ul className="py-1">
                {spec.data!.files.map((f) => {
                  const isActive = f.relative === openFile;
                  const Icon = f.ext === "html" || f.ext === "htm" ? FileCode : FileText;
                  return (
                    <li key={f.relative}>
                      <button
                        type="button"
                        onClick={() => setOpenFile(f.relative)}
                        className={
                          "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 cursor-pointer " +
                          (isActive ? "bg-accent/10 text-accent" : "text-stone-600 hover:bg-stone-100")
                        }
                      >
                        <Icon className="w-3 h-3 shrink-0" />
                        <span className="truncate">{f.relative}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </nav>

          <section className="overflow-y-auto p-6 prose prose-stone prose-sm max-w-none">
            {openFile == null ? (
              <p className="text-stone-400 not-prose">Pick a file from the left.</p>
            ) : (
              <SpecFileView specName={name} relative={openFile} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function SpecFileView({ specName, relative }: { specName: string; relative: string }) {
  const { selectedOrg } = useAuth();
  const ext = useMemo(() => {
    const dot = relative.lastIndexOf(".");
    return dot > 0 ? relative.slice(dot + 1).toLowerCase() : "";
  }, [relative]);

  if (ext === "html" || ext === "htm") {
    const url = selectedOrg ? specContentUrl(selectedOrg, specName, relative) : "#";
    return (
      <div className="not-prose space-y-3">
        <p className="text-sm text-stone-600">
          HTML spec — opens in a new tab with all relative assets resolving under{" "}
          <code className="font-mono text-xs text-stone-700">/specs-content/</code>.
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90"
        >
          <ExternalLink className="w-4 h-4" />
          Open {relative}
        </a>
      </div>
    );
  }

  if (ext === "md" || ext === "markdown") {
    return <MarkdownPane specName={specName} relative={relative} />;
  }

  return (
    <p className="text-sm text-stone-500 not-prose">
      Preview not available for <code className="font-mono">.{ext}</code> files.
    </p>
  );
}

function MarkdownPane({ specName, relative }: { specName: string; relative: string }) {
  const { data, isLoading, isError } = useSpecFile(specName, relative);
  if (isLoading) return <div className="not-prose"><Spinner size="sm" /></div>;
  if (isError || !data) return <p className="not-prose text-sm text-red-500">Failed to load.</p>;
  return <Markdown>{data.content}</Markdown>;
}

function FeatureLinkPicker({ specName }: { specName: string }) {
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const { data: features } = useFeatures();

  const current = settings?.specLinks?.[specName];
  const options = useMemo(() => {
    const opts = (features ?? [])
      .map((f) => ({ value: String(f.id), label: `#${f.id} ${f.title}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: "", label: "No feature linked" }, ...opts];
  }, [features]);

  function handleChange(v: string) {
    if (!settings) return;
    const next: OrgSettings = { ...settings, specLinks: { ...(settings.specLinks ?? {}) } };
    if (!v) {
      delete next.specLinks![specName];
      if (Object.keys(next.specLinks!).length === 0) delete next.specLinks;
    } else {
      next.specLinks![specName] = Number(v);
    }
    saveSettings.mutate(next);
  }

  return (
    <SearchableSelect
      value={current != null ? String(current) : ""}
      onChange={handleChange}
      options={options}
      placeholder="Link feature…"
      className="min-w-[180px]"
    />
  );
}

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { fetchSpecs, fetchSpec, fetchSpecFileContent, fetchRepoFolders } from "@/lib/specs-api";

export function useSpecs() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["specs", selectedOrg],
    queryFn: fetchSpecs,
    enabled: !!selectedOrg,
    staleTime: 60_000,
  });
}

export function useSpec(name: string | null) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["specs", selectedOrg, name],
    queryFn: () => fetchSpec(name!),
    enabled: !!selectedOrg && !!name,
    staleTime: 30_000,
  });
}

// Lists every folder in a repo so the Settings → Specs source UI can render
// the Root folder field as a dropdown. Trimmed string only — passing `""`
// disables the query so we don't fire when there's no repo selected.
export function useRepoFolders(repo: string) {
  const { selectedOrg } = useAuth();
  const trimmed = repo.trim();
  return useQuery({
    queryKey: ["specs", selectedOrg, "repo-folders", trimmed],
    queryFn: () => fetchRepoFolders(trimmed),
    enabled: !!selectedOrg && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(trimmed),
    staleTime: 60_000,
  });
}

export function useSpecFile(name: string | null, path: string | null) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["specs", selectedOrg, name, "file", path],
    queryFn: () => fetchSpecFileContent(name!, path!),
    enabled: !!selectedOrg && !!name && !!path,
    staleTime: 30_000,
  });
}

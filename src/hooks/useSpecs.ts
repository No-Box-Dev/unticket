import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { fetchSpecs, fetchSpec, fetchSpecFileContent } from "@/lib/specs-api";

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

export function useSpecFile(name: string | null, path: string | null) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["specs", selectedOrg, name, "file", path],
    queryFn: () => fetchSpecFileContent(name!, path!),
    enabled: !!selectedOrg && !!name && !!path,
    staleTime: 30_000,
  });
}

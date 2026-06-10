import { apiGet } from "./api";

export interface RepoFolders {
  defaultBranch: string | null;
  folders: string[];
  truncated: boolean;
}

export function fetchRepoFolders(repo: string): Promise<RepoFolders> {
  return apiGet<RepoFolders>(`/api/specs/repo-folders?repo=${encodeURIComponent(repo)}`);
}

export interface SpecsList {
  configured: boolean;
  repo?: string;
  rootPath?: string;
  specs: { name: string }[];
}

export interface SpecFile {
  relative: string;
  size: number;
  ext: string;
}

export interface SpecFileTree {
  name: string;
  files: SpecFile[];
}

export interface SpecFileContent {
  content: string;
  contentType: string;
  name: string;
  size: number;
}

export function fetchSpecs(): Promise<SpecsList> {
  return apiGet<SpecsList>("/api/specs");
}

export function fetchSpec(name: string): Promise<SpecFileTree> {
  return apiGet<SpecFileTree>(`/api/specs/${encodeURIComponent(name)}`);
}

export function fetchSpecFileContent(name: string, path: string): Promise<SpecFileContent> {
  return apiGet<SpecFileContent>(
    `/api/specs/${encodeURIComponent(name)}?path=${encodeURIComponent(path)}`,
  );
}

// Build the proxy URL for opening an HTML file (or downloading a binary)
// in a new tab. The proxy auths via the ut_session cookie set by auth.tsx.
export function specContentUrl(orgLogin: string, specName: string, relative: string): string {
  return `/specs-content/${encodeURIComponent(orgLogin)}/${encodeURIComponent(specName)}/${relative
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

/** Module-level store for the config repo name. Set once per session from /api/org. */
const DEFAULT_NAME = ".gitpulse";
let _name = DEFAULT_NAME;

export function getConfigRepoName(): string {
  return _name;
}

export function setConfigRepoName(name: string) {
  _name = name || DEFAULT_NAME;
}

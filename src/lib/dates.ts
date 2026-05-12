export const STALE_ISSUE_DAYS = 30;
export const STALE_PR_DAYS = 7;

export function daysAgo(date: string): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

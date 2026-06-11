import { apiGet, apiPost } from "./api";

export interface SlackStatus {
  connected: boolean;
  teamId: string | null;
  teamName: string | null;
  botUserId: string | null;
  postsChannelId: string;
  releaseNotesChannelId: string;
  canConfigure: boolean;
  appConfigured: boolean;
}

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_archived: boolean;
  is_member: boolean;
}

export function fetchSlackStatus(): Promise<SlackStatus> {
  return apiGet<SlackStatus>("/api/slack/status");
}

export function fetchSlackChannels(): Promise<{ channels: SlackChannel[] }> {
  return apiGet<{ channels: SlackChannel[] }>("/api/slack/channels");
}

// Kicks off the OAuth dance — returns a Slack authorize URL the caller
// should redirect to via `window.location.href = url`. The server sets
// the CSRF cookie in the same response.
export function startSlackOAuth(): Promise<{ url: string }> {
  return apiPost<{ url: string }>("/api/slack/oauth/start", {});
}

export function disconnectSlack(): Promise<{ ok: true }> {
  return apiPost<{ ok: true }>("/api/slack/disconnect", {});
}

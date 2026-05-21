import { apiDelete, apiGet, apiPut } from "./api";

export type LlmProvider = "anthropic" | "openai-compatible";

export type LlmSettings =
  | { configured: false }
  | {
      configured: true;
      provider: LlmProvider;
      baseUrl: string;
      model: string;
      keyMask: string;
      updatedAt?: string;
    };

export type LlmSettingsInput = {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export async function fetchLlmSettings(): Promise<LlmSettings> {
  return apiGet<LlmSettings>("/api/llm-settings");
}

export async function saveLlmSettings(input: LlmSettingsInput): Promise<LlmSettings> {
  return apiPut<LlmSettings>("/api/llm-settings", input);
}

export async function clearLlmSettings(): Promise<LlmSettings> {
  return apiDelete<LlmSettings>("/api/llm-settings");
}

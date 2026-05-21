-- Per-org LLM provider override. When a row exists, narrator + feature-matcher
-- call the configured endpoint instead of the default Zhipu key in env.
-- Cleared row → fall back to env.ZHIPU_API_KEY automatically.
--
-- Two provider shapes:
--   'anthropic'           — Anthropic Messages API (x-api-key + anthropic-version
--                            header, /v1/messages, body.content[].text).
--                            Also handles Zhipu's Anthropic-compat endpoint.
--   'openai-compatible'   — OpenAI chat-completions shape (Authorization: Bearer,
--                            /v1/chat/completions, body.choices[0].message.content).
--                            Covers OpenAI, LiteLLM proxies, Ollama, vLLM, etc.
CREATE TABLE IF NOT EXISTS llm_settings (
  org_id INTEGER PRIMARY KEY REFERENCES orgs(id),
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

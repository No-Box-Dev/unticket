-- Plaintext prefix of the configured LLM API key (first few chars). Lets the
-- Settings UI render "current sk-ant…, leave blank to keep it" so an admin can
-- tell which key is stored without us decrypting on read. Pre-existing rows
-- keep NULL until the admin re-saves the key.
ALTER TABLE llm_settings ADD COLUMN key_prefix TEXT;

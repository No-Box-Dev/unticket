// Boundary validation for backend endpoints (zod).
//
// Use on any endpoint that takes external input (query params, request body).
// On failure returns a 400 Response the handler returns directly — the client's
// shared apiGet/apiPut helpers surface it through the `ut:error` toast bus.
//
//   const parsed = validate(BodySchema, await request.json());
//   if (!parsed.ok) return parsed.response;
//   parsed.data // typed
//
// Reference usage: functions/api/assign.ts.

import type { z } from "zod";
import { jsonResponse } from "./db";

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

export function validate<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const message = result.error.issues.map((i) => i.message).join("; ") || "Invalid request";
  return { ok: false, response: jsonResponse({ error: message }, 400) };
}

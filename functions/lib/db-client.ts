// Typed D1 query entry point (Drizzle).
//
// `getDb(env)` is the standard way new backend code reads/writes D1. Standard
// column queries get full type-checking from `schema`. Table-valued JSON
// aggregations (json_each over `*_json` columns) are expressed with Drizzle's
// raw `sql` template — see functions/api/engineer-stats.ts.

import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb(env: { DB: D1Database }) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;

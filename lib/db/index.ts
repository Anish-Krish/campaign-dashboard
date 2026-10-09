import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// One client per process. In dev, hot reload re-runs this module on every
// edit; without the globalThis cache each reload opened a fresh pool and the
// old ones' connections lingered on the Supabase pooler until queries hung.
const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };

const client =
  globalForDb.pgClient ??
  postgres(process.env.DATABASE_URL!, {
    prepare: false,
    // DATABASE_URL must be Supabase's SESSION pooler (port 5432). The
    // transaction pooler (6543) deadlocks postgres.js: two Drizzle selects
    // queued on one connection hang forever (backend stuck in ClientRead) —
    // reproduced deterministically, pipelining off or not. Session mode
    // allows only pool_size clients across ALL Vercel instances + scripts
    // (paused instances keep theirs), so each keeps at most 2 and drops them
    // after 5s idle — prod hit EMAXCONNSESSION at pool_size 15 with max 4.
    max: 2,
    idle_timeout: 5,
    connect_timeout: 15,
  });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema });

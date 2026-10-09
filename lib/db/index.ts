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
    // transaction pooler (6543) wedged under parallel queries — backends stuck
    // in ClientRead until the statement timeout (reproduced at 30 parallel
    // page queries). Session mode allows only pool_size (15) clients across
    // ALL Vercel instances + scripts, so each instance keeps at most 2 and
    // hands them back after 5s idle (prod hit EMAXCONNSESSION at max 4 / 20s).
    max: 2,
    idle_timeout: 5,
    connect_timeout: 15,
  });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema });

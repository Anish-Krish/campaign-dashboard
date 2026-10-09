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
    // page queries; session mode ran them all fine). Session mode holds a
    // server connection per client connection, so keep the pool small.
    max: 4,
    idle_timeout: 20, // seconds — hand idle connections back to the pooler
    connect_timeout: 15,
  });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema });

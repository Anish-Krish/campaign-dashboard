import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Supabase databases carry its own auth/storage/realtime schemas alongside
  // public, with CHECK constraints drizzle-kit's introspection chokes on
  // (TypeError pulling schema). Scope to public — the only schema this app owns.
  schemaFilter: ["public"],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

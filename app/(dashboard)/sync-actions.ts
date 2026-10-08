"use server";

import { requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { runSyncJob } from "@/lib/sync";

export async function triggerSyncNow() {
  await requireAdmin();
  await runSyncJob();
  revalidatePath("/");
  revalidatePath("/campaigns");
  revalidatePath("/settings");
}

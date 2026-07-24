"use server";

import { revalidatePath } from "next/cache";
import { runSyncJob } from "@/lib/sync";

export async function triggerSyncNow() {
  await runSyncJob();
  revalidatePath("/");
  revalidatePath("/campaigns");
  revalidatePath("/settings");
}

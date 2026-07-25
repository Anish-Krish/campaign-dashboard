"use server";

import { getContactsForMetric, type DrillDownMetric } from "@/lib/queries";

export async function fetchDrillDown(metric: DrillDownMetric, campaignId?: number) {
  return getContactsForMetric(metric, campaignId);
}

"use server";

import { getContactsForMetric, getDailyCallStats, type DrillDownMetric } from "@/lib/queries";

export async function fetchDrillDown(metric: DrillDownMetric, campaignId?: number) {
  const [data, dailyStats] = await Promise.all([
    getContactsForMetric(metric, campaignId),
    metric === "calls" || metric === "connects" ? getDailyCallStats(campaignId) : Promise.resolve(null),
  ]);
  return { ...data, dailyStats };
}

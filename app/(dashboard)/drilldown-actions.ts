"use server";

import { getContactsForMetric, getDailyCallStats, getDailyMeetingStats, type DrillDownMetric } from "@/lib/queries";

const CHART_METRICS: DrillDownMetric[] = ["calls", "connects", "meetings"];

export async function fetchDrillDown(metric: DrillDownMetric, campaignId?: number) {
  const showChart = CHART_METRICS.includes(metric);
  const [data, dailyCallStats, dailyMeetingStats] = await Promise.all([
    getContactsForMetric(metric, campaignId),
    showChart ? getDailyCallStats(campaignId) : Promise.resolve(null),
    showChart ? getDailyMeetingStats(campaignId) : Promise.resolve(null),
  ]);
  return { ...data, dailyCallStats, dailyMeetingStats };
}

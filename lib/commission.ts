import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// BDR commission (per the user): a flat rate per BANT meeting set in the
// month, and a higher rate for every meeting past the threshold (e.g. $25
// each for the first 10, $50 each from the 11th). Shown on the leaderboard
// for everyone unless the admin switches it off in Settings.

export type CommissionConfig = {
  visible: boolean; // everyone sees it (admins always do)
  base: number; // $ per meeting up to the threshold
  threshold: number; // meetings paid at the base rate
  high: number; // $ per meeting after the threshold
};

export const COMMISSION_DEFAULT: CommissionConfig = { visible: true, base: 25, threshold: 10, high: 50 };

export async function getCommissionConfig(): Promise<CommissionConfig> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "commission"));
  return { ...COMMISSION_DEFAULT, ...((row?.value as Partial<CommissionConfig> | null) ?? {}) };
}

export function commissionFor(meetings: number, c: CommissionConfig) {
  const atBase = Math.min(meetings, c.threshold);
  const atHigh = Math.max(0, meetings - c.threshold);
  return {
    total: atBase * c.base + atHigh * c.high,
    atHigh: atHigh > 0,
    // meetings until the higher rate kicks in (0 once there)
    toNextTier: Math.max(0, c.threshold - meetings),
  };
}

export const money = (n: number) => `$${n.toLocaleString("en-US")}`;

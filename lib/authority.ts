import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const AUTHORITY_KEYWORDS_KEY = "authority_keywords";

export const DEFAULT_AUTHORITY_KEYWORDS = [
  "vp",
  "vice president",
  "director",
  "head of",
  "chief",
  "president",
  "owner",
  "founder",
  "partner",
];

export async function getAuthorityKeywords(): Promise<string[]> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, AUTHORITY_KEYWORDS_KEY),
  });
  const value = row?.value;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value as string[];
  }
  return DEFAULT_AUTHORITY_KEYWORDS;
}

export async function setAuthorityKeywords(keywords: string[]): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: AUTHORITY_KEYWORDS_KEY, value: keywords })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: keywords },
    });
}

export function isAuthorityTitle(
  jobTitle: string | null | undefined,
  keywords: string[],
): boolean {
  if (!jobTitle) return false;
  const title = jobTitle.toLowerCase();
  return keywords.some((kw) => title.includes(kw.toLowerCase()));
}

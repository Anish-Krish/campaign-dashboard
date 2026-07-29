const COMPANY_SUFFIXES = [
  "incorporated", "inc", "llc", "l l c", "corporation", "corp", "co",
  "company", "ltd", "limited", "lp", "l p", "plc", "group", "holdings",
];

export function normalizeName(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .trim()
    .replace(/['".]/g, "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCompany(str: string | null | undefined): string {
  if (!str) return "";
  const normalized = str
    .toLowerCase()
    .trim()
    .replace(/['".,]/g, "")
    .replace(/[-_&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = normalized.split(" ");
  while (words.length > 1 && COMPANY_SUFFIXES.includes(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ").trim();
}

export function extractDomain(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  return email.split("@")[1].toLowerCase().trim();
}

export function normalizeDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  return domain
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

export function isNorthAmericanMobile(rawNumber: string | null | undefined): boolean {
  if (!rawNumber) return false;
  const digits = rawNumber.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return true;
  if (digits.length === 10) return true; // bare NANP local format, no country code prefix
  return false;
}

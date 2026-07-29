const ENDPOINT = "https://api.zerobounce.net/v2/validate";

export async function validateEmail(
  email: string,
): Promise<{ status: string; subStatus: string | null }> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) throw new Error("ZEROBOUNCE_API_KEY is not configured");

  const url = `${ENDPOINT}?email=${encodeURIComponent(email)}&api_key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();

  // ZeroBounce returns HTTP 200 even on failure (bad key, no credits, etc.),
  // signaling the error only via a top-level `error` field in the body.
  if (!res.ok || data.error || !data.status) {
    throw new Error(`ZeroBounce error: ${data.error || `unexpected response (HTTP ${res.status})`}`);
  }

  return { status: data.status, subStatus: data.sub_status ?? null };
}

// Escape hatch for when ZeroBounce credits run out: set SKIP_ZEROBOUNCE=true to
// bypass validation entirely rather than blocking the whole pipeline. Skipped
// rows are tagged "SKIPPED" (not "valid") so they're easy to re-validate later.
export async function validateEmailOrSkip(
  email: string,
): Promise<{ status: string; subStatus: string | null }> {
  if (process.env.SKIP_ZEROBOUNCE === "true") {
    return { status: "SKIPPED", subStatus: null };
  }
  return validateEmail(email);
}

export function isAcceptableStatus(status: string, { isGuess }: { isGuess: boolean }): boolean {
  if (status === "SKIPPED") return true;
  if (status === "valid" || status === "catch-all") return true;
  if (status === "unknown") return !isGuess;
  return false; // invalid, spamtrap, abuse, do_not_mail
}

const EMAIL_ENDPOINT = "https://api.leadmagic.io/v1/people/email-finder";
const MOBILE_ENDPOINT = "https://api.leadmagic.io/v1/people/mobile-finder";

function getApiKey(): string {
  const apiKey = process.env.LEADMAGIC_API_KEY;
  if (!apiKey) throw new Error("LEADMAGIC_API_KEY is not configured");
  return apiKey;
}

async function post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-API-Key": getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    const title = data?.errors?.[0]?.title || `Request failed: ${res.status}`;
    throw new Error(`LeadMagic error: ${title}`);
  }

  return data as T;
}

export async function findEmail({
  firstName,
  lastName,
  domain,
  companyName,
}: {
  firstName: string;
  lastName: string;
  domain?: string | null;
  companyName?: string | null;
}): Promise<{ email: string | null; status: string | null; creditsConsumed: number }> {
  const body: Record<string, unknown> = { first_name: firstName, last_name: lastName };
  if (domain) body.domain = domain;
  else if (companyName) body.company_name = companyName;

  const data = await post<{ email?: string; status?: string; credits_consumed?: number }>(
    EMAIL_ENDPOINT,
    body,
  );

  return {
    email: data.email || null,
    status: data.status || null,
    creditsConsumed: data.credits_consumed || 0,
  };
}

export async function findMobile({
  profileUrl,
  workEmail,
}: {
  profileUrl?: string | null;
  workEmail?: string | null;
}): Promise<{ mobileNumber: string | null; creditsConsumed: number }> {
  const body: Record<string, unknown> = {};
  if (profileUrl) body.profile_url = profileUrl;
  if (workEmail) body.work_email = workEmail;

  const data = await post<{ mobile_number?: string; credits_consumed?: number }>(
    MOBILE_ENDPOINT,
    body,
  );

  return {
    mobileNumber: data.mobile_number || null,
    creditsConsumed: data.credits_consumed || 0,
  };
}

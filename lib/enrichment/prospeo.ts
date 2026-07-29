const ENDPOINT = "https://api.prospeo.io/enrich-person";

function getApiKey(): string {
  const apiKey = process.env.PROSPEO_API_KEY;
  if (!apiKey) throw new Error("PROSPEO_API_KEY is not configured");
  return apiKey;
}

interface ProspeoResponse {
  error?: boolean;
  error_code?: string;
  person?: {
    email?: { email?: string; status?: string };
    mobile?: { mobile_international?: string; mobile_country_code?: string; status?: string };
  };
}

async function post(body: Record<string, unknown>): Promise<ProspeoResponse> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "X-KEY": getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return res.json();
}

export async function enrichPerson({
  firstName,
  lastName,
  companyName,
  companyWebsite,
}: {
  firstName: string;
  lastName: string;
  companyName?: string | null;
  companyWebsite?: string | null;
}): Promise<{ email: string | null; status: string | null }> {
  const data: Record<string, unknown> = { first_name: firstName, last_name: lastName };
  if (companyName) data.company_name = companyName;
  if (companyWebsite) data.company_website = companyWebsite;

  const body = await post({ data });

  if (body.error) {
    if (body.error_code === "NO_MATCH") return { email: null, status: null };
    throw new Error(`Prospeo error: ${body.error_code}`);
  }

  return {
    email: body.person?.email?.email || null,
    status: body.person?.email?.status || null,
  };
}

export async function findMobile({
  firstName,
  lastName,
  companyName,
  companyWebsite,
}: {
  firstName: string;
  lastName: string;
  companyName?: string | null;
  companyWebsite?: string | null;
}): Promise<{ mobile: string | null; countryCode: string | null; status: string | null }> {
  const data: Record<string, unknown> = { first_name: firstName, last_name: lastName };
  if (companyName) data.company_name = companyName;
  if (companyWebsite) data.company_website = companyWebsite;

  const body = await post({ enrich_mobile: true, data });

  if (body.error) {
    if (body.error_code === "NO_MATCH") return { mobile: null, countryCode: null, status: null };
    throw new Error(`Prospeo error: ${body.error_code}`);
  }

  return {
    mobile: body.person?.mobile?.mobile_international || null,
    countryCode: body.person?.mobile?.mobile_country_code || null,
    status: body.person?.mobile?.status || null,
  };
}

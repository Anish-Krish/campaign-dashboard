export const SESSION_COOKIE = "dashboard_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

// Uses btoa (not Buffer) so this also works if proxy.ts runs on the Edge runtime.
function toBase64Url(bytes: ArrayBuffer): string {
  const uint8 = new Uint8Array(bytes);
  let binary = "";
  for (const byte of uint8) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toBase64Url(sig);
}

export type SessionRole = "admin" | "bdr";
export type SessionClaims = { userId: number; role: SessionRole };

// Token = "<userId>-<role>-<expiresAt>.<hmac>". The role rides in the signed
// payload so proxy.ts can gate admin-only pages without a DB lookup; server
// actions still re-check the user in the DB (see lib/session.ts), so a
// deactivated user loses access to every write immediately.
export async function createSessionToken(claims: SessionClaims): Promise<string> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${claims.userId}-${claims.role}-${expiresAt}`;
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const [userId, role, expiresAt] = payload.split("-");
  if (!userId || (role !== "admin" && role !== "bdr") || Number(expiresAt) < Date.now()) return null;
  const expectedSig = await hmac(payload);
  if (sig !== expectedSig) return null;
  return { userId: Number(userId), role };
}

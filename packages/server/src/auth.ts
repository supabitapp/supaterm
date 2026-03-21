const AUTH_ENABLED = process.env.SUPATERM_NO_AUTH !== "1";

let serverToken: string | null = null;

export function initAuth(): string {
  serverToken = crypto.randomUUID();
  return serverToken;
}

export function validateToken(url: URL): boolean {
  if (!AUTH_ENABLED) return true;
  if (!serverToken) return true;
  const token = url.searchParams.get("token");
  return token === serverToken;
}

export function isAuthEnabled(): boolean {
  return AUTH_ENABLED;
}

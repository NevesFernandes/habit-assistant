// The MCP Worker is an OAuth server toward Claude and an OAuth client toward Google.
// /authorize shows our consent page (required per client by MCP's confused-deputy rules),
// then hands the user to Google; /callback finishes there and completes Claude's grant.
// Google's tokens live in the grant's props, which the library stores encrypted.
import { AuthorizationError, CimdFetchError, OAuthError, authorizationErrorRedirect } from "@cloudflare/workers-oauth-provider";
import type { ConsentDescription, OAuthHelpers, TokenExchangeCallbackOptions, TokenExchangeCallbackResult } from "@cloudflare/workers-oauth-provider";

export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Canonical origin, e.g. https://mcp.habitassistant.app (http://localhost:8788 in dev). */
  PUBLIC_ORIGIN: string;
}

/** What a grant carries; handlers read it as ctx.props. */
export interface Props {
  userId: string; // Google's stable `sub`
  email?: string;
  googleAccessToken: string;
  googleExpiresAt: number; // epoch ms
  googleRefreshToken: string;
}

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_SCOPES = ["openid", "email", DRIVE_FILE_SCOPE].join(" ");

/** Refresh Google's token this long before it expires, so a call can't land on a dead one. */
const REFRESH_MARGIN_MS = 5 * 60_000;

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

class GoogleTokenError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
  ) {
    super(`Google token request failed (HTTP ${status}${code ? `, ${code}` : ""}).`);
    this.name = "GoogleTokenError";
  }
}

async function googleToken(params: Record<string, string>): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new GoogleTokenError(res.status, body.error);
  }
  return res.json();
}

/** The id_token came straight from Google's token endpoint over TLS, so its claims are read without a signature check (OIDC Core 3.1.3.7). */
function idTokenClaims(idToken: string): { sub: string; email?: string } {
  const payload = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")));
}

export async function refreshGoogleToken(env: Env, props: Props): Promise<Props> {
  const token = await googleToken({
    grant_type: "refresh_token",
    refresh_token: props.googleRefreshToken,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
  });
  return {
    ...props,
    googleAccessToken: token.access_token,
    googleExpiresAt: Date.now() + token.expires_in * 1000,
    // Google normally keeps the same refresh token; take a new one if it sends one.
    googleRefreshToken: token.refresh_token ?? props.googleRefreshToken,
  };
}

export function googleTokenNeedsRefresh(props: Props, now = Date.now()): boolean {
  return now >= props.googleExpiresAt - REFRESH_MARGIN_MS;
}

/** Claude's access token lives no longer than the Google token inside it, so Claude's own refresh renews both. */
function accessTokenTTLFor(props: Props): number {
  const seconds = Math.floor((props.googleExpiresAt - REFRESH_MARGIN_MS - Date.now()) / 1000);
  return Math.min(3600, Math.max(60, seconds));
}

/** A grant unused this long expires and its tokens leave KV; each refresh pushes it out again. */
export const GRANT_IDLE_TTL = 90 * 24 * 60 * 60;

export async function tokenExchangeCallback(
  options: TokenExchangeCallbackOptions<Env>,
): Promise<TokenExchangeCallbackResult | void> {
  const props = options.props as Props;
  if (options.grantType === "authorization_code") {
    // The library's idle expiry starts only at the first refresh; this covers a grant never refreshed.
    return { accessTokenTTL: accessTokenTTLFor(props), refreshTokenTTL: GRANT_IDLE_TTL };
  }
  if (options.grantType !== "refresh_token") return;
  try {
    const next = await refreshGoogleToken(options.env, props);
    return { newProps: next, accessTokenTTL: accessTokenTTLFor(next) };
  } catch (error) {
    if (error instanceof GoogleTokenError && error.code === "invalid_grant") {
      // The user revoked access in their Google account: this grant can never work again.
      throw new OAuthError("invalid_grant", { description: "Google access was revoked; connect Habit Assistant again." });
    }
    throw new OAuthError("temporarily_unavailable", { description: "Google is unavailable; try again shortly.", statusCode: 503 });
  }
}

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f172a; color: #e2e8f0;
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 26rem; padding: 2rem 1.25rem; }
  h1 { font-size: 1.35rem; margin: 0 0 1rem; }
  p { margin: 0 0 1rem; color: #cbd5e1; }
  .warn { color: #fbbf24; }
  .row { display: flex; gap: .75rem; margin-top: 1.5rem; }
  button { flex: 1; padding: .8rem 1rem; border-radius: .6rem; border: 1px solid #334155; font: inherit; cursor: pointer; }
  .allow { background: #2563eb; border-color: #2563eb; color: white; }
  .deny { background: transparent; color: #e2e8f0; }
</style></head><body><main>${body}</main></body></html>`;
}

function html(body: string, init: { status?: number; headers?: Headers } = {}): Response {
  const headers = init.headers ?? new Headers();
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { status: init.status ?? 200, headers });
}

function consentPage(details: ConsentDescription, handle: string): string {
  const name = escape(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
    : "This app registered itself, so its name isn't verified.";
  return page(
    "Connect Habit Assistant",
    `<h1>Let ${name} use Habit Assistant?</h1>
<p>${name} will be able to see and change your habits and tasks. ${origin}</p>
<p>Access goes to <strong>${escape(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? '<p class="warn"><strong>This sends access to an app on this computer.</strong> Continue only if you just started connecting from it.</p>' : ""}
<p>Next, Google asks you to let Habit Assistant use the files it created in your Drive. Keep that box ticked.</p>
<form method="post"><input type="hidden" name="handle" value="${escape(handle)}">
<div class="row"><button class="deny" name="decision" value="deny">Cancel</button><button class="allow" name="decision" value="approve">Continue</button></div>
</form>`,
  );
}

function errorPage(message: string, status = 400): Response {
  return html(page("Habit Assistant", `<h1>Couldn't connect</h1><p>${escape(message)}</p>`), { status });
}

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function s256(verifier: string): Promise<string> {
  return base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

const callbackUrl = (env: Env) => `${env.PUBLIC_ORIGIN}/callback`;

async function showConsent(req: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const request = await oauth.parseAuthRequest(req);
  const details = await oauth.describeConsent(request);
  const consent = await oauth.beginConsent(request);
  return html(consentPage(details, consent.handle), { headers: consent.headers });
}

async function answerConsent(req: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const form = await req.formData();
  const handle = String(form.get("handle"));
  if (form.get("decision") !== "approve") {
    const denied = await oauth.denyConsent(req, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const approved = await oauth.approveConsent(req, handle);
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const { state, headers } = await oauth.beginUpstream(approved.request, { data: { verifier }, headers: approved.headers });
  const google = new URL(GOOGLE_AUTHORIZE_URL);
  google.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(env),
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline", // a refresh token, so the connector keeps working past the hour
    prompt: "consent", // Google only sends a refresh token on a fresh consent
    state,
    code_challenge: await s256(verifier),
    code_challenge_method: "S256",
  }).toString();
  headers.set("Location", google.toString());
  return new Response(null, { status: 302, headers });
}

async function finishGoogle(req: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const params = new URL(req.url).searchParams;
  const { request: original, data, headers } = await oauth.finishUpstream<{ verifier: string }>(req);
  if (params.get("error") || !params.get("code")) {
    headers.set("Location", authorizationErrorRedirect(original, "access_denied"));
    return new Response(null, { status: 302, headers });
  }

  const token = await googleToken({
    grant_type: "authorization_code",
    code: params.get("code")!,
    code_verifier: data.verifier,
    redirect_uri: callbackUrl(env),
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
  });
  // Google's consent screen lets people untick Drive; without it there is nothing to read.
  if (!token.scope?.split(" ").includes(DRIVE_FILE_SCOPE)) {
    return errorPage("Habit Assistant needs access to its files in your Google Drive. Connect again and keep the Drive box ticked.");
  }
  if (!token.refresh_token || !token.id_token) {
    return errorPage("Google didn't complete the sign-in. Please connect again.", 502);
  }

  const claims = idTokenClaims(token.id_token);
  const props: Props = {
    userId: claims.sub,
    email: claims.email,
    googleAccessToken: token.access_token,
    googleExpiresAt: Date.now() + token.expires_in * 1000,
    googleRefreshToken: token.refresh_token,
  };
  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    userId: claims.sub,
    metadata: { email: claims.email },
    scope: original.scope,
    props,
  });
  headers.set("Location", redirectTo);
  return new Response(null, { status: 302, headers });
}

/** Everything outside /mcp and the library's own endpoints. */
export async function handleDefault(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);
  try {
    if (pathname === "/authorize" && req.method === "GET") return await showConsent(req, env);
    if (pathname === "/authorize" && req.method === "POST") return await answerConsent(req, env);
    if (pathname === "/callback" && req.method === "GET") return await finishGoogle(req, env);
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError) return errorPage(error.description ?? "This sign-in link expired. Start again from Claude.");
    if (error instanceof CimdFetchError) return errorPage("This app could not be verified.");
    if (error instanceof GoogleTokenError) return errorPage("Google didn't accept the sign-in. Please connect again.", 502);
    throw error;
  }
  if (pathname === "/" && req.method === "GET") {
    return new Response(
      `Habit Assistant MCP server.\nAdd ${env.PUBLIC_ORIGIN}/mcp as a custom connector in Claude (Settings, Connectors).\n`,
      { headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
  return new Response("Not found", { status: 404 });
}

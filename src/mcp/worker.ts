// Entry point of the MCP Worker (wrangler.mcp.jsonc), separate from the PWA's Worker.
// OAuthProvider guards /mcp and serves discovery, registration and the token endpoint;
// googleAuth.ts owns /authorize and /callback; server.ts owns the tools.
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { readDataFile } from "./drive.ts";
import { handleDefault, refreshGoogleToken, googleTokenNeedsRefresh, tokenExchangeCallback, type Env, type Props } from "./googleAuth.ts";
import { handleMcpRequest } from "./server.ts";

const SCOPES = ["habits"];

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let props = (ctx as ExecutionContext & { props: Props }).props;
  // Claude's token normally expires before Google's (tokenExchangeCallback), so this only
  // catches clock skew; the refreshed token isn't stored, Claude's next refresh does that.
  if (googleTokenNeedsRefresh(props)) {
    try {
      props = await refreshGoogleToken(env, props);
    } catch {
      return new Response("Google access expired", { status: 401, headers: { "WWW-Authenticate": 'Bearer error="invalid_token"' } });
    }
  }
  const accessToken = props.googleAccessToken;
  return handleMcpRequest(request, {
    loadData: async () => (await readDataFile((input, init) => fetch(input, init), accessToken)).data,
    // Status and timing only: never item data.
    log: (event) => console.log(JSON.stringify(event)),
  });
}

let provider: OAuthProvider<Env> | undefined;

// Built on first request because the resource URL comes from env (localhost in dev).
function providerFor(env: Env): OAuthProvider<Env> {
  provider ??= new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: { fetch: handleApi as ExportedHandlerFetchHandler<Env> },
    defaultHandler: { fetch: handleDefault as ExportedHandlerFetchHandler<Env> },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: SCOPES,
    requiredScopes: SCOPES,
    resourceMetadata: {
      resource: `${env.PUBLIC_ORIGIN}/mcp`,
      authorization_servers: [env.PUBLIC_ORIGIN],
      resource_name: "Habit Assistant",
    },
    // A grant lives while it's used: each refresh pushes its expiry 90 days out.
    refreshTokenIdleTTL: 90 * 24 * 60 * 60,
    tokenExchangeCallback,
  });
  return provider;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return providerFor(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

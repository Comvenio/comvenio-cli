import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

import { OAUTH_SCOPE_VALUES, type OAuthScope } from "@comvenio/connector-contracts";

import type { OAuthCredentials } from "./credential-store.ts";

export type OAuthRuntime = {
  gatewayBaseUrl: string;
  connectorBaseUrl: string;
  issuer: string;
  clientId: string;
  resource: string;
  scopes: OAuthScope[];
};

type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_SCOPES = ["club.read", "role.read.self"] as const satisfies readonly OAuthScope[];

function canonicalHttpsOrigin(value: string, field: string): string {
  const url = new URL(value.replace(/\/+$/, ""));
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search
    || url.hash
  ) {
    throw new Error(`${field} muss ein öffentlicher HTTPS-Origin sein.`);
  }
  return url.origin;
}

function defaultConnectorOrigin(gatewayOrigin: string): string {
  const gateway = new URL(gatewayOrigin);
  const hostname = gateway.hostname === "api.comvenio.app"
    ? "mcp.comvenio.app"
    : gateway.hostname === "apidev.comvenio.app"
      ? "mcpdev.comvenio.app"
      : null;
  if (!hostname) {
    throw new Error(
      "Für ein eigenes API-Gateway muss --connector mit dem MCP-Origin angegeben werden.",
    );
  }
  return `${gateway.protocol}//${hostname}`;
}

export function oauthRuntime(
  gatewayBaseUrl: string,
  connectorBaseUrl?: string,
  scopes: readonly OAuthScope[] = DEFAULT_SCOPES,
): OAuthRuntime {
  const gatewayOrigin = canonicalHttpsOrigin(gatewayBaseUrl, "OAuth-Gateway");
  const connectorOrigin = canonicalHttpsOrigin(
    connectorBaseUrl ?? defaultConnectorOrigin(gatewayOrigin),
    "OAuth-Connector",
  );
  if (
    scopes.length === 0
    || new Set(scopes).size !== scopes.length
    || scopes.some((scope) =>
      !(OAUTH_SCOPE_VALUES as readonly string[]).includes(scope))
  ) {
    throw new Error("Die angeforderten OAuth-Scopes sind ungültig.");
  }
  const issuer = `${gatewayOrigin}/auth`;
  return {
    gatewayBaseUrl: gatewayOrigin,
    connectorBaseUrl: connectorOrigin,
    issuer,
    clientId: `${issuer}/oauth/clients/comvenio-cli`,
    resource: `${connectorOrigin}/cli`,
    scopes: [...scopes],
  };
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function openSystemBrowser(url: string): void {
  const child = process.platform === "win32"
    ? spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      })
    : process.platform === "darwin"
      ? spawn("open", [url], { detached: true, stdio: "ignore" })
      : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  child.unref();
}

async function formPost(
  url: string,
  body: URLSearchParams,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body,
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new Error(`OAuth-Anfrage fehlgeschlagen: ${code}`);
  }
  return payload;
}

function tokenResponse(
  payload: Record<string, unknown>,
  expectedScopes: readonly OAuthScope[],
): TokenResponse {
  if (
    typeof payload.access_token !== "string"
    || !payload.access_token
    || typeof payload.refresh_token !== "string"
    || !payload.refresh_token
    || payload.token_type !== "Bearer"
    || typeof payload.expires_in !== "number"
    || !Number.isInteger(payload.expires_in)
    || payload.expires_in < 60
    || payload.expires_in > 86_400
    || typeof payload.scope !== "string"
  ) {
    throw new Error("Die OAuth-Tokenantwort ist ungültig.");
  }
  const actualScopes = payload.scope.split(" ").filter(Boolean);
  if (
    actualScopes.length !== expectedScopes.length
    || new Set(actualScopes).size !== actualScopes.length
    || actualScopes.some((scope) =>
      !(OAUTH_SCOPE_VALUES as readonly string[]).includes(scope))
    || [...actualScopes].sort().join(" ") !== [...expectedScopes].sort().join(" ")
  ) {
    throw new Error("Die OAuth-Tokenantwort enthält abweichende Scopes.");
  }
  return payload as unknown as TokenResponse;
}

async function waitForAuthorizationCode(
  expectedState: string,
): Promise<{
  redirectUri: string;
  result: Promise<string>;
  close: () => Promise<void>;
}> {
  let settled = false;
  let resolveCallback!: (code: string) => void;
  let rejectCallback!: (reason: Error) => void;
  const callback = new Promise<string>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET" || url.pathname !== "/oauth/callback") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Nicht gefunden.");
      return;
    }
    if (settled) {
      response.writeHead(409, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Dieser OAuth-Callback wurde bereits verarbeitet.");
      return;
    }
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (state !== expectedState) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Der OAuth-State stimmt nicht überein.");
      return;
    }
    if (error || !code) {
      settled = true;
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Die Comvenio-Verbindung konnte nicht bestätigt werden. Du kannst dieses Fenster schließen.");
      rejectCallback(new Error(error ? `OAuth wurde abgelehnt: ${error}` : "OAuth-State oder Code ist ungültig."));
      return;
    }
    settled = true;
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    });
    response.end("<!doctype html><meta charset=\"utf-8\"><title>Comvenio verbunden</title><p>Comvenio CLI wurde verbunden. Du kannst dieses Fenster schließen.</p>");
    resolveCallback(code);
  });
  server.on("error", (error) => {
    if (!settled) {
      settled = true;
      rejectCallback(error);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  if (!port) {
    server.close();
    throw new Error("Der lokale OAuth-Callback konnte nicht gestartet werden.");
  }
  const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
  const timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      server.close();
      rejectCallback(new Error("OAuth-Anmeldung nach fünf Minuten abgebrochen."));
    }
  }, CALLBACK_TIMEOUT_MS);
  timeout.unref();
  return {
    redirectUri,
    result: callback.finally(() => clearTimeout(timeout)),
    close: () => {
      if (!server.listening) return Promise.resolve();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function loginWithOAuth(
  runtime: OAuthRuntime,
  openBrowser: (url: string) => void = openSystemBrowser,
): Promise<OAuthCredentials> {
  const verifier = base64Url(randomBytes(64));
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const state = base64Url(randomBytes(32));
  const callback = await waitForAuthorizationCode(state);
  const authorizationUrl = new URL(`${runtime.issuer}/oauth/authorize`);
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: runtime.clientId,
    redirect_uri: callback.redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: runtime.scopes.join(" "),
    resource: runtime.resource,
    ui_locales: "de-DE",
  }).toString();
  openBrowser(authorizationUrl.toString());
  try {
    const code = await callback.result;
    const token = tokenResponse(await formPost(
      `${runtime.issuer}/oauth/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: runtime.clientId,
        redirect_uri: callback.redirectUri,
        code_verifier: verifier,
        resource: runtime.resource,
      }),
    ), runtime.scopes);
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accessExpiresAt: Date.now() + token.expires_in * 1_000,
    };
  } finally {
    await callback.close();
  }
}

export async function refreshOAuthCredentials(
  runtime: OAuthRuntime,
  credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
  const token = tokenResponse(await formPost(
    `${runtime.issuer}/oauth/token`,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      client_id: runtime.clientId,
      resource: runtime.resource,
    }),
  ), runtime.scopes);
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    accessExpiresAt: Date.now() + token.expires_in * 1_000,
  };
}

export async function revokeOAuthCredentials(
  runtime: OAuthRuntime,
  credentials: OAuthCredentials,
): Promise<void> {
  await formPost(
    `${runtime.issuer}/oauth/revoke`,
    new URLSearchParams({
      token: credentials.refreshToken,
      token_type_hint: "refresh_token",
      client_id: runtime.clientId,
    }),
  );
}

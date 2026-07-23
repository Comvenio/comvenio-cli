import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

import { OAUTH_SCOPE_VALUES, type OAuthScope } from "@comvenio/connector-contracts";

import type { OAuthCredentials } from "./credential-store.ts";

export type OAuthRuntime = {
  gatewayBaseUrl: string;
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

type ActorTokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
};

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1_000;

export function oauthRuntime(gatewayBaseUrl: string): OAuthRuntime {
  const gateway = new URL(gatewayBaseUrl.replace(/\/+$/, ""));
  if (gateway.protocol !== "https:" && gateway.hostname !== "localhost") {
    throw new Error("OAuth benötigt ein HTTPS-Gateway oder eine explizite lokale Umgebung.");
  }
  const issuer = `${gateway.origin}/auth`;
  return {
    gatewayBaseUrl: gateway.origin,
    issuer,
    clientId: `${issuer}/oauth/clients/comvenio-cli`,
    resource: `${gateway.origin}/cli`,
    scopes: [...OAUTH_SCOPE_VALUES],
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

async function formPost<T>(url: string, body: URLSearchParams, headers: Record<string, string> = {}): Promise<T> {
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
  return payload as T;
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
    const host = request.headers.host ?? "";
    const url = new URL(request.url ?? "/", `http://${host}`);
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
    if (state !== expectedState || error || !code) {
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
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
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
    const token = await formPost<TokenResponse>(
      `${runtime.issuer}/oauth/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: runtime.clientId,
        redirect_uri: callback.redirectUri,
        code_verifier: verifier,
        resource: runtime.resource,
      }),
    );
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
  const token = await formPost<TokenResponse>(
    `${runtime.issuer}/oauth/token`,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      client_id: runtime.clientId,
      resource: runtime.resource,
    }),
  );
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    accessExpiresAt: Date.now() + token.expires_in * 1_000,
  };
}

export async function exchangeCliActorToken(
  runtime: OAuthRuntime,
  credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
  const actor = await formPost<ActorTokenResponse>(
    `${runtime.issuer}/oauth/actor-token`,
    new URLSearchParams({
      token: credentials.accessToken,
      token_type_hint: "access_token",
      resource: runtime.resource,
      client_id: runtime.clientId,
    }),
    { "x-request-id": randomUUID() },
  );
  return {
    ...credentials,
    actorToken: actor.access_token,
    actorExpiresAt: Date.now() + actor.expires_in * 1_000,
  };
}

export async function revokeOAuthCredentials(
  runtime: OAuthRuntime,
  credentials: OAuthCredentials,
): Promise<void> {
  await formPost<Record<string, never>>(
    `${runtime.issuer}/oauth/revoke`,
    new URLSearchParams({
      token: credentials.refreshToken,
      token_type_hint: "refresh_token",
      client_id: runtime.clientId,
    }),
  );
}

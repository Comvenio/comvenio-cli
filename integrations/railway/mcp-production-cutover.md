# MCP-Produktions-Cutover auf `mcp.comvenio.app`

Dieses Runbook beschreibt den koordinierten Cutover des bestehenden Comvenio-AI-Connector-Features. Geheimwerte werden nie in Git, Logs oder Tickets geschrieben.

## Zielbild

```text
ChatGPT / Claude
  -> https://mcp.comvenio.app
  -> Cloudflare Worker comvenio-api-gateway
  -> https://comvenio-cli-production.up.railway.app
```

Der OAuth-Authorization-Server bleibt `https://api.comvenio.app/auth`. Die kanonische OAuth-Resource und Token-Audience ist `https://mcp.comvenio.app`.

## 1. Cloudflare – Worker `comvenio-api-gateway`

Repository und Verzeichnis: `comvenio-tools/cloudflare-worker-gateway/`.

1. Die Custom Domain `mcp.comvenio.app` dem Worker `comvenio-api-gateway` zuordnen. Sie steht als `custom_domain = true` versioniert in `wrangler.toml`; Wrangler erzeugt DNS-Eintrag und Zertifikat automatisch.
2. Ein kryptografisch zufälliges Secret mit mindestens 32 Zeichen als Worker-Secret `MCP_ORIGIN_SHARED_SECRET` hinterlegen. Nicht unter `[vars]` eintragen.
3. Den Worker deployen. Er muss Upstream-Redirects manuell behandeln, externe OAuth-Callbacks unverändert weiterreichen und den Header `X-Comvenio-Edge-Secret` selbst setzen.

Der Worker kann vor dem Railway-Cutover bereitgestellt werden: Der bisherige MCP-Server ignoriert den zusätzlichen Header. Damit lässt sich DNS und Routing vorab stabilisieren.

## 2. Railway – Service `comvenio-cli`

Repository: `comvenio-cli`; Railway-Konfiguration: `railway.json`.

Folgende Service-Variablen setzen oder aktualisieren:

```text
COMVENIO_MCP_ENV=production
MCP_PUBLIC_ORIGIN=https://mcp.comvenio.app
MCP_EDGE_SHARED_SECRET=<exakt derselbe Wert wie MCP_ORIGIN_SHARED_SECRET im Worker>
COMVENIO_API_BASE_URL=https://api.comvenio.app
AUTH_SERVICE_BASE_URL=https://api.comvenio.app/auth
MCP_PROD_ALLOWED_HOSTS=mcp.comvenio.app
MCP_PROD_ALLOWED_ORIGINS=<exakte freigegebene Provider-Origins>
```

`RAILWAY_PUBLIC_DOMAIN` wird von Railway bereitgestellt und nur für Host-Allowlist sowie `/health` verwendet. Nach dem Deploy müssen direkte Railway-Aufrufe auf `/.well-known/*`, `/ready`, `/mcp` und `/widgets/*` ohne Edge-Secret mit 403 enden. `GET /health` bleibt erreichbar.

## 3. Railway – Service `auth-service`

Repository und Verzeichnis: `Backend/Microservice-Backend/auth-service/`.

Die Service-Variable atomar auf den kanonischen Resource-Identifier setzen:

```text
MCP_PUBLIC_ORIGIN=https://mcp.comvenio.app
OAUTH_ISSUER=https://api.comvenio.app/auth
```

Alle neu ausgestellten Connector-Access-Tokens müssen anschließend `aud=https://mcp.comvenio.app` tragen. Railway-Origin und Edge-Origin dürfen nicht parallel als gültige Audience akzeptiert werden.

## 4. Reihenfolge und produktiver Nachweis

1. Cloudflare-Custom-Domain und Worker-Secret per Wrangler vorab bereitstellen.
2. Neue Connector-Verbindungen für das kurze Cutover-Fenster pausieren. Der Wechsel der Audience
   ist nicht rückwärtskompatibel; ein Zwischenstand muss bewusst fail-closed bleiben.
3. `auth-service` mit der neuen Resource deployen und unmittelbar danach
   `comvenio-cli` mit demselben Edge-Secret und
   `MCP_PUBLIC_ORIGIN=https://mcp.comvenio.app` deployen.
4. Erst nach erfolgreichem Deploy in ChatGPT den Connector-Endpoint auf `https://mcp.comvenio.app/mcp` ändern beziehungsweise neu scannen.
5. Die vom Portal tatsächlich gelieferte CIMD-Client-ID und den Metadaten-Fingerprint beobachten. Den Pin nur ändern, wenn sich einer dieser Werte wirklich geändert hat.
6. OAuth Authorization Code + PKCE, Token-Audience, Widerruf, Rechteverlust, anonyme Public-Reads und beide Widget-Ressourcen über den kanonischen Host prüfen.
7. Claude verwendet später denselben Endpoint; ein eigener Anthropic-MCP-Server ist nicht vorgesehen.

## Fehler- und Recovery-Pfad

- Worker ohne gültiges Secret: `mcp.comvenio.app` antwortet 503 und kontaktiert Railway nicht.
- Direkter Origin-Aufruf ohne Secret: MCP-Server antwortet außerhalb `/health` mit 403.
- OAuth-Resource-Mismatch: Connector-Verbindung stoppen; `MCP_PUBLIC_ORIGIN` in `auth-service` und `comvenio-cli` auf exakte Gleichheit prüfen.
- Fehlerhafter Release: vorherige erfolgreiche Railway-Deployments beider Services wiederherstellen und ihre Variablen gemeinsam zurücksetzen; anschließend den vorherigen Worker-Deploy wiederherstellen. Kein einzelner Teil-Rollback mit gemischten Audiences.

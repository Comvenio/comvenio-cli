import { oauthEndpoints, type HttpsUrl, type OAuthEnvironment } from "@comvenio/auth";

export interface RailwayDeploymentConfig {
  environment: OAuthEnvironment;
  domain: string;
  endpoint: `${HttpsUrl}/mcp`;
  audience: HttpsUrl;
  health_path: "/health";
  readiness_path: "/ready";
  secret_namespace: "MCP_DEV" | "MCP_PROD";
  required_secret_names: readonly string[];
  rollback: {
    strategy: "railway_previous_successful_deployment";
    readiness_gate_required: true;
    drain_timeout_seconds: 20;
  };
}

function deployment(environment: OAuthEnvironment): RailwayDeploymentConfig {
  const audience = oauthEndpoints(environment).resource;
  const prefix = environment === "production" ? "MCP_PROD" : "MCP_DEV";
  return {
    environment,
    domain: new URL(audience).hostname,
    endpoint: `${audience}/mcp`,
    audience,
    health_path: "/health",
    readiness_path: "/ready",
    secret_namespace: prefix,
    required_secret_names: [
      "MCP_PUBLIC_ORIGIN",
      "COMVENIO_API_BASE_URL",
      "AUTH_SERVICE_BASE_URL",
      "INTERNAL_API_KEY",
      `${prefix}_ALLOWED_ORIGINS`,
      `${prefix}_ALLOWED_HOSTS`,
    ],
    rollback: {
      strategy: "railway_previous_successful_deployment",
      readiness_gate_required: true,
      drain_timeout_seconds: 20,
    },
  };
}

const DEPLOYMENTS: Record<OAuthEnvironment, RailwayDeploymentConfig> = {
  development: {
    ...deployment("development"),
  },
  production: {
    ...deployment("production"),
  },
};

export function railwayDeploymentConfig(environment: OAuthEnvironment): RailwayDeploymentConfig {
  return structuredClone(DEPLOYMENTS[environment]);
}

export function validateRailwayDeploymentConfig(config: RailwayDeploymentConfig): void {
  const expected = DEPLOYMENTS[config.environment];
  if (JSON.stringify(config) !== JSON.stringify(expected)
    || !config.required_secret_names.includes("MCP_PUBLIC_ORIGIN")) {
    throw new Error("Die Railway-Deployment-Konfiguration ist ungültig.");
  }
}

import type { OAuthEnvironment } from "@comvenio/auth";

export interface RailwayDeploymentConfig {
  environment: OAuthEnvironment;
  domain: "mcpdev.comvenio.app" | "mcp.comvenio.app";
  endpoint: "https://mcpdev.comvenio.app/mcp" | "https://mcp.comvenio.app/mcp";
  audience: "https://mcpdev.comvenio.app" | "https://mcp.comvenio.app";
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

const DEPLOYMENTS: Record<OAuthEnvironment, RailwayDeploymentConfig> = {
  development: {
    environment: "development",
    domain: "mcpdev.comvenio.app",
    endpoint: "https://mcpdev.comvenio.app/mcp",
    audience: "https://mcpdev.comvenio.app",
    health_path: "/health",
    readiness_path: "/ready",
    secret_namespace: "MCP_DEV",
    required_secret_names: [
      "MCP_DEV_AUTH_BASE_URL",
      "MCP_DEV_SERVICE_TOKEN",
      "MCP_DEV_ALLOWED_ORIGINS",
    ],
    rollback: {
      strategy: "railway_previous_successful_deployment",
      readiness_gate_required: true,
      drain_timeout_seconds: 20,
    },
  },
  production: {
    environment: "production",
    domain: "mcp.comvenio.app",
    endpoint: "https://mcp.comvenio.app/mcp",
    audience: "https://mcp.comvenio.app",
    health_path: "/health",
    readiness_path: "/ready",
    secret_namespace: "MCP_PROD",
    required_secret_names: [
      "MCP_PROD_AUTH_BASE_URL",
      "MCP_PROD_SERVICE_TOKEN",
      "MCP_PROD_ALLOWED_ORIGINS",
    ],
    rollback: {
      strategy: "railway_previous_successful_deployment",
      readiness_gate_required: true,
      drain_timeout_seconds: 20,
    },
  },
};

export function railwayDeploymentConfig(environment: OAuthEnvironment): RailwayDeploymentConfig {
  return structuredClone(DEPLOYMENTS[environment]);
}

export function validateRailwayDeploymentConfig(config: RailwayDeploymentConfig): void {
  const expected = DEPLOYMENTS[config.environment];
  if (JSON.stringify(config) !== JSON.stringify(expected)
    || !config.required_secret_names.every((name) => name.startsWith(`${config.secret_namespace}_`))) {
    throw new Error("Die Railway-Deployment-Konfiguration ist ungültig.");
  }
}

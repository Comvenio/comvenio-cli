export interface ComvenioWorkspace {
  root: "comvenio-cli";
  apps: readonly ["apps/cli", "apps/mcp-server"];
  packages: readonly [
    "packages/comvenio-client",
    "packages/tool-catalog",
    "packages/auth",
    "packages/connector-contracts",
  ];
}

export const COMVENIO_WORKSPACE: ComvenioWorkspace = Object.freeze({
  root: "comvenio-cli",
  apps: ["apps/cli", "apps/mcp-server"],
  packages: [
    "packages/comvenio-client",
    "packages/tool-catalog",
    "packages/auth",
    "packages/connector-contracts",
  ],
} as const);

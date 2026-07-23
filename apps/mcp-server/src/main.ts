import { writeSync } from "node:fs";

import { startMcpDeploymentCandidate } from "./bootstrap.ts";
import { serializeMcpStartupFailure } from "./startup-diagnostics.ts";

function writeLifecycleRecord(record: object): void {
  writeSync(2, `${JSON.stringify(record)}\n`);
}

try {
  const started = await startMcpDeploymentCandidate(process.env);

  writeLifecycleRecord({
    event: "comvenio_mcp_started",
    environment: started.config.environment,
    host: started.config.host,
    port: started.config.port,
    readiness: "blocked_until_catalog_and_auth_release_gates_pass",
  });

  let shuttingDown = false;
  const shutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    let drained = false;
    try {
      drained = await started.server.drain(20_000);
    } finally {
      await started.state_store.close();
    }
    writeLifecycleRecord({ event: "comvenio_mcp_stopped", signal, drained });
    process.exit(drained ? 0 : 1);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
} catch (error) {
  writeSync(2, serializeMcpStartupFailure(error));
  process.exitCode = 1;
}

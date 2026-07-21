import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  COMVENIO_WORKSPACE,
  normalizeRequestContext as clientContextNormalizer,
} from "@comvenio/comvenio-client";
import { normalizeRequestContext as contractContextNormalizer } from "@comvenio/connector-contracts";

const repositoryRoot = resolve(import.meta.dir, "../../..");

describe("ComvenioWorkspace", () => {
  test("declares the connector workspace boundaries", () => {
    expect(COMVENIO_WORKSPACE.root).toBe("comvenio-cli");
    for (const workspacePath of [
      ...COMVENIO_WORKSPACE.apps,
      ...COMVENIO_WORKSPACE.packages,
    ]) {
      expect(existsSync(join(repositoryRoot, workspacePath))).toBe(true);
    }
  });

  test("re-exports connector contracts from the shared client package", () => {
    expect(clientContextNormalizer).toBe(contractContextNormalizer);
  });
});

/** Offline developer evidence; never calls the product API. */
import { execFileSync } from "node:child_process";
import { fullDomainCatalogSummary, fullDomainOperationContracts } from "../apps/mcp-server/src/domain-runtime.ts";

const operations = fullDomainOperationContracts();
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
process.stdout.write(JSON.stringify({
  format: "domain-operation-contracts/v1", source_commit: sourceCommit, source_dirty: dirty,
  actions: fullDomainCatalogSummary(), operation_count: operations.length, operations,
}, null, 2) + "\n");

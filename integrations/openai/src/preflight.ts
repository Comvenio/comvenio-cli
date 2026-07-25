import { existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

import type { ChatGptAppManifest, OpenAiSubmissionEvidence, OpenAiSubmissionPreflightReport, OpenAiToolDescriptor, OpenAiToolTestPlan, SubmissionCheck } from "./types.ts";

function check(code: string, valid: boolean, message: string): SubmissionCheck {
  return { code, status: valid ? "pass" : "block", message };
}

function safeArtifact(root: string, relativePath: string): boolean {
  const absoluteRoot = resolve(root);
  const absoluteFile = resolve(absoluteRoot, relativePath.replace(/^\.\//u, ""));
  if (absoluteFile !== absoluteRoot && !absoluteFile.startsWith(`${absoluteRoot}${sep}`)) return false;
  return existsSync(absoluteFile) && statSync(absoluteFile).isFile();
}

export function runOpenAiSubmissionPreflight(input: {
  artifact_root: string;
  manifest: ChatGptAppManifest;
  tools: OpenAiToolDescriptor[];
  tool_test_plan: OpenAiToolTestPlan;
  evidence: OpenAiSubmissionEvidence;
}): OpenAiSubmissionPreflightReport {
  const expectedTools = input.tools.map((tool) => tool.name).sort();
  const plannedTools = input.tool_test_plan.cases.map((item) => item.tool_name).sort();
  const resultTools = input.evidence.tool_results.map((item) => item.tool_name).sort();
  const expectedWidgets = [...input.manifest.widget_resource_uris].sort();
  const evidenceWidgets = input.evidence.widget_evidence.map((item) => item.resource_uri).sort();
  const artifactPaths = [
    input.manifest.assets.icon,
    input.manifest.assets.logo,
    ...input.manifest.screenshots.map((item) => item.path),
    ...input.tool_test_plan.cases.map((item) => `./${item.expected_response_fixture}`),
    "./submission/app-profile.json",
    "./submission/tool-test-plan.json",
    "./submission/reviewer-runbook.md",
  ];
  const checks = [
    check("ORG_VERIFIED", input.evidence.organization_verified, "Publisher muss als Comvenio verifiziert sein."),
    check("APP_PERMISSIONS", ["api.apps.read", "api.apps.write"].every((permission) => input.evidence.app_permissions.includes(permission)), "OpenAI-Projekt benötigt api.apps.read und api.apps.write."),
    check("GLOBAL_PROJECT", input.evidence.project_data_residency === "global", "Plugins mit MCP-App benötigen aktuell ein globales OpenAI-Projekt."),
    check("PUBLIC_MCP", input.evidence.public_mcp_endpoint_verified, "Der produktive universelle MCP-Endpunkt muss öffentlich geprüft sein."),
    check("OAUTH_PKCE", input.evidence.oauth_pkce_verified, "OAuth, S256, Audience, Widerruf und Reauth müssen geprüft sein."),
    check("WIDGET_CSP", input.evidence.widget_csp_verified, "Alle veröffentlichten Widget-Ressourcen benötigen exakte CSP-Metadaten."),
    check("LEGAL_LINKS", input.evidence.legal_links_verified, "Datenschutz-, AGB-, Impressums-, Website- und Supportlinks müssen erreichbar sein."),
    check("CONNECTOR_LEGAL_DOCUMENTS_REVIEWED", input.evidence.connector_legal_documents_reviewed, "Die connector-spezifische Datenschutzrichtlinie und die Nutzungsbedingungen müssen von Product Owner und Privacy Reviewer freigegeben sein."),
    check("REAL_ASSETS", artifactPaths.every((path) => safeArtifact(input.artifact_root, path)), "Alle referenzierten Manifest-, Asset-, Screenshot- und Runbook-Dateien müssen real vorhanden sein."),
    check("PUBLISHED_TOOLS", input.tools.length > 0, "Eine Einreichung ohne veröffentlichte Tools ist nicht zulässig."),
    check("TOOL_PLAN_PARITY", JSON.stringify(expectedTools) === JSON.stringify(plannedTools) && JSON.stringify(expectedTools) === JSON.stringify(resultTools), "Jedes veröffentlichte Tool benötigt genau einen Testfall und ein Ergebnis."),
    check("TOOL_TESTS", input.evidence.tool_results.length === input.tools.length && input.evidence.tool_results.every((item) => {
      const planned = input.tool_test_plan.cases.find((candidate) => candidate.tool_name === item.tool_name);
      return item.passed_web && item.passed_mobile && planned?.prompt === item.prompt
        && planned.expected_response_fixture === item.expected_response_fixture;
    }), "Jeder Tooltest muss auf ChatGPT Web und Mobile mit exakt geplantem Prompt und erwarteter Fixture bestehen."),
    check("REVIEWER_ACCOUNTS", input.evidence.reviewer_accounts.length === 2 && new Set(input.evidence.reviewer_accounts.map((account) => account.role)).size === 2 && ["member", "manager"].every((role) => input.evidence.reviewer_accounts.some((account) => account.role === role && account.login_ready && !account.mfa_required && /^submission-secret:\/[a-z0-9/_-]+$/u.test(account.secret_reference))), "Member- und Manager-Reviewkonten müssen ohne MFA über verschlüsselte Secret-Referenzen nutzbar sein."),
    check("WIDGET_EVIDENCE", JSON.stringify(expectedWidgets) === JSON.stringify(evidenceWidgets) && input.evidence.widget_evidence.every((item) => {
      const screenshot = input.manifest.screenshots.find((candidate) => candidate.resource_uri === item.resource_uri);
      return item.synthetic_data_only && item.surfaces.includes("web") && item.surfaces.includes("mobile")
        && screenshot?.path === item.screenshot_path && safeArtifact(input.artifact_root, item.screenshot_path);
    }), "Alle veröffentlichten Widgets benötigen Web-/Mobilnachweise mit ausschließlich synthetischen Daten."),
    check("PRIVACY_ACCEPTANCE", input.evidence.global_residency_acceptance.product_owner_signed && input.evidence.global_residency_acceptance.privacy_reviewer_signed, "Product Owner und Privacy Reviewer müssen OPENAI_GLOBAL_RESIDENCY_ACCEPTED gemeinsam signieren."),
  ];
  return { schema_version: "1.0.0", provider: "openai", state: checks.every((item) => item.status === "pass") ? "ready" : "blocked", checks };
}

export function assertOpenAiSubmissionReady(report: OpenAiSubmissionPreflightReport): void {
  const blockers = report.checks.filter((item) => item.status === "block");
  if (report.state !== "ready" || blockers.length > 0) throw new Error(`OpenAI-Submission blockiert: ${blockers.map((item) => item.code).join(", ")}`);
}

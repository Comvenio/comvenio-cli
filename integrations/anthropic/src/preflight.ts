import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

import type {
  AnthropicToolDescriptor,
  ClaudeDirectoryManifest,
  ClaudeSubmissionCheck,
  ClaudeSubmissionEvidence,
  ClaudeSubmissionPreflightReport,
  ClaudeToolSyncPlan,
} from "./types.ts";

function check(code: string, valid: boolean, message: string): ClaudeSubmissionCheck {
  return { code, status: valid ? "pass" : "block", message };
}

function artifactPath(root: string, relativePath: string): string | null {
  const absoluteRoot = resolve(root);
  const absoluteFile = resolve(absoluteRoot, relativePath.replace(/^\.\//u, ""));
  if (absoluteFile !== absoluteRoot && !absoluteFile.startsWith(`${absoluteRoot}${sep}`)) return null;
  return absoluteFile;
}

function realFile(root: string, relativePath: string): boolean {
  const path = artifactPath(root, relativePath);
  return path !== null && existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
}

function validCarouselPng(root: string, relativePath: string): boolean {
  const path = artifactPath(root, relativePath);
  if (!path || !realFile(root, relativePath) || !/\.png$/iu.test(relativePath)) return false;
  const image = readFileSync(path);
  return image.length >= 24
    && image.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
    && image.readUInt32BE(16) >= 1_000;
}

function safeToolCopy(tool: AnthropicToolDescriptor): boolean {
  return tool.name.length <= 64 && tool.title.trim().length > 0 && tool.description.trim().length > 0
    && !(tool.annotations.readOnlyHint && tool.annotations.destructiveHint)
    && !/ignore (?:all|previous)|system prompt|base64|call (?:another|external) tool/iu.test(tool.description);
}

export function runAnthropicSubmissionPreflight(input: {
  artifact_root: string;
  manifest: ClaudeDirectoryManifest;
  tools: AnthropicToolDescriptor[];
  tool_sync_plan: ClaudeToolSyncPlan;
  evidence: ClaudeSubmissionEvidence;
}): ClaudeSubmissionPreflightReport {
  const expectedTools = input.tools.map((tool) => tool.name).sort();
  const plannedTools = input.tool_sync_plan.cases.map((item) => item.tool_name).sort();
  const resultTools = input.evidence.tool_results.map((item) => item.tool_name).sort();
  const expectedWidgets = [...input.manifest.widget_resource_uris].sort();
  const evidenceWidgets = input.evidence.widget_surfaces.map((item) => item.resource_uri).sort();
  const publishedWidgets = new Set<string>(input.manifest.widget_resource_uris);
  const screenshotWidgets = new Set<string>(input.manifest.screenshots.map((item) => item.resource_uri));
  const screenshotPaths = input.manifest.screenshots.map((item) => item.path);
  const artifacts = [
    input.manifest.assets.icon,
    input.manifest.assets.logo,
    ...input.manifest.screenshots.map((item) => item.path),
    ...input.tool_sync_plan.cases.map((item) => `./${item.expected_response_fixture}`),
    "./submission/connector-profile.json",
    "./submission/tool-test-plan.json",
    "./submission/reviewer-runbook.md",
    "./submission/directory-submission-checklist.md",
  ];
  const checks = [
    check("DIRECTORY_ORGANIZATION", ["team", "enterprise"].includes(input.evidence.organization_plan), "Claude Directory benötigt eine Team- oder Enterprise-Organisation."),
    check("DIRECTORY_ACCESS", input.evidence.directory_management_access, "Der Einreicher benötigt Directory-Management-Zugriff."),
    check("DIRECTORY_SLUG", input.evidence.directory_slug_verified, "Der permanente Directory-Slug comvenio muss vor Einreichung im Portal verifiziert sein."),
    check("PUBLIC_REMOTE_MCP", input.evidence.public_remote_mcp_verified, "Der produktive Streamable-HTTP-MCP muss öffentlich erreichbar sein."),
    check("ORIGIN_VALIDATION", input.evidence.origin_header_validation_verified, "Origin-Header-Validierung und Anthropic-Zugriff müssen geprüft sein."),
    check("OAUTH_CIMD", input.evidence.oauth_cimd_verified && input.manifest.auth.type === "oauth_cimd" && input.manifest.auth.client_type === "public" && input.manifest.auth.token_endpoint_auth_method === "none" && input.manifest.auth.pkce_method === "S256" && !input.manifest.auth.dynamic_client_registration && !input.manifest.auth.anthropic_held_credentials, "V1 benötigt OAuth-CIMD, öffentlichen Client, none und PKCE S256 ohne DCR oder gehaltene Secrets."),
    check("PUBLIC_TRUST_DOCS", input.evidence.public_documentation_verified && input.evidence.privacy_policy_verified && input.evidence.support_verified, "Dokumentation, Datenschutz und Support müssen öffentlich erreichbar sein."),
    check("CONNECTOR_LEGAL_DOCUMENTS_REVIEWED", input.evidence.connector_legal_documents_reviewed, "Die connector-spezifische Datenschutzrichtlinie und die Nutzungsbedingungen müssen von Product Owner und Privacy Reviewer freigegeben sein."),
    check("FIRST_PARTY_POLICY", input.evidence.first_party_api_verified && input.evidence.unsupported_use_cases_absent, "Nur eigene Comvenio-APIs und zulässige Directory-Anwendungsfälle dürfen enthalten sein."),
    check("REAL_ARTIFACTS", artifacts.every((path) => realFile(input.artifact_root, path)), "Alle Profile, Assets, Screenshots, Fixtures und Reviewer-Dokumente müssen real vorhanden sein."),
    check("WIDGET_SCREENSHOTS", input.manifest.screenshots.length >= 3
      && input.manifest.screenshots.length <= 5
      && new Set(screenshotPaths).size === screenshotPaths.length
      && input.manifest.screenshots.every((item) => publishedWidgets.has(item.resource_uri)
        && item.format === "png" && item.app_response_only && item.synthetic_data_only
        && item.prompt.trim().length > 0 && validCarouselPng(input.artifact_root, item.path))
      && [...publishedWidgets].every((resourceUri) => screenshotWidgets.has(resourceUri)), "Die Claude-Submission benötigt drei bis fünf eindeutige synthetische PNG-Carousel-Bilder mit mindestens 1000 Pixel Breite und mindestens einem Nachweis je veröffentlichtem Widget."),
    check("PUBLISHED_TOOLS", input.tools.length > 0, "Eine Directory-Einreichung ohne veröffentlichte Tools ist nicht zulässig."),
    check("TOOL_COPY_ANNOTATIONS", input.tools.every(safeToolCopy), "Jedes Tool benötigt kurzen Namen, Titel, enge Beschreibung und widerspruchsfreie gemeinsame Annotationen."),
    check("TOOL_SYNC", input.evidence.tool_sync_report.status === "pass" && input.evidence.tool_sync_report.tool_sync_version === input.manifest.tool_sync_version && input.evidence.tool_sync_report.expected_tool_count === input.tools.length, "Der deterministische Tool-Sync muss ohne Missing, Extra oder Drift bestehen."),
    check("TOOL_PLAN_PARITY", JSON.stringify(expectedTools) === JSON.stringify(plannedTools) && JSON.stringify(expectedTools) === JSON.stringify(resultTools), "Jedes veröffentlichte Tool benötigt genau einen vollständigen Testfall und ein Ergebnis."),
    check("TOOL_TESTS", input.evidence.tool_results.length === input.tools.length && input.evidence.tool_results.every((result) => {
      const planned = input.tool_sync_plan.cases.find((item) => item.tool_name === result.tool_name);
      return result.happy_path_passed && result.permission_denied_passed && result.mcp_inspector_passed
        && result.claude_custom_connector_passed && result.expected_response_fixture === planned?.expected_response_fixture;
    }), "Jedes Tool muss Happy Path und Permission-Denial im MCP Inspector und als Claude Custom Connector bestehen."),
    check("REVIEWER_ACCOUNT", input.evidence.reviewer_accounts.length === 2 && new Set(input.evidence.reviewer_accounts.map((account) => account.role)).size === 2 && ["member", "manager"].every((role) => input.evidence.reviewer_accounts.some((account) => account.role === role && account.fully_populated && account.login_ready && !account.mfa_required && /^submission-secret:\/[a-z0-9/_-]+$/u.test(account.secret_reference))), "Vollständig befüllte Member- und Manager-Konten müssen ohne MFA über Submission-Secrets bereitstehen."),
    check("WIDGET_SURFACES", JSON.stringify(expectedWidgets) === JSON.stringify(evidenceWidgets) && input.evidence.widget_surfaces.every((item) => item.same_widget_build && ["web", "desktop", "mobile"].every((surface) => item.surfaces.includes(surface as "web" | "desktop" | "mobile"))), "Alle veröffentlichten Widgets müssen mit demselben Build auf Web, Desktop und Mobile geprüft sein."),
    check("REVIEW_FINDINGS", input.evidence.review_findings.every((finding) => finding.status === "resolved"), "Offene Anthropic-Review-Findings blockieren ausschließlich die Claude-Publikation."),
  ];
  return { schema_version: "1.0.0", provider: "anthropic", state: checks.every((item) => item.status === "pass") ? "ready" : "blocked", checks };
}

export function assertAnthropicSubmissionReady(report: ClaudeSubmissionPreflightReport): void {
  const blockers = report.checks.filter((item) => item.status === "block");
  if (report.state !== "ready" || blockers.length > 0) throw new Error(`Claude-Submission blockiert: ${blockers.map((item) => item.code).join(", ")}`);
}

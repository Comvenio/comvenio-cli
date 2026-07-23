import { execFileSync } from "node:child_process";

const SERVICE = "comvenio-cli-oauth";
const ACCOUNT = "default";

export type OAuthCredentials = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  actorToken?: string;
  actorExpiresAt?: number;
};

function validateCredentials(value: unknown): OAuthCredentials {
  if (
    typeof value !== "object"
    || value === null
    || typeof (value as OAuthCredentials).accessToken !== "string"
    || typeof (value as OAuthCredentials).refreshToken !== "string"
    || typeof (value as OAuthCredentials).accessExpiresAt !== "number"
  ) {
    throw new Error("Der geschützte OAuth-Credential-Eintrag ist ungültig.");
  }
  return value as OAuthCredentials;
}

function windowsProtect(plainText: string): string {
  const script = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Security",
    "$plain=[Console]::In.ReadToEnd()",
    "$bytes=[Text.Encoding]::UTF8.GetBytes($plain)",
    "$protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Convert]::ToBase64String($protected)",
  ].join(";");
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { input: plainText, encoding: "utf8", windowsHide: true },
  ).trim();
}

function windowsUnprotect(cipherText: string): string {
  const script = [
    "$ErrorActionPreference='Stop'",
    "$cipher=[Console]::In.ReadToEnd().Trim()",
    "$bytes=[Convert]::FromBase64String($cipher)",
    "$plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Text.Encoding]::UTF8.GetString($plain)",
  ].join(";");
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { input: cipherText, encoding: "utf8", windowsHide: true },
  ).trim();
}

function powershellCredentialCommand(command: "read" | "write" | "delete", value?: string): string {
  const path = `${process.env.APPDATA ?? process.env.USERPROFILE ?? "."}\\Comvenio\\cli-oauth.dpapi`;
  const escapedPath = path.replace(/'/g, "''");
  if (command === "write") {
    const protectedValue = windowsProtect(value ?? "");
    const script = [
      "$ErrorActionPreference='Stop'",
      `$path='${escapedPath}'`,
      "$directory=Split-Path -Parent $path",
      "New-Item -ItemType Directory -Force -Path $directory | Out-Null",
      "[IO.File]::WriteAllText($path,[Console]::In.ReadToEnd().Trim(),[Text.Encoding]::ASCII)",
    ].join(";");
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { input: protectedValue, encoding: "utf8", windowsHide: true },
    );
    return "";
  }
  if (command === "delete") {
    const script = `Remove-Item -LiteralPath '${escapedPath}' -Force -ErrorAction SilentlyContinue`;
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", windowsHide: true },
    );
    return "";
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    `$path='${escapedPath}'`,
    "if (-not (Test-Path -LiteralPath $path)) { exit 44 }",
    "[IO.File]::ReadAllText($path,[Text.Encoding]::ASCII)",
  ].join(";");
  try {
    const cipherText = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", windowsHide: true },
    );
    return windowsUnprotect(cipherText);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 44) return "";
    throw error;
  }
}

function macosCredentialCommand(command: "read" | "write" | "delete", value?: string): string {
  if (command === "write") {
    execFileSync(
      "security",
      ["add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w", value ?? ""],
      { encoding: "utf8" },
    );
    return "";
  }
  if (command === "delete") {
    try {
      execFileSync("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
    } catch {
      // Deleting a missing keychain entry is idempotent.
    }
    return "";
  }
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "";
  }
}

function linuxCredentialCommand(command: "read" | "write" | "delete", value?: string): string {
  if (command === "write") {
    execFileSync(
      "secret-tool",
      ["store", "--label=Comvenio CLI OAuth", "service", SERVICE, "account", ACCOUNT],
      { input: value ?? "", encoding: "utf8" },
    );
    return "";
  }
  if (command === "delete") {
    try {
      execFileSync("secret-tool", ["clear", "service", SERVICE, "account", ACCOUNT]);
    } catch {
      // Deleting a missing Secret Service entry is idempotent.
    }
    return "";
  }
  try {
    return execFileSync(
      "secret-tool",
      ["lookup", "service", SERVICE, "account", ACCOUNT],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "";
  }
}

function credentialCommand(command: "read" | "write" | "delete", value?: string): string {
  try {
    if (process.platform === "win32") return powershellCredentialCommand(command, value);
    if (process.platform === "darwin") return macosCredentialCommand(command, value);
    return linuxCredentialCommand(command, value);
  } catch (error) {
    throw new Error(
      `OAuth-Credentials konnten nicht sicher im Betriebssystem gespeichert werden: ${(error as Error).message}`,
    );
  }
}

export function saveOAuthCredentials(credentials: OAuthCredentials): void {
  credentialCommand("write", JSON.stringify(credentials));
}

export function loadOAuthCredentials(): OAuthCredentials | null {
  const raw = credentialCommand("read");
  if (!raw) return null;
  try {
    return validateCredentials(JSON.parse(raw));
  } catch (error) {
    throw new Error(`OAuth-Credentials konnten nicht gelesen werden: ${(error as Error).message}`);
  }
}

export function clearOAuthCredentials(): void {
  credentialCommand("delete");
}

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { cliProfile, profileSuffix } from "../profile.ts";

const SERVICE = "comvenio-cli-oauth";
// One credential entry per profile; "default" keeps the entry it always had.
const ACCOUNT = cliProfile();

export type OAuthCredentials = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
};

function validateCredentials(value: unknown): OAuthCredentials {
  if (
    typeof value !== "object"
    || value === null
    || typeof (value as OAuthCredentials).accessToken !== "string"
    || typeof (value as OAuthCredentials).refreshToken !== "string"
    || typeof (value as OAuthCredentials).accessExpiresAt !== "number"
    || !Number.isFinite((value as OAuthCredentials).accessExpiresAt)
    || !Number.isInteger((value as OAuthCredentials).accessExpiresAt)
    || (value as OAuthCredentials).accessExpiresAt <= 0
    || (value as OAuthCredentials).accessToken.length < 16
    || (value as OAuthCredentials).accessToken.length > 8_192
    || (value as OAuthCredentials).refreshToken.length < 16
    || (value as OAuthCredentials).refreshToken.length > 8_192
    || /[\s\r\n]/u.test((value as OAuthCredentials).accessToken)
    || /[\s\r\n]/u.test((value as OAuthCredentials).refreshToken)
  ) {
    throw new Error("Der geschützte OAuth-Credential-Eintrag ist ungültig.");
  }
  return {
    accessToken: (value as OAuthCredentials).accessToken,
    refreshToken: (value as OAuthCredentials).refreshToken,
    accessExpiresAt: (value as OAuthCredentials).accessExpiresAt,
  };
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
    "Add-Type -AssemblyName System.Security",
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
  const path = `${process.env.APPDATA ?? process.env.USERPROFILE ?? "."}\\Comvenio\\cli-oauth${profileSuffix(ACCOUNT)}.dpapi`;
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

type Run = (program: string, args: string[], options?: { input?: string; encoding: "utf8" }) => string;
const execRun: Run = (program, args, options) =>
  String(execFileSync(program, args, { encoding: "utf8", ...options, stdio: ["pipe", "pipe", "pipe"] }));

// `security add-generic-password -w` without a value prompts on the terminal and ignores
// the pipe (2026-09-25, first Mac: "passwords don't match", an empty entry). `security -i`
// reads commands from stdin, keeping the secret out of argv — but only ~4 KB per line
// (measured on macOS 26: 4000 characters pass, 5000 fail), and two tokens may be larger.
const KEYCHAIN_LINE_LIMIT = 3500;
const KEYCHAIN_PART_BYTES = 2048;
const KEYCHAIN_HEAD = /^comvenio-parts-v1:([1-9][0-9]{0,3}):[a-f0-9]{64}$/;

function keychainHead(parts: number, bytes: Buffer): string {
  return `comvenio-parts-v1:${parts}:${createHash("sha256").update(bytes).digest("hex")}`;
}

function keychainPartCount(head: string): number | null {
  const match = KEYCHAIN_HEAD.exec(head);
  return match ? Number(match[1]) : null;
}

export function macosCredentialCommand(
  command: "read" | "write" | "delete",
  value?: string,
  account: string = ACCOUNT,
  run: Run = execRun,
): string {
  const line = (entry: string, secret: string) =>
    `add-generic-password -U -s ${SERVICE} -a ${entry} -w ${JSON.stringify(secret)}\n`;
  const write = (entry: string, secret: string) => { run("security", ["-i"], { input: line(entry, secret), encoding: "utf8" }); };
  const read = (entry: string): string | null => {
    try {
      return run("security", ["find-generic-password", "-s", SERVICE, "-a", entry, "-w"], { encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };
  const remove = (entry: string) => {
    try {
      run("security", ["delete-generic-password", "-s", SERVICE, "-a", entry]);
    } catch {
      // Deleting a missing keychain entry is idempotent.
    }
  };
  const removeParts = (from: number, to: number) => { for (let i = from; i <= to; i++) remove(`${account}.${i}`); };
  const partsNow = () => keychainPartCount(read(account) ?? "") ?? 0;

  if (command === "write") {
    const secret = value ?? "", before = partsNow();
    let parts = 0;
    if (Buffer.byteLength(line(account, secret)) <= KEYCHAIN_LINE_LIMIT) write(account, secret);
    else {
      // The head entry, written last, names the parts and their hash.
      const bytes = Buffer.from(secret, "utf8");
      parts = Math.ceil(bytes.length / KEYCHAIN_PART_BYTES);
      for (let i = 0; i < parts; i++) {
        write(`${account}.${i + 1}`, bytes.subarray(i * KEYCHAIN_PART_BYTES, (i + 1) * KEYCHAIN_PART_BYTES).toString("base64"));
      }
      write(account, keychainHead(parts, bytes));
    }
    removeParts(parts + 1, before);
    if (macosCredentialCommand("read", undefined, account, run) !== secret) {
      throw new Error("Der Schlüsselbund gibt den gespeicherten Eintrag nicht unverändert zurück.");
    }
    return "";
  }
  if (command === "delete") {
    removeParts(1, partsNow());
    remove(account);
    return "";
  }
  const head = read(account);
  if (!head) return "";
  const parts = keychainPartCount(head);
  if (parts === null) return head;
  const pieces = Array.from({ length: parts }, (_, i) => read(`${account}.${i + 1}`));
  if (pieces.some(piece => piece === null)) throw new Error("Ein Teil des Schlüsselbund-Eintrags fehlt.");
  const bytes = Buffer.concat(pieces.map(piece => Buffer.from(piece!, "base64")));
  if (head !== keychainHead(parts, bytes)) throw new Error("Die Teile des Schlüsselbund-Eintrags passen nicht zusammen.");
  return bytes.toString("utf8");
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

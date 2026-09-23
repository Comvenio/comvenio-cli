// A second sign-in next to the first — e.g. the auditor who approves what the
// treasurer booked (four-eyes). COMVENIO_CLI_PROFILE names the profile; each
// profile has its own state file and its own OAuth credential entry.
const PROFILE_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/u;

export function cliProfile(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.COMVENIO_CLI_PROFILE?.trim();
  if (!value) return "default";
  if (!PROFILE_PATTERN.test(value)) {
    throw new Error(`COMVENIO_CLI_PROFILE ist ungültig: „${value}“. Erlaubt sind Kleinbuchstaben, Ziffern und Bindestrich (höchstens 32 Zeichen).`);
  }
  return value;
}

/** File-name suffix: empty for the default profile, so existing sign-ins stay where they are. */
export function profileSuffix(profile: string = cliProfile()): string {
  return profile === "default" ? "" : `.${profile}`;
}

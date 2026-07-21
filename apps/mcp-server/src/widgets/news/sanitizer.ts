const ALLOWED_TAGS = new Set(["p", "br", "h2", "h3", "strong", "em", "ul", "ol", "li", "blockquote", "a"]);
const VOID_TAGS = new Set(["br"]);
const BLOCKED_CONTENT = ["script", "style", "iframe", "form", "noscript", "svg", "math", "object", "embed", "template"] as const;

function escapeText(value: string): string {
  return value.replace(/[&<>]/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!);
}

function safeHref(token: string): string | null {
  const match = token.match(/\shref\s*=\s*(["'])(.*?)\1/iu);
  if (!match) return null;
  try {
    const url = new URL(match[2]!);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function sanitizeNewsHtml(value: string | null | undefined): string | null {
  if (!value || value.length > 200_000 || value.includes("\0")) return null;
  let source = value.replace(/<!--[\s\S]*?-->/gu, "");
  for (const tag of BLOCKED_CONTENT) {
    source = source.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "giu"), "");
    source = source.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "giu"), "");
  }
  const output: string[] = [];
  const stack: string[] = [];
  const tokenPattern = /<[^>]*>/gu;
  let offset = 0;
  for (const match of source.matchAll(tokenPattern)) {
    output.push(escapeText(source.slice(offset, match.index)));
    offset = match.index + match[0].length;
    const parsed = match[0].match(/^<\s*(\/)?\s*([a-z0-9]+)(?:\s[^>]*)?>$/iu);
    if (!parsed) continue;
    const closing = Boolean(parsed[1]);
    const tag = parsed[2]!.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (closing) {
      if (stack.at(-1) === tag) {
        stack.pop();
        output.push(`</${tag}>`);
      }
      continue;
    }
    if (tag === "a") {
      const href = safeHref(match[0]);
      if (!href) continue;
      output.push(`<a href="${href.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;")}" target="_blank" rel="noopener noreferrer">`);
      stack.push(tag);
      continue;
    }
    output.push(`<${tag}>`);
    if (!VOID_TAGS.has(tag)) stack.push(tag);
  }
  output.push(escapeText(source.slice(offset)));
  while (stack.length > 0) output.push(`</${stack.pop()!}>`);
  const sanitized = output.join("").trim();
  return sanitized || null;
}

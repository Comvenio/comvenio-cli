// Markdown of a customer article → plain terminal text (03-programm-hilfe).
// No colour codes at all, so NO_COLOR and pipes need no special case; every
// line fits the given width: prose is wrapped, tables become lists, long code
// lines are continued (a CLI command with a trailing backslash, so it stays
// runnable when copied).

/** Removes the frontmatter and the generator markers. */
export function articleBody(raw: string): string {
  return raw
    .replace(/^---\n[\s\S]*?\n---\n?/u, "")
    .replace(/^<!-- \/?gen:docs[^>]*-->\n?/gmu, "");
}

function stripInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/(?<![\w*])\*([^*]+)\*(?![\w*])/gu, "$1")
    .replace(/(?<!\w)_([^_]+)_(?!\w)/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1");
}

/** Wraps at spaces; a single word longer than the width is cut hard. */
export function wrap(text: string, width: number, indent = "", firstIndent = indent): string[] {
  const lines: string[] = [];
  let line = firstIndent;
  let lineHasWord = false;
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    const prefix = lineHasWord ? " " : "";
    if (line.length + prefix.length + word.length <= width) {
      line += prefix + word;
      lineHasWord = true;
      continue;
    }
    if (lineHasWord) lines.push(line);
    line = indent;
    let rest = word;
    while (indent.length + rest.length > width) {
      const room = Math.max(1, width - indent.length);
      lines.push(indent + rest.slice(0, room));
      rest = rest.slice(room);
    }
    line += rest;
    lineHasWord = true;
  }
  if (lineHasWord) lines.push(line);
  return lines;
}

function wrapCode(line: string, width: number): string[] {
  const indent = "    ";
  if (!line.trim()) return [""];
  if (indent.length + line.length <= width) return [indent + line];
  const leading = /^\s*/u.exec(line)![0];
  const base = indent + leading;
  if (!/^\s*comvenio\s/u.test(line)) return wrap(line, width, `${base}  `, base);
  const parts = wrap(line, width - 2, `${base}  `, base);
  return parts.map((part, index) => (index < parts.length - 1 ? `${part} \\` : part));
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/u, "").replace(/\|$/u, "")
    .split(/(?<!\\)\|/u).map((cell) => stripInline(cell.replaceAll("\\|", "|").trim()));
}

interface Block {
  first: string;
  indent: string;
  quote: boolean;
  text: string[];
}

/** Renders the article body for a terminal of the given width (at least 40 columns). */
export function renderArticle(raw: string, width: number): string {
  const columns = Math.max(40, width);
  const out: string[] = [];
  const blank = () => {
    if (out.length > 0 && out.at(-1) !== "") out.push("");
  };
  let block: Block | null = null;
  const flush = () => {
    if (block) out.push(...wrap(stripInline(block.text.join(" ")), columns, block.indent, block.first));
    block = null;
  };
  let inCode = false;
  let header: string[] | null = null;

  for (const line of articleBody(raw).split("\n")) {
    if (/^\s*```/u.test(line)) {
      flush();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(...wrapCode(line, columns));
      continue;
    }
    if (/^\s*\|/u.test(line)) {
      flush();
      const cells = tableCells(line);
      if (cells.every((cell) => /^:?-{2,}:?$/u.test(cell))) continue;
      if (!header) {
        header = cells;
        continue;
      }
      // Tables become lists: first cell as item, the others as "label: value".
      out.push(...wrap(cells[0] ?? "", columns, "  ", "- "));
      cells.slice(1).forEach((cell, index) => {
        if (cell) out.push(...wrap(`${header![index + 1] ?? ""}: ${cell}`, columns, "    ", "  "));
      });
      continue;
    }
    header = null;
    if (!line.trim()) {
      flush();
      blank();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/u.exec(line);
    if (heading) {
      flush();
      const text = stripInline(heading[2]!);
      blank();
      if (heading[1] === "#") {
        out.push(...wrap(text.toUpperCase(), columns));
        out.push("=".repeat(Math.min(columns, Math.max(3, text.length))));
      } else if (heading[1] === "##") {
        out.push(...wrap(text, columns));
        out.push("-".repeat(Math.min(columns, Math.max(3, text.length))));
      } else {
        out.push(...wrap(text, columns));
      }
      continue;
    }
    const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/u.exec(line);
    if (item) {
      flush();
      const indent = " ".repeat(Math.min(item[1]!.length, 8));
      const first = `${indent}${item[2] === "*" ? "-" : item[2]} `;
      block = { first, indent: " ".repeat(first.length), quote: false, text: [item[3]!] };
      continue;
    }
    const quote = /^>\s?(.*)$/u.exec(line);
    if (quote) {
      const current = block as Block | null;
      if (!current?.quote) {
        flush();
        block = { first: "  ", indent: "  ", quote: true, text: [] };
      }
      if (quote[1]!.trim()) block!.text.push(quote[1]!.trim());
      continue;
    }
    // Prose continues the open item, quote or paragraph (lazy continuation).
    if (!block) block = { first: "", indent: "", quote: false, text: [] };
    block.text.push(line.trim());
  }
  flush();
  while (out[0] === "") out.shift();
  while (out.at(-1) === "") out.pop();
  return out.join("\n");
}

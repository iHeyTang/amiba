import * as Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-python";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-json5";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-batch";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-java";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-php";
import "prismjs/components/prism-perl";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-lua";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-graphql";
import "prismjs/components/prism-markdown";

import { useMemo, type ReactNode } from "react";

export type ApprovalSyntaxLanguage =
  | "plain"
  | "shell"
  | "python"
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "json"
  | "json5"
  | "diff"
  | "sql"
  | "yaml"
  | "toml"
  | "powershell"
  | "batch"
  | "ruby"
  | "go"
  | "rust"
  | "java"
  | "c"
  | "cpp"
  | "csharp"
  | "php"
  | "perl"
  | "swift"
  | "kotlin"
  | "lua"
  | "docker"
  | "graphql"
  | "markdown"
  | "markup"
  | "css";

export interface ApprovalSyntaxSegment {
  language: ApprovalSyntaxLanguage;
  text: string;
}

const PRISM_LANGUAGE: Partial<Record<ApprovalSyntaxLanguage, string>> = {
  shell: "bash",
  python: "python",
  javascript: "javascript",
  typescript: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  json: "json",
  json5: "json5",
  diff: "diff",
  sql: "sql",
  yaml: "yaml",
  toml: "toml",
  powershell: "powershell",
  batch: "batch",
  ruby: "ruby",
  go: "go",
  rust: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
  csharp: "csharp",
  php: "php",
  perl: "perl",
  swift: "swift",
  kotlin: "kotlin",
  lua: "lua",
  docker: "docker",
  graphql: "graphql",
  markdown: "markdown",
  markup: "markup",
  css: "css",
};

const EXTENSION_LANGUAGE: Record<string, ApprovalSyntaxLanguage> = {
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  py: "python",
  pyw: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  json: "json",
  json5: "json5",
  diff: "diff",
  patch: "diff",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ps1: "powershell",
  bat: "batch",
  cmd: "batch",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  pl: "perl",
  pm: "perl",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  lua: "lua",
  graphql: "graphql",
  gql: "graphql",
  md: "markdown",
  mdx: "markdown",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  css: "css",
};

const INTERPRETER_LANGUAGE: Record<string, ApprovalSyntaxLanguage> = {
  python: "python",
  python2: "python",
  python3: "python",
  py: "python",
  node: "javascript",
  deno: "javascript",
  bun: "javascript",
  ruby: "ruby",
  perl: "perl",
  php: "php",
  lua: "lua",
  psql: "sql",
  sqlite: "sql",
  sqlite3: "sql",
  mysql: "sql",
  mariadb: "sql",
  pwsh: "powershell",
  powershell: "powershell",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
};

function normalizeExecutable(value: string): string {
  const basename =
    value.split(/[\\/]/).at(-1)?.toLowerCase() ?? value.toLowerCase();
  return basename
    .replace(/\.(?:exe|cmd|bat)$/i, "")
    .replace(/^python\d+(?:\.\d+)*$/, "python3");
}

function interpreterLanguage(
  executable: string,
): ApprovalSyntaxLanguage | undefined {
  return INTERPRETER_LANGUAGE[normalizeExecutable(executable)];
}

function languageFromDelimiter(
  delimiter: string,
): ApprovalSyntaxLanguage | undefined {
  const normalized = delimiter.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (/^(?:py|python|pythoncode)$/.test(normalized)) return "python";
  if (/^(?:js|javascript|node)$/.test(normalized)) return "javascript";
  if (/^(?:ts|typescript)$/.test(normalized)) return "typescript";
  if (/^(?:sh|shell|bash|zsh)$/.test(normalized)) return "shell";
  if (/^(?:sql|query)$/.test(normalized)) return "sql";
  if (
    /^(?:json|json5|yaml|yml|toml|graphql|gql|html|xml|css|md|markdown)$/.test(
      normalized,
    )
  ) {
    const aliases: Record<string, ApprovalSyntaxLanguage> = {
      yml: "yaml",
      gql: "graphql",
      html: "markup",
      xml: "markup",
      md: "markdown",
    };
    return aliases[normalized] ?? (normalized as ApprovalSyntaxLanguage);
  }
  return undefined;
}

function languageFromOutputPath(
  header: string,
): ApprovalSyntaxLanguage | undefined {
  const matches = Array.from(
    header.matchAll(/(?:>|tee(?:\s+-a)?)\s*['"]?([^\s'";|]+)['"]?/gi),
  );
  const path = matches.at(-1)?.[1];
  const extension = path?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return extension ? EXTENSION_LANGUAGE[extension] : undefined;
}

function languageFromHeredocHeader(
  header: string,
  delimiter: string,
): ApprovalSyntaxLanguage {
  const fromDelimiter = languageFromDelimiter(delimiter);
  if (fromDelimiter) return fromDelimiter;

  const executableMatches = Array.from(
    header.matchAll(/(?:^|[|;&]\s*|\s)([\w./+-]+)(?=\s|$)/g),
  );
  for (let i = executableMatches.length - 1; i >= 0; i -= 1) {
    const candidate = executableMatches[i]?.[1];
    if (!candidate) continue;
    const language = interpreterLanguage(candidate);
    if (language) return language;
  }

  return languageFromOutputPath(header) ?? "plain";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitHeredoc(command: string): ApprovalSyntaxSegment[] | null {
  const firstNewline = command.indexOf("\n");
  if (firstNewline < 0) return null;

  const header = command.slice(0, firstNewline);
  const marker = /<<-?\s*(['"]?)([A-Za-z_][\w.-]*)\1(?=\s|$)/.exec(header);
  if (!marker?.[2]) return null;

  const delimiter = marker[2];
  const remainder = command.slice(firstNewline + 1);
  const closingLine = new RegExp(
    `(^|\\n)(\\t*${escapeRegExp(delimiter)})(?=\\r?(?:\\n|$))`,
    "g",
  );
  let closingMatch: RegExpExecArray | null = null;
  for (
    let match = closingLine.exec(remainder);
    match;
    match = closingLine.exec(remainder)
  ) {
    closingMatch = match;
  }
  if (!closingMatch) return null;

  const prefixLength = closingMatch[1]?.length ?? 0;
  const closingStart = closingMatch.index + prefixLength;
  const language = languageFromHeredocHeader(header, delimiter);
  return [
    { language: "shell", text: command.slice(0, firstNewline + 1) },
    { language, text: remainder.slice(0, closingStart) },
    { language: "shell", text: remainder.slice(closingStart) },
  ];
}

function findClosingQuote(
  command: string,
  start: number,
  quote: string,
): number {
  for (let index = start + 1; index < command.length; index += 1) {
    if (command[index] !== quote) continue;
    if (quote === "'" || command[index - 1] !== "\\") return index;

    let slashCount = 0;
    for (
      let cursor = index - 1;
      cursor >= 0 && command[cursor] === "\\";
      cursor -= 1
    ) {
      slashCount += 1;
    }
    if (slashCount % 2 === 0) return index;
  }
  return -1;
}

function splitInlineScript(command: string): ApprovalSyntaxSegment[] | null {
  const matcher =
    /(?:^|[|;&]\s*|\s)([\w./+-]+)(?:\s+[^\n]*?)?\s+(--eval|-c|-e|-r|-command)\s+/gi;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(command))) {
    const executable = match[1];
    const flag = match[2]?.toLowerCase();
    const language = executable ? interpreterLanguage(executable) : undefined;
    if (!language) continue;
    if (flag === "-r" && language !== "php") continue;

    let quoteStart = matcher.lastIndex;
    if (
      command[quoteStart] === "$" &&
      /['"]/.test(command[quoteStart + 1] ?? "")
    ) {
      quoteStart += 1;
    }
    const quote = command[quoteStart];
    if (quote !== "'" && quote !== '"' && quote !== "`") continue;
    const quoteEnd = findClosingQuote(command, quoteStart, quote);
    if (quoteEnd < 0) continue;

    return [
      { language: "shell", text: command.slice(0, quoteStart + 1) },
      { language, text: command.slice(quoteStart + 1, quoteEnd) },
      { language: "shell", text: command.slice(quoteEnd) },
    ];
  }
  return null;
}

function standaloneLanguage(
  command: string,
  tool?: string,
): ApprovalSyntaxLanguage {
  const trimmed = command.trim();
  if (/^<[^>]+>\s+\(plugin approval rule\)$/i.test(trimmed)) return "plain";
  if (
    /^(?:\*\*\* Begin Patch|diff --git\s|Index:\s|---\s.+\n\+\+\+\s|@@\s)/m.test(
      trimmed,
    )
  ) {
    return "diff";
  }
  if (/^(?:<!doctype\s+html|<html\b|<svg\b|<\?xml\b)/i.test(trimmed))
    return "markup";
  if (/^(?:query|mutation|subscription|fragment)\s+[A-Za-z_(]/.test(trimmed))
    return "graphql";
  if (
    /^(?:FROM|ARG)\s+[^\n]+(?:\n|$)/.test(trimmed) &&
    /\b(?:RUN|COPY|CMD|ENTRYPOINT)\b/.test(trimmed)
  ) {
    return "docker";
  }
  if (
    /^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)\b/i.test(trimmed)
  )
    return "sql";

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // A shell command can legitimately start with '['; keep the shell fallback.
    }
  }

  if (
    tool &&
    /execute[_-]?code|python/i.test(tool) &&
    !/\b(?:execute_code|python)\b/.test(trimmed)
  ) {
    return "python";
  }
  return "shell";
}

/**
 * Split a reviewed command without changing a single source character.
 * Known embedded-script forms receive their own language grammar; uncertain
 * input stays Shell (or plain text for synthetic plugin labels).
 */
export function splitApprovalCommand(
  command: string,
  tool?: string,
): ApprovalSyntaxSegment[] {
  return (
    splitHeredoc(command) ??
    splitInlineScript(command) ?? [
      { language: standaloneLanguage(command, tool), text: command },
    ]
  );
}

function tokenClassNames(token: Prism.Token): string {
  const aliases = Array.isArray(token.alias)
    ? token.alias
    : token.alias
      ? [token.alias]
      : [];
  return ["token", token.type, ...aliases]
    .filter((value) => /^[a-z0-9_-]+$/i.test(value))
    .join(" ");
}

function renderTokenStream(stream: Prism.TokenStream, key: string): ReactNode {
  if (typeof stream === "string") return stream;
  if (Array.isArray(stream)) {
    return stream.map((token, index) =>
      renderTokenStream(token, `${key}-${index}`),
    );
  }
  return (
    <span key={key} className={tokenClassNames(stream)}>
      {renderTokenStream(stream.content, `${key}-content`)}
    </span>
  );
}

function HighlightedSegment({
  segment,
  index,
}: {
  segment: ApprovalSyntaxSegment;
  index: number;
}) {
  const prismName = PRISM_LANGUAGE[segment.language];
  if (!prismName) return segment.text;
  const grammar = Prism.languages[prismName];
  if (!grammar) return segment.text;

  try {
    return (
      <span data-language={segment.language}>
        {renderTokenStream(
          Prism.tokenize(segment.text, grammar),
          `segment-${index}`,
        )}
      </span>
    );
  } catch {
    return segment.text;
  }
}

export function ApprovalCode({
  command,
  tool,
}: {
  command: string;
  tool?: string;
}) {
  const segments = useMemo(
    () => splitApprovalCommand(command, tool),
    [command, tool],
  );
  const languages = Array.from(
    new Set(segments.map((segment) => segment.language)),
  ).join(" ");
  return (
    <code data-approval-code data-languages={languages}>
      {segments.map((segment, index) => (
        <HighlightedSegment
          // Segment indices are stable for a given immutable approval payload.
          key={`${index}-${segment.language}`}
          segment={segment}
          index={index}
        />
      ))}
    </code>
  );
}

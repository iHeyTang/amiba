// Material Icon Theme 5.38.1, MIT. SVGs are imported individually: no theme
// runtime, complete manifest, remote fetches, or whole-directory icon glob.
// See apps/desktop/resources/licenses/material-icon-theme.txt.
import type { AttachmentKind } from "@amiba/app-runtime/core";
import typescript from "material-icon-theme/icons/typescript.svg";
import javascript from "material-icon-theme/icons/javascript.svg";
import python from "material-icon-theme/icons/python.svg";
import markdown from "material-icon-theme/icons/markdown.svg";
import react from "material-icon-theme/icons/react.svg";
import react_ts from "material-icon-theme/icons/react_ts.svg";
import pdf from "material-icon-theme/icons/pdf.svg";
import file from "material-icon-theme/icons/file.svg";
import folder from "material-icon-theme/icons/folder.svg";
import folder_open from "material-icon-theme/icons/folder-open.svg";
import json from "material-icon-theme/icons/json.svg";
import yaml from "material-icon-theme/icons/yaml.svg";
import html from "material-icon-theme/icons/html.svg";
import css from "material-icon-theme/icons/css.svg";
import sass from "material-icon-theme/icons/sass.svg";
import less from "material-icon-theme/icons/less.svg";
import xml from "material-icon-theme/icons/xml.svg";
import zip from "material-icon-theme/icons/zip.svg";
import word from "material-icon-theme/icons/word.svg";
import powerpoint from "material-icon-theme/icons/powerpoint.svg";
import table from "material-icon-theme/icons/table.svg";
import image from "material-icon-theme/icons/image.svg";
import video from "material-icon-theme/icons/video.svg";
import audio from "material-icon-theme/icons/audio.svg";
import console from "material-icon-theme/icons/console.svg";
import java from "material-icon-theme/icons/java.svg";
import go from "material-icon-theme/icons/go.svg";
import rust from "material-icon-theme/icons/rust.svg";
import c from "material-icon-theme/icons/c.svg";
import cpp from "material-icon-theme/icons/cpp.svg";
import csharp from "material-icon-theme/icons/csharp.svg";
import vue from "material-icon-theme/icons/vue.svg";
import svelte from "material-icon-theme/icons/svelte.svg";
import docker from "material-icon-theme/icons/docker.svg";
import git from "material-icon-theme/icons/git.svg";
import nodejs from "material-icon-theme/icons/nodejs.svg";
import settings from "material-icon-theme/icons/settings.svg";

const icons = {
  typescript,
  javascript,
  python,
  markdown,
  react,
  react_ts,
  pdf,
  file,
  folder,
  folder_open,
  json,
  yaml,
  html,
  css,
  sass,
  less,
  xml,
  zip,
  word,
  powerpoint,
  table,
  image,
  video,
  audio,
  console,
  java,
  go,
  rust,
  c,
  cpp,
  csharp,
  vue,
  svelte,
  docker,
  git,
  nodejs,
  settings,
};
type IconName = keyof typeof icons;
const extensions: Readonly<Record<string, IconName>> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "react_ts",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "react",
  py: "python",
  pyi: "python",
  pyw: "python",
  ipynb: "python",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  json: "json",
  jsonc: "json",
  jsonl: "json",
  yaml: "yaml",
  yml: "yaml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "sass",
  sass: "sass",
  less: "less",
  xml: "xml",
  svg: "image",
  vue: "vue",
  svelte: "svelte",
  sh: "console",
  bash: "console",
  zsh: "console",
  fish: "console",
  ps1: "console",
  bat: "console",
  cmd: "console",
  java: "java",
  go: "go",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  pdf: "pdf",
  doc: "word",
  docx: "word",
  ppt: "powerpoint",
  pptx: "powerpoint",
  xls: "table",
  xlsx: "table",
  csv: "table",
  tsv: "table",
  zip: "zip",
  gz: "zip",
  tgz: "zip",
  tar: "zip",
  bz2: "zip",
  xz: "zip",
  rar: "zip",
  "7z": "zip",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  heic: "image",
  ico: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  ogg: "audio",
  m4a: "audio",
  toml: "settings",
  ini: "settings",
  conf: "settings",
  env: "settings",
};
const filenames: Readonly<Record<string, IconName>> = {
  "package.json": "nodejs",
  "package-lock.json": "nodejs",
  "pnpm-lock.yaml": "nodejs",
  "yarn.lock": "nodejs",
  dockerfile: "docker",
  containerfile: "docker",
  "docker-compose.yml": "docker",
  "docker-compose.yaml": "docker",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".gitmodules": "git",
  ".env": "settings",
};

/** Filename rules precede extensions; unknown types keep a neutral fallback. */
export function resolveFileIcon(name: string, kind?: AttachmentKind): IconName {
  const basename = name.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const exact = Object.hasOwn(filenames, basename)
    ? filenames[basename]
    : undefined;
  if (exact) return exact;
  if (basename.startsWith(".env.")) return "settings";
  if (basename.startsWith("dockerfile.")) return "docker";
  const extension = basename.includes(".") ? basename.split(".").pop()! : "";
  return (
    (Object.hasOwn(extensions, extension)
      ? extensions[extension]
      : undefined) ??
    (kind === "image" ? "image" : kind === "pdf" ? "pdf" : "file")
  );
}

/** Decorative file/folder artwork; the adjacent filename supplies its label. */
export function FileTypeIcon({
  name,
  kind,
  directory = false,
  expanded = false,
  className,
}: {
  name: string;
  kind?: AttachmentKind;
  directory?: boolean;
  expanded?: boolean;
  className?: string;
}) {
  const icon = directory
    ? expanded
      ? "folder_open"
      : "folder"
    : resolveFileIcon(name, kind);
  return (
    <img
      src={icons[icon]}
      alt=""
      aria-hidden
      draggable={false}
      data-file-icon={icon}
      className={className}
    />
  );
}

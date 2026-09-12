import {
  Component,
  createContext,
  useContext,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  Streamdown,
  defaultRemarkPlugins,
  defaultRehypePlugins,
  type Components,
  type StreamdownProps,
} from "streamdown";

// Streamdown 2.5 caches processors by plugin function names. Names are not
// identities (especially after minification or HMR); add an inert cache key
// without wrapping/replacing plugin functions or changing Unified's dedup rules.
const identityKey = Symbol.for("@amiba/markdown/pipeline-identities");
const identityGlobal = globalThis as typeof globalThis & {
  [identityKey]?: {next:number;entries:WeakMap<object,number>};
};
const pipelineIdentities = identityGlobal[identityKey] ??= {next:0,entries:new WeakMap()};
function identifyPipeline(plugins:NonNullable<StreamdownProps["remarkPlugins"]>, revision:string, implicit:unknown[] = []):NonNullable<StreamdownProps["remarkPlugins"]> {
  // Separate attacher identities prevent Unified merging remark/rehype key options.
  function amibaMarkdownPipelineIdentity() {}
  const identity = (value:unknown) => {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") return value;
    const object = value as object;
    let id = pipelineIdentities.entries.get(object);
    if (id === undefined) {id = ++pipelineIdentities.next;pipelineIdentities.entries.set(object,id);}
    return id;
  };
  return [[amibaMarkdownPipelineIdentity,{items:plugins.map(identity),revision,implicit:implicit.map(identity)}],...plugins];
}

export const MARKDOWN_SLOT = "amiba.markdown.extension";
/** Rendering configuration is typed directly from Streamdown, without custom props. */
export type MarkdownExtension = Pick<
  StreamdownProps,
  | "components"
  | "plugins"
  | "remarkPlugins"
  | "rehypePlugins"
  | "allowedTags"
  | "literalTagContent"
> & {
  id: string;
  version: string;
  /** Lower numbers win; ties are resolved by id. */
  order?: number;
};
export interface MarkdownCapabilities {
  id: string;
  version: string;
  languages: string[];
}
export function resolveMarkdownExtensions(
  entries: readonly MarkdownExtension[],
) {
  const sorted = [...entries].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
  );
  const components: Components = {};
  const plugins: NonNullable<StreamdownProps["plugins"]> = {};
  const owners = new Map<string, MarkdownExtension>();
  const renderers: NonNullable<
    NonNullable<StreamdownProps["plugins"]>["renderers"]
  > = [];
  for (const extension of sorted) {
    for (const [name, renderer] of Object.entries(extension.components ?? {}))
      if (components[name] === undefined) components[name] = renderer;
    for (const key of ["code", "math", "cjk", "mermaid"] as const) {
      if (!plugins[key] && extension.plugins?.[key])
        Object.assign(plugins, { [key]: extension.plugins[key] });
    }
    for (const renderer of extension.plugins?.renderers ?? []) {
      const languages = (
        Array.isArray(renderer.language)
          ? renderer.language
          : [renderer.language]
      ).filter((language) => {
        if (owners.has(language)) return false;
        owners.set(language, extension);
        return true;
      });
      if (languages.length)
        renderers.push({ ...renderer, language: languages });
    }
  }
  if (renderers.length) plugins.renderers = renderers;
  const capabilities = sorted
    .map((extension) => ({
      id: extension.id,
      version: extension.version,
      languages: [...owners]
        .filter(([, owner]) => owner === extension)
        .map(([language]) => language),
    }))
    .filter(
      (entry, index) =>
        entry.languages.length ||
        sorted[index].remarkPlugins?.length ||
        sorted[index].rehypePlugins?.length ||
        Object.keys(sorted[index].allowedTags ?? {}).length,
    );
  return { sorted, components, plugins, capabilities };
}
const EMPTY: readonly MarkdownExtension[] = [];
const Extensions = createContext(EMPTY);
const PrepareTurn = createContext<(sessionId: string) => Promise<void>>(
  async () => {},
);
export function usePrepareMarkdownTurn() {
  return useContext(PrepareTurn);
}
export function MarkdownProvider({
  extensions,
  children,
  report,
}: {
  extensions: readonly MarkdownExtension[];
  children: ReactNode;
  report?: (
    sessionId: string,
    capabilities: MarkdownCapabilities[],
  ) => Promise<void>;
}) {
  const session = useRef<string>();
  const prepare = useMemo(
    () => async (sessionId: string) => {
      session.current = sessionId;
      await report?.(
        sessionId,
        resolveMarkdownExtensions(extensions).capabilities,
      );
    },
    [extensions, report],
  );
  useEffect(() => {
    if (session.current) void prepare(session.current).catch(() => {});
  }, [prepare]);
  return (
    <Extensions.Provider value={extensions}>
      <PrepareTurn.Provider value={prepare}>{children}</PrepareTurn.Provider>
    </Extensions.Provider>
  );
}
export function useMarkdownCapabilities() {
  const extensions = useContext(Extensions);
  return useMemo(
    () => resolveMarkdownExtensions(extensions).capabilities,
    [extensions],
  );
}
class RenderBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; resetKey?: unknown },
  { failed: boolean; resetKey?: unknown }
> {
  state: { failed: boolean; resetKey?: unknown } = { failed: false };
  static getDerivedStateFromProps(
    props: { resetKey?: unknown },
    state: { resetKey?: unknown },
  ) {
    return props.resetKey !== state.resetKey
      ? { failed: false, resetKey: props.resetKey }
      : null;
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
/** Merge plugin contributions; Streamdown owns all syntax and code dispatch. */
export function ChatMarkdown(input: StreamdownProps) {
  // Carry the shared typography/code chrome into every host, including workbench plugins.
  const props = { ...input, className: ["chat-md", input.className].filter(Boolean).join(" ") };
  const extensions = useContext(Extensions);
  const resolved = useMemo(
    () => resolveMarkdownExtensions(extensions),
    [extensions],
  );
  const options = useMemo(() => {
    const plugins = { ...props.plugins, ...resolved.plugins };
    const renderers = [
      ...(resolved.plugins.renderers ?? []),
      ...(props.plugins?.renderers ?? []),
    ];
    const claimed = new Set<string>();
    if (renderers.length)
      plugins.renderers = renderers.flatMap((renderer) => {
        const language = (
          Array.isArray(renderer.language)
            ? renderer.language
            : [renderer.language]
        ).filter((value) => {
          if (claimed.has(value)) return false;
          claimed.add(value);
          return true;
        });
        if (!language.length) return [];
        const Renderer = renderer.component;
        return [
          {
            ...renderer,
            language,
            component: (
              rendererProps: import("streamdown").CustomRendererProps,
            ) => (
              <RenderBoundary
                resetKey={rendererProps.code}
                fallback={
                  <pre>
                    <code>{rendererProps.code}</code>
                  </pre>
                }
              >
                <Renderer {...rendererProps} />
              </RenderBoundary>
            ),
          },
        ];
      });
    return {
      components: { ...props.components, ...resolved.components },
      plugins,
      allowedTags: Object.assign(
        {},
        props.allowedTags,
        ...[...resolved.sorted].reverse().map((e) => e.allowedTags ?? {}),
      ),
      literalTagContent: [
        ...new Set([
          ...(props.literalTagContent ?? []),
          ...resolved.sorted.flatMap((e) => e.literalTagContent ?? []),
        ]),
      ],
    };
  }, [
    resolved,
    props.components,
    props.plugins,
    props.allowedTags,
    props.literalTagContent,
  ]);
  const remark = resolved.sorted.flatMap((e) => e.remarkPlugins ?? []);
  const rehype = resolved.sorted.flatMap((e) => e.rehypePlugins ?? []);
  const revision = JSON.stringify(resolved.sorted.map(e=>[e.id,e.version]));
  const remarkPipeline = identifyPipeline([
    ...(props.remarkPlugins ?? Object.values(defaultRemarkPlugins)), ...remark,
  ], revision, [options.plugins.math, options.plugins.cjk]);
  const rehypePipeline = identifyPipeline([
    ...rehype, ...(props.rehypePlugins ?? Object.values(defaultRehypePlugins)),
  ], revision, [options.plugins.math, options.plugins.cjk]);
  // Streamdown also memoizes rendered output; refresh it when a processor changes.
  const pipelineKey = JSON.stringify([remarkPipeline[0],rehypePipeline[0]]);

  return (
    <RenderBoundary
      key={pipelineKey}
      resetKey={props.children}
      fallback={<Streamdown {...props}
        remarkPlugins={identifyPipeline(props.remarkPlugins ?? Object.values(defaultRemarkPlugins), "fallback", [props.plugins?.math,props.plugins?.cjk])}
        rehypePlugins={identifyPipeline(props.rehypePlugins ?? Object.values(defaultRehypePlugins), "fallback", [props.plugins?.math,props.plugins?.cjk])}
      />}
    >
      <Streamdown
        {...props}
        {...options}
        remarkPlugins={remarkPipeline}
        rehypePlugins={rehypePipeline}
      />
    </RenderBoundary>
  );
}

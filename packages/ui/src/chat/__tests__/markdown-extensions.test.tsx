import {
  Streamdown,
  useIsCodeFenceIncomplete,
  type Components,
  type StreamdownProps,
} from "streamdown";
import { defaultMarkdown } from "../../../../../plugins/dsh-plugin-markdown/src/client/defaults";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  ChatMarkdown,
  usePrepareMarkdownTurn,
  MarkdownProvider,
  resolveMarkdownExtensions,
  type MarkdownExtension,
} from "@amiba/markdown";
const document = '```chart\n{"value":12}\n```';
const chart: MarkdownExtension = {
  id: "chart",
  version: "1",
  plugins: {
    renderers: [
      {
        language: "chart",
        component: ({ code, isIncomplete }) =>
          isIncomplete ? (
            <pre>{code}</pre>
          ) : (
            <output>{JSON.parse(code).value}</output>
          ),
      },
    ],
  },
};
it("preserves native renderer dispatch under the default pre wrapper and falls back after unload", () => {
  const extensions = [defaultMarkdown, chart];
  const view = render(
    <MarkdownProvider extensions={extensions}>
      <ChatMarkdown>{document}</ChatMarkdown>
    </MarkdownProvider>,
  );
  expect(screen.getByText("12")).toBeTruthy();
  view.rerender(
    <MarkdownProvider extensions={[]}>
      <ChatMarkdown>{document}</ChatMarkdown>
    </MarkdownProvider>,
  );
  expect(screen.getByText('{"value":12}')).toBeTruthy();
});
it("resolves conflicts deterministically and advertises only winning languages", () => {
  const shadow = { ...chart, id: "aaa", order: -1 };
  const a = resolveMarkdownExtensions([chart, shadow]);
  const b = resolveMarkdownExtensions([shadow, chart]);
  expect(a.capabilities).toEqual(b.capabilities);
  expect(a.capabilities.map((c) => c.id)).toEqual(["aaa"]);
});
it("isolates a malformed custom fence and keeps the rest of the message", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <MarkdownProvider extensions={[chart]}>
      <ChatMarkdown>{"```chart\nbad-json\n```\n\nstill here"}</ChatMarkdown>
    </MarkdownProvider>,
  );
  expect(screen.getByText("bad-json")).toBeTruthy();
  expect(screen.getByText("still here")).toBeTruthy();
  log.mockRestore();
});
it("overrides tables without disabling GFM when a remark extension is installed", () => {
  const ext: MarkdownExtension = {
    id: "table",
    version: "1",
    components: {
      table: ({ children }) => (
        <table aria-label="custom table">{children}</table>
      ),
    },
    remarkPlugins: [() => () => {}],
  };
  render(
    <MarkdownProvider extensions={[ext]}>
      <ChatMarkdown>{"| A | B |\n| - | - |\n| 1 | 2 |"}</ChatMarkdown>
    </MarkdownProvider>,
  );
  expect(screen.getByRole("table", { name: "custom table" })).toBeTruthy();
});
it("retains native Streamdown custom renderers", () => {
  const plugins = {
    renderers: [
      {
        language: "native",
        component: ({ code }: { code: string }) => (
          <output>native: {code}</output>
        ),
      },
    ],
  };
  render(
    <ChatMarkdown plugins={plugins}>{"```native\nhello\n```"}</ChatMarkdown>,
  );
  expect(screen.getByText(/native: hello/)).toBeTruthy();
});
it("lets the native renderer decide how to handle incomplete content", async () => {
  const view = render(
    <MarkdownProvider extensions={[chart]}>
      <ChatMarkdown isAnimating>{'```chart\n{"value":'}</ChatMarkdown>
    </MarkdownProvider>,
  );
  expect(view.container.querySelector("output")).toBeNull();
  view.rerender(
    <MarkdownProvider extensions={[chart]}>
      <ChatMarkdown>{document}</ChatMarkdown>
    </MarkdownProvider>,
  );
  expect(await screen.findByText("12")).toBeTruthy();
});
it("reports active capabilities before continuing a turn and refreshes after disable", async () => {
  let release!: () => void;
  const report = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  let submitted = false;
  function Sender() {
    const prepare = usePrepareMarkdownTurn();
    return (
      <button
        onClick={async () => {
          await prepare("session-one");
          submitted = true;
        }}
      >
        send
      </button>
    );
  }
  const view = render(
    <MarkdownProvider extensions={[chart]} report={report}>
      <Sender />
    </MarkdownProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "send" }));
  expect(report).toHaveBeenCalledWith(
    "session-one",
    expect.arrayContaining([expect.objectContaining({ languages: ["chart"] })]),
  );
  expect(submitted).toBe(false);
  await act(async () => release());
  expect(submitted).toBe(true);
  view.rerender(
    <MarkdownProvider extensions={[]} report={report}>
      <Sender />
    </MarkdownProvider>,
  );
  expect(report).toHaveBeenLastCalledWith("session-one", []);
});
it("uses the same node-override priority for ordinary code and tables", () => {
  const extensions: MarkdownExtension[] = [
    {
      id: "default",
      version: "1",
      order: 1000,
      components: {
        code: () => <div>default code</div>,
        table: () => <div>default table</div>,
      },
    },
    {
      id: "override",
      version: "1",
      components: {
        code: ({ children }) => <output>custom: {children}</output>,
        table: () => <div>custom table</div>,
      },
    },
  ];
  render(
    <MarkdownProvider extensions={extensions}>
      <ChatMarkdown mode="static">
        {"```text\nhello\n```\n\n| A |\n| - |\n| B |"}
      </ChatMarkdown>
    </MarkdownProvider>,
  );
  expect(screen.getByText(/custom: hello/)).toBeTruthy();
  expect(screen.getByText("custom table")).toBeTruthy();
  expect(screen.queryByText("default code")).toBeNull();
  expect(screen.queryByText("default table")).toBeNull();
});

it("passes native node props unchanged, including explicit code/pre overrides", () => {
  const components: Components = {
    pre: ({ children, node }) => (
      <section data-node={node?.tagName}>{children}</section>
    ),
    code: ({ children, className, node }) => (
      <output data-node={node?.tagName} className={className}>
        {children}
      </output>
    ),
  };
  const plugins: StreamdownProps["plugins"] = {
    renderers: [{ language: "chart", component: () => <b>renderer</b> }],
  };
  const native = render(
    <Streamdown className="chat-md" mode="static" components={components} plugins={plugins}>
      {document}
    </Streamdown>,
  );
  const expected = native.container.innerHTML;
  native.unmount();
  const hosted = render(
    <MarkdownProvider
      extensions={[{ id: "native", version: "1", components, plugins }]}
    >
      <ChatMarkdown mode="static">{document}</ChatMarkdown>
    </MarkdownProvider>,
  );
  expect(hosted.container.innerHTML).toBe(expected);
  expect(screen.queryByText("renderer")).toBeNull();
});

it("preserves native renderer metadata, language aliases and streaming context", () => {
  const plugins: NonNullable<StreamdownProps["plugins"]> = {
    renderers: [
      {
        language: ["chart", "plot"],
        component: (props) => (
          <output>
            {JSON.stringify({ ...props, hook: useIsCodeFenceIncomplete() })}
          </output>
        ),
      },
    ],
  };
  for (const source of [
    '```plot title="Example"\npartial',
    '```chart title="Example"\ncomplete\n```',
  ]) {
    const native = render(
      <Streamdown plugins={plugins} isAnimating>
        {source}
      </Streamdown>,
    );
    const expected = native.container.textContent;
    native.unmount();
    const hosted = render(
      <MarkdownProvider extensions={[{ id: "native", version: "1", plugins }]}>
        <ChatMarkdown isAnimating>{source}</ChatMarkdown>
      </MarkdownProvider>,
    );
    expect(hosted.container.textContent).toBe(expected);
    hosted.unmount();
  }
});

it("keeps extension precedence over a colliding caller renderer", () => {
  render(
    <MarkdownProvider extensions={[chart]}>
      <ChatMarkdown
        plugins={{
          renderers: [
            { language: "chart", component: () => <output>shadow</output> },
          ],
        }}
      >
        {document}
      </ChatMarkdown>
    </MarkdownProvider>,
  );
  expect(screen.getByText("12")).toBeTruthy();
  expect(screen.queryByText("shadow")).toBeNull();
});
it("renders media delivery fences through the real markdown extension pipeline", async () => {
  const { mediaMarkdown } = await import('../../../../../plugins/dsh-plugin-media/src/client/delivery');
  const api = { inspect: vi.fn().mockResolvedValue({ ok: true, value: { id: 'record', sessionId: 'session', status: 'failed', artifacts: [], error: 'Fixture media result' } }) };
  render(<MarkdownProvider extensions={[defaultMarkdown, mediaMarkdown(api as never)]}><ChatMarkdown>{'```amiba-media\n{"sessionId":"session","recordId":"record"}\n```'}</ChatMarkdown></MarkdownProvider>);
  expect(await screen.findByText('Fixture media result')).toBeTruthy();
  expect(api.inspect).toHaveBeenCalledWith('session', 'record');
});

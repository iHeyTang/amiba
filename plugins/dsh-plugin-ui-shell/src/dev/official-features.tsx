import "../../../../packages/ui/src/styles/surfaces.css";
import "../client/official-theme.css";
import "../client/official-deliverables.css";
import { installAmibaMessageCatalog } from "../client/messages";
import { JobsAction } from "../client/official-features/jobs";
import { WorkflowRun } from "../client/official-features/workflow";
import { apply as jobs } from "@deepseek-ai/dsh-client-ui-jobs/client";
import { apply as workflow } from "@deepseek-ai/dsh-client-ui-workflow-run/client";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";
import { MessageTurns, PaneHeaderBar } from "@amiba/ui";
import { commandTimelineRows } from "../client/command-rows";
/** Local visual fixture: the production adapters with deterministic state; no Host writes. */
import { useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import type { Context } from "@deepseek-ai/cordis";
import { apply as plan } from "@deepseek-ai/dsh-client-ui-plan/client";
import { apply as feedback } from "@deepseek-ai/dsh-client-ui-message-feedback/client";
import { apply as goal } from "@deepseek-ai/dsh-client-ui-goal/client";
import { apply as subagent } from "@deepseek-ai/dsh-client-ui-subagent/client";
import { mountOfficialFeature } from "../client/official-features/mount";
import {
  FeedbackActions,
  FeedbackDialog,
} from "../client/official-features/feedback";
import { GoalDock } from "../client/official-features/goal";
import {
  SubagentLineage,
  SubagentReadOnly,
} from "../client/official-features/subagent";
import { Button, Popover, PopoverTrigger, PopoverContent, Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "@amiba/ui/primitives";
import "./surfaces.css";
installAmibaMessageCatalog();
setPlatform({ storage: { get: async () => ({}), set: async () => {}, remove: async () => {}, watch: () => () => {} } } as unknown as PlatformAdapter);
const dictionaries: Record<string, Record<string, string>> = {};
let Plan!: ComponentType<Record<string, unknown>>;
const common = { close: "关闭", submit: "提交", submitting: "正在提交" };
const translate =
  (namespace: string) =>
  (key: string, values: Record<string, unknown> = {}) =>
    Object.entries(values).reduce(
      (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
      dictionaries[namespace]?.[key] ??
        common[key as keyof typeof common] ??
        key,
    );
for (const [feature, apply] of [
  ["jobs", jobs],
  ["workflow", workflow],
  ["plan", plan],
  ["feedback", feedback],
  ["goal", goal],
  ["subagent", subagent],
] as const) {
  const context = {
    slots: {
      inject: (_name: string, callback: () => void) => callback(),
      register: (
        options: { name: string },
        component: ComponentType<Record<string, unknown>>,
      ) => {
        if (options.name === "conversation.input.plan") Plan = component;
        return () => {};
      },
    },
    locale: {
      register: (namespace: string, dict: { zh: Record<string, string> }) => {
        dictionaries[namespace] = dict.zh;
        return () => {};
      },
    },
    effect: (callback: () => unknown) => callback(),
    on: () => () => {},
    inject: () => {},
    sessions: {},
    remote: {},
    uiConversation: { events: { register: () => {} } },
  };
  mountOfficialFeature(context as unknown as Context, feature, apply);
}
function Preview() {
  const [phase, setPhase] = useState("active");
  const [objective, setObjective] = useState(
    "完成工作区体验优化，验证桌面与插件兼容性",
  );
  const [planning, setPlanning] = useState(true);
  const [dialog, setDialog] = useState({
    target: null as null | {
      kind: "message";
      messageId: string;
      rating: string;
    },
    category: null as string | null,
    text: "",
    failure: null,
    submitting: false,
    toast: 0,
  });
  const [rating, setRating] = useState<string>();
  const sessions = {
    ids: ["root", "child"],
    jobsBySession: { root: [{ id: "build", label: "验证工作区构建", kind: "process", status: "running", startedAt: Date.now() - 12000 }, { id: "old", label: "检查依赖", kind: "process", status: "failed", startedAt: 0, finishedAt: 4200, detail: "依赖版本不匹配，请查看执行记录。" }] },
    byId: { root: { id: "root" } },
    subagentsByParent: {
      root: {
        state: "ready",
        entries: [
          {
            kind: "child",
            id: "worker",
            label: "检查插槽兼容性",
            mode: "one-shot",
            activity: "running",
            hasChildren: false,
          },
          {
            kind: "child",
            id: "review",
            label: "界面回归检查",
            mode: "continuable",
            activity: "inactive",
            hasChildren: false,
          },
        ],
      },
    },
  };
  const [opened, setOpened] = useState("");
  const ok = async () => ({ ok: true as const, value: undefined });
  return (
    <main className="mx-auto max-w-3xl space-y-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">官方功能 · Amiba 界面</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            本地交互样例，不连接真实会话
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            (document.documentElement.className =
              document.documentElement.classList.contains("dark")
                ? "light"
                : "dark")
          }
        >
          切换明暗
        </Button>
      </header>
      <section className="relative rounded-2xl p-6" style={{ background: "repeating-linear-gradient(125deg, #c7b5b9 0px, #716d80 45px, #e1cac0 100px)" }}>
        <p className="mb-4 text-sm">背景内容可读性测试：查看飞书界面内容 · 工作空间 · 对话记录</p>
        <div className="flex gap-3">
          <Popover><PopoverTrigger asChild><Button variant="outline">预览个人菜单玻璃</Button></PopoverTrigger>
            <PopoverContent align="start"><div className="space-y-3 p-2"><strong>我的空间</strong><p className="text-sm text-muted-foreground">编辑个人资料</p><hr /><button className="block w-full rounded-lg p-2 text-left hover:bg-muted/70">设置</button><p className="p-2 text-sm">GitHub</p><hr /><p className="text-sm text-muted-foreground">当前版本 v0.1.12</p></div></PopoverContent>
          </Popover>
          <Dialog><DialogTrigger asChild><Button variant="outline">预览设置窗口玻璃</Button></DialogTrigger>
            <DialogContent size="lg"><PaneHeaderBar leading={<DialogTitle>设置</DialogTitle>} /><DialogDescription>检查背景复杂时的文字可读性</DialogDescription><div data-settings-view className="flex min-h-64 gap-6 rounded-lg bg-background"><aside className="w-28 rounded-lg bg-muted/30 p-3 text-sm">个人<br /><br />外观<br /><br />插件</aside><div data-settings-page className="flex-1 space-y-4 bg-background py-3"><h3>插件清单</h3><p className="text-sm text-muted-foreground">查看所有插件包的来源、运行状态和可用操作。</p><div className="amiba-card-surface overflow-hidden rounded-xl border border-border/70 bg-background text-sm"><div className="bg-background p-4">默认模型 <span className="float-right">DeepSeek</span></div><div className="border-t border-border/60 bg-background px-4 pb-3 pt-3">视觉识别</div><p className="px-4 pb-3 text-xs text-muted-foreground">主模型看不到图片时，由视觉模型识别。</p><div className="border-t border-border/60 px-4 py-3 text-right text-xs">刷新能力</div></div></div></div></DialogContent>
          </Dialog>
        </div>
      </section>
      <section className="amiba-background-frame" data-background-active="false">
        <div data-amiba-product-shell className="space-y-4 rounded-xl bg-background p-4">
          <div className="flex items-center justify-between gap-4"><div data-content-header-leading data-header-glass className="relative flex h-8 items-center text-sm">创建 Amiba 功能与场景子代理</div><div data-content-header-actions className="relative flex h-8 items-center gap-3 text-sm"><button>会话记录</button><button>2 个后台任务</button></div></div>
          <div className="amiba-card-surface rounded-lg border bg-muted p-4 text-sm">无壁纸：已有底色的容器使用色差分层</div>
        </div>
      </section>
      <section className="nyYjTG_root flex gap-3 rounded-xl bg-muted/30 p-4" aria-label="文件打开按钮样式预览">
        {["生成式AI实战指南.pptx", "make_ppt_detail.py"].map(name => <div key={name} className="nyYjTG_file flex flex-1 items-center justify-between gap-3 border"><span className="truncate text-sm">{name}</span><div className="nyYjTG_split inline-flex overflow-hidden border"><button className="nyYjTG_open px-2 py-1">打开</button><button aria-label={`${name} 的更多操作`} className="nyYjTG_chevron border-l px-2 py-1">⌄</button></div></div>)}
      </section>
      <section data-amiba-product-shell className="space-y-4 rounded-2xl p-6" style={{ background: "repeating-linear-gradient(125deg, #c7b5b9 0px, #716d80 45px, #e1cac0 100px)" }}>
        <p data-home-greeting className="text-center text-sm">今天想一起做点什么？</p>
        <div>
          <div data-composer-context-rail className="mx-4 -mb-2 rounded-t-2xl border border-b-0 bg-muted/45 px-4 pb-4 pt-2 text-sm"><button data-workspace-chip className="rounded-full px-2.5 py-1 text-xs">workspace</button></div>
          <div data-composer-card className="relative rounded-2xl border p-4 text-sm text-muted-foreground">向 Amiba 提问…</div>
        </div>
        <div data-composer-stats className="flex justify-center gap-4">
          <button className="text-xs text-muted-foreground">13,673 tok · 缓存命中 93.42%</button>
          <button className="text-xs text-muted-foreground">1 轮 1 步</button>
        </div>
      </section>
      <section className="space-y-2 rounded-2xl bg-background/65 p-4">
        <div className="flex justify-end"><JobsAction {...{ sessionId: "root", useSessions: (select: any) => select(sessions), t: translate("job") } as any} /></div>
        <WorkflowRun {...{ sessionId: "root", useSessions: (select: any) => select(sessions), openSession: () => {}, t: translate("workflowRun"), node: { key: "preview-run", data: { name: "检查工作区兼容性", status: "running", phases: [{ key: "audit", phase: "并行检查", members: [{ seq: 1, label: "检查插件插槽", childId: "child", status: "running" }, { seq: 2, label: "验证消息流布局", childId: "done", status: "completed" }] }] } } } as any} />
      </section>
      <section className="space-y-3 rounded-2xl border border-border p-5">
        <div className="flex items-center justify-between">
          <span>工作区体验优化</span>
          <SubagentLineage
            {...({
              lineageSessionId: "root",
              displayTitle: "工作区体验优化",
              useSessions: (select: (state: unknown) => unknown) =>
                select(sessions),
              openChild: (address: { childSessionId: string }) =>
                setOpened(address.childSessionId),
              refresh: () => {},
              setCatalogOpen: () => {},
              t: translate("subagent"),
            } as unknown as Parameters<typeof SubagentLineage>[0])}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          已检查默认插槽的注册与卸载路径，接下来验证交互和错误状态。
        </p>
        <FeedbackActions
          {...({
            messageId: "m1",
            ensure: ok,
            current: () => (rating ? { rating } : undefined),
            retract: async () => {
              setRating(undefined);
              return ok();
            },
            openDialog: (messageId: string, next: string) =>
              setDialog({
                target: { kind: "message", messageId, rating: next },
                category: null,
                text: "",
                failure: null,
                submitting: false,
                toast: 0,
              }),
            useFeedback: (select: (state: unknown) => unknown) =>
              select({
                status: "ready",
                items: new Map(rating ? [["m1", { rating }]] : []),
              }),
            t: translate("feedback"),
          } as unknown as Parameters<typeof FeedbackActions>[0])}
        />
      </section>
      <section className="space-y-3 rounded-2xl border border-border p-4">
        <MessageTurns assistantActions={() => <FeedbackActions {...({ messageId: "preview-answer", ensure: async () => ({ ok: true }), current: () => undefined, retract: async () => ({ ok: true }), openDialog: () => {}, useFeedback: (select: (state: unknown) => unknown) => select({ items: new Map(), status: "ready" }), t: translate("feedback") } as unknown as Parameters<typeof FeedbackActions>[0])} />} messages={[{ uiId: "preview-answer", role: "assistant", content: "上一轮回复已结束。", runtimeSeq: 1, assistantMessageId: "preview-answer", sentAt: 1700000000000, tokenUsage: { outputTokens: 355 } }]} timelineRows={commandTimelineRows({ chat: { order: ["preview-goal"], nodes: new Map([["preview-goal", { key: "preview-goal", kind: "command-input", visibility: "visible", anchorSeq: 2, data: { text: "/goal 完成工作区体验优化" } }]]) } } as never, [], () => null)} />
        <GoalDock
          {...({
            useProjection: () => ({
              goal: { id: "g1", revision: 1, phase, objective },
            }),
            useGoalActivation: (select: (state: unknown) => unknown) =>
              select({ id: "g1", revision: 1, activation: "armed" }),
            onPause: async () => {
              setPhase("paused");
              return ok();
            },
            onResume: async () => {
              setPhase("active");
              return ok();
            },
            onEdit: async (text: string) => {
              setObjective(text);
              return ok();
            },
            onClear: ok,
            t: translate("goal"),
          } as unknown as Parameters<typeof GoalDock>[0])}
        />
        <textarea
          placeholder="输入消息…"
          className="min-h-20 w-full resize-none bg-transparent p-2 text-sm outline-none"
        />
        <Plan
          useProjection={() => ({ active: planning, pending: false })}
          locked={false}
          exitPlanMode={async () => {
            setPlanning(false);
            return null;
          }}
          t={translate("plan")}
        />
      </section>
      <SubagentReadOnly
        {...({
          matched: { reason: "one-shot" },
          t: translate("subagent"),
        } as unknown as Parameters<typeof SubagentReadOnly>[0])}
      />
      {opened && (
        <p role="status" className="text-sm text-muted-foreground">
          已选择样例子会话：{opened}
        </p>
      )}
      <FeedbackDialog
        {...({
          useDialog: (select: (state: unknown) => unknown) => select(dialog),
          edit: (draft: object) =>
            setDialog((previous) => ({ ...previous, ...draft })),
          dismiss: () =>
            setDialog((previous) => ({ ...previous, target: null })),
          dismissToast: () =>
            setDialog((previous) => ({ ...previous, toast: 0 })),
          submit: async () => {
            setRating(dialog.target?.rating);
            setDialog((previous) => ({ ...previous, target: null, toast: 1 }));
          },
          t: translate("feedback"),
        } as unknown as Parameters<typeof FeedbackDialog>[0])}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);

/** Presentation-only fixture: production components, no model or Host writes. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { installAmibaMessageCatalog } from "../client/messages";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";
import { Composer } from "../../../../packages/ui/src/chat/Composer";
import { ComposerDockError, ComposerToaster } from "../../../../packages/ui/src/chat/ComposerDockSheet";
import { WorkspaceControl } from "../../../../packages/ui/src/chat/WorkspaceControl";
import { PendingQueueRail } from "../../../../packages/ui/src/chat/internal/PendingQueueRail";
import { ApprovalBanner } from "../../../../packages/ui/src/chat/bubble/approval";
import { ClarifyBanner } from "../../../../packages/ui/src/chat/bubble/clarify";
import { GoalDock } from "../client/official-features/goal";
import "./surfaces.css";
import "../../../../packages/ui/src/styles/surfaces.css";
installAmibaMessageCatalog();
setPlatform({ storage: { get: async () => ({}), set: async () => {}, remove: async () => {}, watch: () => () => {} } } as unknown as PlatformAdapter);
function Preview() {
  const [mode, setMode] = useState("queue");
  const [draft, setDraft] = useState("");
  const [width, setWidth] = useState(false);
  const [error, setError] = useState(false);
  const [queue, setQueue] = useState([{ queueId: "1", preview: "补充对比数据，并检查长历史会话的交互体验。" }, { queueId: "2", preview: "完成后整理修改说明和验证结果。" }]);
  const done = () => setMode("queue");
  const ok = async () => ({ ok: true as const, value: undefined });
  return <main data-amiba-product-shell style={{ minHeight: "92vh", background: "radial-gradient(at 5% 80%, #bdabd6, transparent 65%), radial-gradient(at 85% 15%, #ebc6aa, transparent 65%)" }}>
    <nav className="flex flex-wrap gap-2 p-4">
      {[['goal','仅目标'],['workspace','仅工作区'],['queue','目标与队列'],['approval','权限审批'],['question','问答'],['plan','计划确认']].map(([key,label]) => <button className="rounded-md bg-background px-3 py-2" key={key} onClick={() => setMode(key)}>{label}</button>)}
      <button onClick={() => setWidth(!width)}>切换窄窗口</button>
      <button onClick={() => document.documentElement.classList.toggle("dark")}>切换深色</button>
      <button onClick={() => setError(!error)}>切换错误提示</button>
    </nav>
    <p className="px-4 text-sm">本地界面样例，不发送模型请求。交互层关闭后，队列和草稿原样保留。</p>
    <div style={{ position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)", width: width ? 360 : "min(760px, 95vw)" }}>
      <section className="space-y-2">
      <div aria-hidden="true" />
      <div data-home-composer="">
      <ComposerToaster>
        {error && <ComposerDockError message="附件暂时无法读取，请重试或移除附件。" onDismiss={() => setError(false)} dismissLabel="关闭错误" />}
        {mode === "approval" && <ApprovalBanner approvals={[{ approvalId: "a", requestId: "r", tool: "terminal", command: "pnpm test", description: "运行工作区测试以验证修改。", raw: { timestamp: 0 } }]} inFlight={{}} error={null} onRespond={done} onDismissError={() => {}} />}
        {(mode === "question" || mode === "plan") && <ClarifyBanner key={mode} error={null} inFlight={false} onCancel={done} onRespond={done} request={{ requestId: mode, sessionId: "fixture", questions: mode === "plan" ? [{ id: "plan", question: "确认实施计划", detail: "## 实施计划\n\n1. 统一吐司机材质与内容分区。\n2. 交互层覆盖队列层，保留底层状态。\n3. 检查键盘访问、窄窗口和深色主题。", intent: { kind: "plan-review", approve: "确认计划" }, options: [{ label: "确认计划" }, { label: "调整计划" }] }] : [{ id: "q", question: "本轮先验证哪个场景？", options: [{ label: "长历史会话", description: "验证真实长历史下的输入与切换。" }, { label: "新会话", description: "验证初始状态和输入引导。" }] }] }} />}
        <Composer frameVariant={mode === "workspace" ? "hero" : "default"} value={draft} onChange={setDraft} onSubmit={() => {}} canSubmit={false} placeholder="向 Amiba 提问…"
          inputDock={mode !== "workspace" && <GoalDock {...({ useProjection: () => ({ goal: { id: "goal", revision: 1, phase: "active", objective: "统一吐司机布局，验证长历史与插件交互体验。" } }), useGoalActivation: () => "disarmed", onEdit: ok, onPause: ok, onResume: ok, onClear: ok, t: (key: string) => ({ "phase.active.disarmed": "未运行的目标", "action.resume": "恢复目标", "action.edit": "编辑目标", "action.clear": "清除目标" }[key] ?? key) } as unknown as Parameters<typeof GoalDock>[0])} />}
          contextRail={mode === "workspace" ? <WorkspaceControl path="/workspace" onChoose={() => {}} /> : mode !== "goal" && queue.length ? <PendingQueueRail items={queue} editingQueueId={null} onEdit={id => setDraft(queue.find(q => q.queueId === id)?.preview ?? "")} onSendNow={() => {}} onRemove={id => setQueue(items => items.filter(q => q.queueId !== id))} /> : undefined} />
      </ComposerToaster>
      </div>
      </section>
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);

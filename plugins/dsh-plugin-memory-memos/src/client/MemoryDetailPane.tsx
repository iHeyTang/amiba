import { useEffect, useState } from "react";
import { ChatMarkdown } from "@amiba/markdown";
import {
  Button,
  Input,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@amiba/ui/plugin";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
  MessageSquarePlus,
  ChevronDown,
  Pencil,
  Archive,
  Info,
} from "lucide-react";
import type {
  MemoryDetail,
  MemoryDetailQuery,
  MemoryEntry,
  MemoryKind,
  MemoryUpdate,
} from "../dashboard.js";
import { memoryTitle } from "./memory-presentation.js";
import type { MemoryAdapter } from "./MemoryPage.js";

export function MemoryStatus({
  status,
  label,
}: {
  status: string | null;
  label(key: string): string;
}) {
  if (!status) return null;
  const tone =
    status === "active"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : status === "candidate"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-normal ${tone}`}
    >
      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-current" />
      {label(status)}
    </span>
  );
}
const editableFields = {
  policies: ["procedure", "trigger", "boundary", "verification"],
  worldModels: ["body"],
  skills: ["invocationGuide"],
} as const;

export function MemoryDetailPane({
  adapter,
  entry,
  kind,
  label,
  copy,
  onClose,
  onAuthRequired,
  onSaved,
  startChat,
  onEditingChange,
}: {
  adapter: MemoryAdapter;
  entry: MemoryEntry;
  kind: MemoryKind;
  label(key: string): string;
  copy(cn: string, en: string): string;
  onClose(): void;
  onAuthRequired(): void;
  onSaved(entry: MemoryEntry): void;
  startChat(prompt: string): void;
  onEditingChange(busy: boolean): void;
}) {
  const [history, setHistory] = useState<MemoryDetailQuery[]>([
    {
      kind,
      id: entry.id,
      ...(entry.episodeId
        ? { episodeId: entry.episodeId, turnId: entry.turnId }
        : {}),
    },
  ]);
  const target = history[history.length - 1]!;
  const [detail, setDetail] = useState<MemoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [visibleRelations, setVisibleRelations] = useState({
    sources: false,
    connections: false,
  });
  const [startingChat, setStartingChat] = useState(false);
  const [chatError, setChatError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    onEditingChange(editing || saving || startingChat);
    return () => onEditingChange(false);
  }, [editing, saving, startingChat, onEditingChange]);
  useEffect(() => {
    let current = true;
    setDetail(null);
    setVisibleRelations({ sources: false, connections: false });
    setError(null);
    setEditing(false);
    setNotice("");
    void adapter
      .detail(target)
      .then((value) => {
        if (current) setDetail(value);
      })
      .catch((cause) => {
        if (!current) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        if (message.includes("MEMOS_AUTH_REQUIRED")) onAuthRequired();
        else setError(message);
      });
    return () => {
      current = false;
    };
  }, [adapter, target, revision]);
  const current = detail?.entry;
  const editableKind =
    target.kind === "policies" ||
    target.kind === "worldModels" ||
    target.kind === "skills"
      ? target.kind
      : null;
  const isConversation = target.kind === "traces" || target.kind === "episodes";
  const sectionName = (key: string) =>
    ({
      procedure: copy("记住的内容", "What is remembered"),
      body: copy("记住的内容", "What is remembered"),
      invocationGuide: copy("可以怎样帮你", "How this can help"),
      trigger: copy("什么时候适用", "When it applies"),
      boundary: copy("需要注意", "Limitations"),
      verification: copy("如何判断做对了", "How to check the result"),
      userText: copy("你当时的需求", "What you asked"),
      agentText: copy("当时的回答", "The response"),
      summary: copy("记住的内容", "What is remembered"),
    })[key] ?? label(key);
  const save = async (action: MemoryUpdate["action"]) => {
    if (!current || !editableKind || saving) return;
    setSaving(true);
    setSaveError(false);
    setNotice("");
    try {
      const updated = await adapter.update({
        kind: editableKind,
        id: target.id,
        action,
        ...(action === "correct"
          ? {
              title,
              sections: editableFields[editableKind].map((key) => ({
                label: key,
                text: draft[key] ?? "",
              })),
            }
          : {}),
      });
      setDetail((value) => (value ? { ...value, entry: updated } : value));
      if (target.id === entry.id && target.kind === kind) onSaved(updated);
      setEditing(false);
      setNotice(
        action === "correct"
          ? copy("已保存你的纠正", "Your correction was saved")
          : action === "archive"
            ? copy(
                "已归档，可随时恢复",
                "Archived. You can restore it anytime.",
              )
            : copy("已恢复", "Restored"),
      );
    } catch (cause) {
      if (
        cause instanceof Error &&
        cause.message.includes("MEMOS_AUTH_REQUIRED")
      )
        onAuthRequired();
      else setSaveError(true);
    } finally {
      setSaving(false);
    }
  };
  const correctWithAgent = async () => {
    if (!editableKind || startingChat) return;
    setMenuOpen(false);
    setChatError(false);
    setStartingChat(true);
    try {
      const prompt = await adapter.beginCorrection({
        kind: editableKind,
        id: target.id,
        language: copy("zh", "en") as "zh" | "en",
      });
      startChat(prompt);
    } catch (cause) {
      if (
        cause instanceof Error &&
        cause.message.includes("MEMOS_AUTH_REQUIRED")
      )
        onAuthRequired();
      else setChatError(true);
    } finally {
      setStartingChat(false);
    }
  };
  const content =
    current?.sections.filter(
      (section) =>
        section.label !== "summary" || section.text !== current.title,
    ) ?? [];
  const sources =
    detail?.relations.filter(
      (relation) => relation.kind === "traces" || relation.kind === "episodes",
    ) ?? [];
  const connections =
    detail?.relations.filter(
      (relation) => relation.kind !== "traces" && relation.kind !== "episodes",
    ) ?? [];
  const related = (
    items: MemoryDetail["relations"],
    group: "sources" | "connections",
  ): React.ReactNode => (
    <div className="space-y-1">
      {(visibleRelations[group] ? items : items.slice(0, 3)).map(
        (relation, index) => (
          <button
            key={`${relation.kind}:${relation.id}`}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() =>
              setHistory((value) => [
                ...value,
                {
                  kind: relation.kind,
                  id: relation.id,
                  ...(relation.episodeId
                    ? { episodeId: relation.episodeId, turnId: relation.turnId }
                    : {}),
                },
              ])
            }
          >
            <span className="min-w-0 flex-1 truncate text-xs">
              {relation.title === relation.id
                ? copy(
                    `${relation.kind === "episodes" || relation.kind === "traces" ? "查看来源对话" : "查看相关内容"} ${index + 1}`,
                    `View related content ${index + 1}`,
                  )
                : relation.title}
            </span>
            <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
        ),
      )}
      {!visibleRelations[group] && items.length > 3 && (
        <button
          type="button"
          className="rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() =>
            setVisibleRelations((value) => ({ ...value, [group]: true }))
          }
        >
          {copy("显示全部", "Show all")}
        </button>
      )}
    </div>
  );
  return (
    <article
      aria-label={copy("记忆详情", "Memory detail")}
      className="min-w-0 flex-1 overflow-y-auto"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !editing && !saving) onClose();
      }}
    >
      <div className="sticky top-0 z-10 flex h-10 items-center justify-between border-b border-border/40 bg-background px-4">
        <div className="flex items-center gap-2">
          {history.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              disabled={editing || saving}
              aria-label={copy("返回上一条记录", "Back to previous record")}
              onClick={() => setHistory((value) => value.slice(0, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {isConversation
              ? copy("对话记录", "Conversation")
              : label(current?.category ?? "approach")}
          </span>
          <MemoryStatus status={current?.status ?? null} label={label} />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {current && editableKind && !editing && (
            <div className="flex items-center">
              <Button
                size="sm"
                className="h-7 gap-1.5 rounded-l-lg rounded-r-none px-2.5 text-xs shadow-none [&_svg]:size-3.5"
                disabled={saving || startingChat}
                onClick={() => void correctWithAgent()}
              >
                <MessageSquarePlus />
                {startingChat
                  ? copy("正在打开…", "Opening…")
                  : copy("纠正这条记忆", "Correct this memory")}
              </Button>
              <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    disabled={saving || startingChat}
                    aria-label={copy("纠正方式", "Correction options")}
                    className="h-7 rounded-l-none rounded-r-lg border-l border-primary-foreground/20 px-1.5 shadow-none [&_svg]:size-3.5"
                  >
                    <ChevronDown />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60 p-1.5">
                  <button
                    className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-muted/50"
                    onClick={() => void correctWithAgent()}
                  >
                    <MessageSquarePlus className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <span className="text-xs">
                      {copy("通过对话纠正", "Correct with Agent")}
                      <span className="mt-1 block text-muted-foreground">
                        {copy(
                          "告诉 Agent 哪里不准确",
                          "Tell the agent what is inaccurate",
                        )}
                      </span>
                    </span>
                  </button>
                  <button
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted/50"
                    onClick={() => {
                      setMenuOpen(false);
                      setTitle(current.title);
                      setDraft(
                        Object.fromEntries(
                          current.sections.map((section) => [
                            section.label,
                            section.text,
                          ]),
                        ),
                      );
                      setEditing(true);
                      setSaveError(false);
                      setNotice("");
                    }}
                  >
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                    {copy("手动修改", "Edit manually")}
                  </button>
                  <div className="my-1 border-t border-border/40" />
                  <button
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-muted/50"
                    onClick={() => {
                      setMenuOpen(false);
                      void save(
                        current.status === "archived" ? "restore" : "archive",
                      );
                    }}
                  >
                    <Archive className="h-4 w-4" />
                    {current.status === "archived"
                      ? copy("恢复", "Restore")
                      : copy("归档", "Archive")}
                  </button>
                </PopoverContent>
              </Popover>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            disabled={editing || saving}
            aria-label={copy("关闭详情", "Close detail")}
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div
        data-selection="text"
        className="mx-auto max-w-3xl px-5 py-5 lg:px-7"
      >
        {chatError && (
          <p role="alert" className="mb-4 text-xs text-destructive">
            {copy(
              "暂时无法打开纠正对话，请重试。",
              "Could not open the correction conversation. Try again.",
            )}
          </p>
        )}
        {error ? (
          <div role="alert" className="space-y-3 text-sm">
            <p>
              {error.includes("404")
                ? copy(
                    "这条记录已不存在或无法访问。",
                    "This record no longer exists or is unavailable.",
                  )
                : copy(
                    "详情读取失败，请重试。",
                    "Could not load details. Try again.",
                  )}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRevision((n) => n + 1)}
            >
              {copy("重试", "Retry")}
            </Button>
          </div>
        ) : !current ? (
          <p
            role="status"
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <RefreshCw className="h-3 w-3 animate-spin" />
            {copy("正在读取详情…", "Loading details…")}
          </p>
        ) : (
          <>
            {editing && editableKind ? (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save("correct");
                }}
              >
                <label className="block space-y-2 text-xs">
                  <span>{copy("记住的事", "Memory")}</span>
                  <Input
                    value={title}
                    maxLength={2000}
                    required
                    disabled={saving}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                {editableFields[editableKind].map((key) => (
                  <label key={key} className="block space-y-2 text-xs">
                    <span>{sectionName(key)}</span>
                    <textarea
                      className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm leading-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                      maxLength={50000}
                      disabled={saving}
                      value={draft[key] ?? ""}
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          [key]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={saving || !title.trim()}
                  >
                    {saving
                      ? copy("正在保存…", "Saving…")
                      : copy("保存纠正", "Save correction")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => {
                      setEditing(false);
                      setSaveError(false);
                    }}
                  >
                    {copy("取消", "Cancel")}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <h2 className="mb-3 break-words text-base font-medium leading-6">
                  {memoryTitle(current)}
                </h2>
                <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {current.timestamp !== null && (
                    <time dateTime={new Date(current.timestamp).toISOString()}>
                      {copy("更新于 ", "Updated ")}
                      {new Date(current.timestamp).toLocaleDateString()}
                    </time>
                  )}
                  {current.tags.map((tag) => (
                    <span key={tag} className="rounded bg-muted px-2 py-1">
                      {tag}
                    </span>
                  ))}
                </div>
                {current.status === "candidate" && (
                  <aside className="mb-6 flex items-start gap-2 rounded-md bg-amber-500/5 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                    <Info
                      aria-hidden="true"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                    />
                    <p>
                      {copy(
                        "这条内容尚待验证，可以先查看来源是否支持这个结论。",
                        "This memory is not yet validated. Check whether the sources support it.",
                      )}
                    </p>
                  </aside>
                )}
                {content.length === 0 && (
                  <p className="mb-6 text-sm text-muted-foreground">
                    {isConversation
                      ? copy(
                          "暂无完整回答，可以展开执行过程查看记录。",
                          "No complete response is available. Explore the recorded steps below.",
                        )
                      : copy(
                          "目前只记录了上面的结论，尚未补充适用条件。",
                          "Only the conclusion above is recorded; no conditions have been added.",
                        )}
                  </p>
                )}
                {content.map((section) => (
                  <section key={section.label} className="mb-5">
                    <h3 className="mb-3 text-xs font-medium text-foreground">
                      {sectionName(section.label)}
                    </h3>
                    <ChatMarkdown
                      mode="static"
                      className="break-words text-[13px] leading-6"
                    >
                      {section.text}
                    </ChatMarkdown>
                  </section>
                ))}
                <section className="border-t border-border/40 pt-4">
                  <h3 className="mb-3 text-xs font-medium">
                    {isConversation
                      ? copy("回到这次对话", "Return to this conversation")
                      : copy("为什么记住这件事", "Why this was remembered")}
                  </h3>
                  {current.sessionId && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mb-3 gap-2"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("amiba:open-session", {
                            detail: { sessionId: current.sessionId },
                          }),
                        )
                      }
                    >
                      {copy("打开来源任务", "Open source task")}
                      <ArrowUpRight className="h-3 w-3" />
                    </Button>
                  )}
                  {sources.length
                    ? related(sources, "sources")
                    : !current.sessionId && (
                        <p className="text-xs leading-5 text-muted-foreground">
                          {copy(
                            "尚未记录可追溯的对话来源。",
                            "No conversation source has been recorded.",
                          )}
                        </p>
                      )}
                  {detail.relationsUnavailable && (
                    <div
                      role="status"
                      className="mt-3 text-xs text-muted-foreground"
                    >
                      {copy(
                        "部分来源暂时无法读取。",
                        "Some sources could not be loaded.",
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRevision((n) => n + 1)}
                      >
                        {copy("重试", "Retry")}
                      </Button>
                    </div>
                  )}
                </section>
                {connections.length > 0 && (
                  <section className="mt-6 border-t border-border/40 pt-4">
                    <h3 className="mb-3 text-xs font-medium">
                      {copy(
                        "相关的记忆与做法",
                        "Related memories and approaches",
                      )}
                    </h3>
                    {related(connections, "connections")}
                  </section>
                )}
                {!!detail.steps?.length && (
                  <details className="mt-6 border-t border-border/60 pt-4 [&[open]>summary>svg]:rotate-90">
                    <summary className="flex min-h-7 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                      <ChevronRight
                        aria-hidden="true"
                        strokeWidth={1.75}
                        className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none"
                      />
                      {copy(
                        `执行过程 · ${detail.steps.length} 个步骤`,
                        `Execution · ${detail.steps.length} steps`,
                      )}
                    </summary>
                    <div className="mt-4 space-y-4">
                      {detail.steps.map((step, index) => (
                        <details
                          key={step.id}
                          className="rounded-md bg-muted/30 p-3 [&[open]>summary>svg]:rotate-90"
                        >
                          <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 rounded-md text-xs transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                            <ChevronRight
                              aria-hidden="true"
                              strokeWidth={1.75}
                              className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none"
                            />
                            {index + 1}. {step.title}
                          </summary>
                          {step.sections.map((section) => (
                            <div
                              key={section.label}
                              className="mt-3 whitespace-pre-wrap break-words text-xs leading-5"
                            >
                              {section.text}
                            </div>
                          ))}
                        </details>
                      ))}
                    </div>
                  </details>
                )}
                <details className="mt-6 border-t border-border/60 pt-4 [&[open]>summary>svg]:rotate-90">
                  <summary className="flex min-h-7 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none"
                    />
                    {copy("更多信息", "More information")}
                  </summary>
                  <dl className="mt-3 space-y-3 text-xs">
                    {[
                      [copy("记录 ID", "Record ID"), current.id],
                      [copy("来源会话", "Source session"), current.sessionId],
                      ...detail.facts.map((fact) => [
                        label(fact.label),
                        label(fact.value),
                      ]),
                    ].map(
                      ([name, value]) =>
                        value && (
                          <div key={name}>
                            <dt className="mb-1 text-muted-foreground">
                              {name}
                            </dt>
                            <dd className="select-text break-all text-xs">
                              {value}
                            </dd>
                          </div>
                        ),
                    )}
                  </dl>
                </details>
              </>
            )}
            {saveError && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {copy(
                  "未能确认保存结果。修改内容已保留，请重试。",
                  "Could not confirm the save. Your edits are still here; try again.",
                )}
              </p>
            )}
            {notice && (
              <p role="status" className="mt-4 text-xs text-muted-foreground">
                {notice}
              </p>
            )}
          </>
        )}
      </div>
    </article>
  );
}

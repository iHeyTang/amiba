import { useEffect, useState, useCallback } from "react";
import { Button } from "@amiba/ui/plugin";
import type {
  StewardInstance,
  StewardProfileInput,
} from "../registry-store.js";
import type { ConversationSettingsInput } from "../remote.js";
import type { ConversationView } from "@amiba/dsh-plugin-session-features";
import { StewardSettings } from "./StewardSettings.js";

export interface DirectoryProps {
  list(): Promise<StewardInstance[]>;
  save(input: StewardProfileInput & { id?: string }): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  settings(input: ConversationSettingsInput): Promise<ConversationView>;
  open(id: string): Promise<void>;
  openSession(id: string): void;
}
const empty: StewardProfileInput = {
  name: "",
  responsibilities: "",
  background: "",
  context: "",
};
export function StewardDirectory({
  list,
  save,
  remove,
  settings,
  open,
  openSession,
}: DirectoryProps) {
  const [items, setItems] = useState<StewardInstance[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<StewardProfileInput>(empty);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const zh = document.documentElement.lang.toLowerCase().startsWith("zh");
  const text = (cn: string, en: string) => (zh ? cn : en);
  const refresh = useCallback(async () => {
    const rows = await list();
    setItems(rows);
    return rows;
  }, [list]);
  useEffect(() => {
    void refresh()
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  }, [refresh]);
  const scopedSettings = useCallback(
    (input: Omit<ConversationSettingsInput, "stewardId">) =>
      settings({ ...input, stewardId: selected! }),
    [selected, settings],
  );
  const select = (id: string) => {
    setSelected(id);
    setDraft(items.find((item) => item.id === id) ?? empty);
    setError("");
  };
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background p-6"
      data-steward-directory
    >
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <header>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">
              {selected === null
                ? text("管家", "Stewards")
                : selected
                  ? text("编辑管家", "Edit steward")
                  : text("创建管家", "Create steward")}
            </h2>
            {selected === null ? (
              <Button disabled={busy} onClick={() => select("")}>
                {text("创建管家", "Create steward")}
              </Button>
            ) : (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setSelected(null);
                  setError("");
                }}
              >
                {text("返回列表", "Back to list")}
              </Button>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {text(
              "每个管家有自己的职责、背景和任务。也可以在任意普通对话中说“帮我创建一个管家”。",
              "Each steward has its own responsibilities, context and tasks. You can also ask to create one in any ordinary conversation.",
            )}
          </p>
        </header>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}{" "}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void run(async () => {})}
            >
              {text("重试", "Retry")}
            </Button>
          </p>
        ) : null}
        {selected === null ? (
          <>
            {busy && !items.length ? (
              <p role="status" className="text-sm text-muted-foreground">
                {text("正在读取管家…", "Loading stewards…")}
              </p>
            ) : null}
            {!busy && !error && !items.length ? (
              <p
                role="status"
                className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground"
              >
                {text(
                  "暂无管家。创建一个，或先开始普通对话。",
                  "No stewards yet. Create one or start an ordinary conversation.",
                )}
              </p>
            ) : null}
            <ul
              aria-label={text("已配置的管家", "Configured stewards")}
              className="divide-y divide-border"
            >
              {items.map((item) => (
                <li
                  key={item.id}
                  data-steward-row={item.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words text-sm font-medium">
                      {item.name}
                    </h3>
                    <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">
                      {item.responsibilities}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-label={text(
                        `进入 ${item.name}`,
                        `Open ${item.name}`,
                      )}
                      onClick={() => void run(() => open(item.id))}
                    >
                      {text("进入", "Open")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={text(
                        `编辑 ${item.name}`,
                        `Edit ${item.name}`,
                      )}
                      onClick={() => select(item.id)}
                    >
                      {text("编辑", "Edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={text(
                        `删除 ${item.name}，保留对话`,
                        `Delete ${item.name}, keep conversations`,
                      )}
                      onClick={() => void run(() => remove(item.id))}
                    >
                      {text("删除", "Delete")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {items.length ? (
              <p className="text-xs text-muted-foreground">
                {text(
                  "删除管家会解除管理关系，任务会话和历史仍会保留。",
                  "Deleting a steward releases its tasks and keeps all conversations and history.",
                )}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await save({
                    ...draft,
                    ...(selected ? { id: selected } : {}),
                  });
                  setSelected(null);
                  setDraft(empty);
                });
              }}
            >
              {(
                [
                  ["name", text("名称", "Name")],
                  ["responsibilities", text("职责", "Responsibilities")],
                  ["background", text("初始背景", "Background")],
                  ["context", text("持续上下文", "Working context")],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block text-sm">
                  {label}
                  <textarea
                    className="mt-2 w-full resize-y rounded-md border border-input bg-background p-2"
                    rows={key === "name" ? 1 : 3}
                    required={key === "name" || key === "responsibilities"}
                    maxLength={key === "name" ? 100 : 20000}
                    value={draft[key]}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({ ...draft, [key]: event.target.value })
                    }
                  />
                </label>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>
                  {selected
                    ? text("保存", "Save")
                    : text("创建管家", "Create steward")}
                </Button>
                {selected ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run(() => open(selected))}
                    >
                      {text("进入管家", "Open steward")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await remove(selected);
                          setSelected(null);
                        })
                      }
                    >
                      {text(
                        "删除管家，保留对话",
                        "Delete steward, keep conversations",
                      )}
                    </Button>
                  </>
                ) : null}
              </div>
            </form>
            {selected ? (
              <StewardSettings
                embedded
                key={selected}
                settings={scopedSettings}
                openSession={openSession}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

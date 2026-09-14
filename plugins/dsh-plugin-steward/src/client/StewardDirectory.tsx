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
  const [selected, setSelected] = useState<string>("");
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
      settings({ ...input, stewardId: selected }),
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
          <h2 className="text-lg font-semibold">{text("管家", "Stewards")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {text(
              "每个管家有自己的职责、背景和任务。也可以在任意普通对话中说“帮我创建一个管家”。",
              "Each steward has its own responsibilities, context and tasks. You can also ask to create one in any ordinary conversation.",
            )}
          </p>
        </header>
        {!busy && !items.length ? (
          <p role="status" className="text-sm text-muted-foreground">
            {text(
              "暂无管家。创建一个，或先开始普通对话。",
              "No stewards yet. Create one or start an ordinary conversation.",
            )}
          </p>
        ) : null}
        <label className="block text-sm">
          {text("选择管家", "Select steward")}
          <select
            className="mt-2 w-full rounded-md border border-input bg-background p-2"
            disabled={busy}
            value={selected}
            onChange={(e) => select(e.target.value)}
          >
            <option value="">{text("创建管家", "Create steward")}</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const item = (await save({
                ...draft,
                ...(selected ? { id: selected } : {}),
              })) as StewardInstance;
              setSelected(item.id);
              setDraft(item);
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
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
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
                      select("");
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
      </div>
    </div>
  );
}

import {
  approveHermesPairing,
  createHermesWebhook,
  deleteHermesWebhook,
  getHermesMessagingPlatforms,
  getHermesPairings,
  getHermesWebhooks,
  revokeHermesPairing,
  saveHermesMessagingPlatform,
  setHermesWebhookEnabled,
  testHermesMessagingPlatform,
  updateHermesWebhook,
  type HermesMessagingPlatform,
  type HermesWebhookSubscription,
} from "@amiba/core";
import {
  Cable,
  CheckCircle2,
  ChevronDown,
  Plus,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
  Users,
  Webhook,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  Button,
  Input,
  PageContent,
  ScrollArea,
  Switch,
  cn,
} from "../primitives";
import { SettingsPaneHeader } from "./SettingsPaneHeader";

type Tab = "channels" | "pairing" | "webhooks";

function text(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

export function SettingsMessaging({
  profileId = "default",
}: {
  profileId?: string;
}) {
  const [tab, setTab] = useState<Tab>("channels");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SettingsPaneHeader
        title="Channels"
        subtitle="Connect messaging platforms, approve users, and manage incoming webhooks."
      />
      <div className="border-b border-border/50 px-4 pb-2">
        <div className="inline-flex rounded-full bg-muted/55 p-1">
          {(["channels", "pairing", "webhooks"] as const).map((value) => (
            <button
              className={cn(
                "rounded-full px-3 py-1 text-xs transition-colors",
                tab === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={value}
              onClick={() => setTab(value)}
              type="button"
            >
              {value === "channels"
                ? "Channels"
                : value === "pairing"
                  ? "Pairing"
                  : "Webhooks"}
            </button>
          ))}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <PageContent bodyClassName="space-y-3" className="pt-3" size="md">
          {tab === "channels" ? (
            <ChannelsPanel profileId={profileId} />
          ) : tab === "pairing" ? (
            <PairingPanel profileId={profileId} />
          ) : (
            <WebhooksPanel profileId={profileId} />
          )}
        </PageContent>
      </ScrollArea>
    </div>
  );
}

function ChannelsPanel({ profileId }: { profileId: string }) {
  const [items, setItems] = useState<HermesMessagingPlatform[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const result = await getHermesMessagingPlatforms(profileId);
    if (result.ok) setItems(result.platforms ?? []);
    else setError(result.error || "Failed to load channels");
  }, [profileId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function save(item: HermesMessagingPlatform, enabled = item.enabled) {
    setBusy(item.id);
    setError(null);
    setMessage(null);
    const result = await saveHermesMessagingPlatform(
      item.id,
      { enabled, env: drafts[item.id] },
      profileId,
    );
    setBusy(null);
    if (!result.ok) setError(result.error || "Save failed");
    else {
      setDrafts((current) => ({ ...current, [item.id]: {} }));
      setMessage(
        `${item.name} saved. Restart Gateway to apply connection changes.`,
      );
      await refresh();
    }
  }
  async function test(item: HermesMessagingPlatform) {
    setBusy(item.id);
    setError(null);
    const result = await testHermesMessagingPlatform(item.id, profileId);
    setBusy(null);
    if (!result.ok)
      setError(result.message || result.error || "Connection test failed");
    else setMessage(`${item.name}: ${result.message || "connected"}`);
  }
  return (
    <>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {message ? (
        <p className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          {message}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-border/60">
        {items.map((item) => (
          <section
            className="border-b border-border/50 last:border-b-0"
            key={item.id}
          >
            <div className="flex items-center gap-3 px-3 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/55">
                <Cable className="h-4 w-4 text-muted-foreground" />
              </span>
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() =>
                  setExpanded(expanded === item.id ? null : item.id)
                }
                type="button"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {item.name}
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      item.state === "connected"
                        ? "bg-emerald-500"
                        : item.enabled
                          ? "bg-amber-500"
                          : "bg-muted-foreground/40",
                    )}
                  />
                </span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  {item.state.replaceAll("_", " ")}
                </span>
              </button>
              <Button
                disabled={busy === item.id || !item.enabled}
                onClick={() => void test(item)}
                size="sm"
                variant="ghost"
              >
                Test
              </Button>
              <Switch
                checked={item.enabled}
                disabled={busy === item.id}
                onCheckedChange={(enabled) => void save(item, enabled)}
              />
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  expanded === item.id && "rotate-180",
                )}
              />
            </div>
            {expanded === item.id ? (
              <div className="space-y-2 border-t border-border/40 bg-muted/10 px-3 py-3">
                {item.fields.length ? (
                  item.fields.map((field) => (
                    <div
                      className="grid items-center gap-2 sm:grid-cols-[180px_1fr]"
                      key={field.key}
                    >
                      <label className="font-mono text-[10px] text-muted-foreground">
                        <span className="block font-sans text-[11px] text-foreground">
                          {field.label || field.key}
                          {field.required ? " *" : ""}
                        </span>
                        <span className="block truncate">{field.key}</span>
                      </label>
                      <Input
                        autoComplete="off"
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [item.id]: {
                              ...(current[item.id] ?? {}),
                              [field.key]: event.target.value,
                            },
                          }))
                        }
                        placeholder={
                          field.configured
                            ? "Saved — enter a replacement"
                            : "Enter value"
                        }
                        type={
                          field.secret ||
                          field.key.includes("TOKEN") ||
                          field.key.includes("PASSWORD") ||
                          field.key.includes("SECRET")
                            ? "password"
                            : "text"
                        }
                        value={drafts[item.id]?.[field.key] ?? ""}
                      />
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    This channel uses pairing or runtime defaults and has no
                    credential fields.
                  </p>
                )}
                <div className="flex justify-end">
                  <Button
                    disabled={
                      busy === item.id ||
                      !Object.values(drafts[item.id] ?? {}).some(Boolean)
                    }
                    onClick={() => void save(item)}
                    size="sm"
                  >
                    Save credentials
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </>
  );
}

function PairingPanel({ profileId }: { profileId: string }) {
  const [pending, setPending] = useState<Array<Record<string, unknown>>>([]);
  const [approved, setApproved] = useState<Array<Record<string, unknown>>>([]);
  const [platform, setPlatform] = useState("telegram");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const result = await getHermesPairings(profileId);
    if (result.ok) {
      setPending(result.pending ?? []);
      setApproved(result.approved ?? []);
    } else setError(result.error || "Failed to load pairing requests");
  }, [profileId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function approve(chosenPlatform = platform, chosenTarget = target) {
    const result = await approveHermesPairing(
      chosenPlatform,
      chosenTarget,
      profileId,
    );
    if (!result.ok) setError(result.error || "Approval failed");
    else {
      setTarget("");
      await refresh();
    }
  }
  return (
    <div className="space-y-5">
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold">
          <Users className="h-4 w-4" />
          Pending approvals
        </h3>
        <div className="flex gap-2">
          <Input
            className="w-32"
            onChange={(event) => setPlatform(event.target.value)}
            placeholder="Platform"
            value={platform}
          />
          <Input
            className="flex-1"
            onChange={(event) => setTarget(event.target.value)}
            placeholder="Pairing code or request ID"
            value={target}
          />
          <Button
            disabled={!platform.trim() || !target.trim()}
            onClick={() => void approve()}
          >
            <CheckCircle2 />
            Approve
          </Button>
        </div>
        <ul className="mt-2 space-y-1">
          {pending.map((item, index) => {
            const p = text(item, "platform") || platform;
            const id = text(item, "request_id", "id", "code");
            return (
              <li
                className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-xs"
                key={id || index}
              >
                <span className="font-medium">{p}</span>
                <code className="min-w-0 flex-1 truncate text-muted-foreground">
                  {id}
                </code>
                <Button
                  onClick={() => void approve(p, id)}
                  size="sm"
                  variant="ghost"
                >
                  Approve
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold">Approved users</h3>
        <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
          {approved.map((item, index) => {
            const p = text(item, "platform");
            const id = text(item, "user_id", "id");
            return (
              <li
                className="flex items-center gap-2 px-3 py-2.5 text-xs"
                key={`${p}:${id}:${index}`}
              >
                <span className="font-medium">{p}</span>
                <code className="min-w-0 flex-1 truncate text-muted-foreground">
                  {id}
                </code>
                <Button
                  className="text-destructive hover:text-destructive"
                  onClick={() =>
                    void (async () => {
                      const result = await revokeHermesPairing(
                        p,
                        id,
                        profileId,
                      );
                      if (!result.ok) setError(result.error || "Revoke failed");
                      else await refresh();
                    })()
                  }
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function WebhooksPanel({ profileId }: { profileId: string }) {
  const [items, setItems] = useState<HermesWebhookSubscription[]>([]);
  const [name, setName] = useState("");
  const [events, setEvents] = useState("");
  const [description, setDescription] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editEvents, setEditEvents] = useState("");
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    const result = await getHermesWebhooks(profileId);
    if (result.ok) setItems(result.subscriptions ?? []);
    else setError(result.error || "Failed to load webhooks");
  }, [profileId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    const result = await createHermesWebhook(
      {
        name,
        description,
        events: events
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      },
      profileId,
    );
    setCreating(false);
    if (!result.ok) setError(result.error || "Create failed");
    else {
      setSecret(result.secret ?? null);
      setName("");
      setDescription("");
      setEvents("");
      await refresh();
    }
  }
  function startEdit(item: HermesWebhookSubscription) {
    setEditing(item.name);
    setEditDescription(item.description || "");
    setEditEvents(item.events.join(", "));
    setError(null);
  }
  async function saveEdit(item: HermesWebhookSubscription) {
    setSaving(true);
    setError(null);
    const result = await updateHermesWebhook(
      item.name,
      {
        description: editDescription,
        events: editEvents
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      },
      profileId,
    );
    setSaving(false);
    if (!result.ok) setError(result.error || "Update failed");
    else {
      setEditing(null);
      await refresh();
    }
  }
  return (
    <div className="space-y-4">
      <form
        className="space-y-2 rounded-xl border border-border/60 bg-muted/15 p-3"
        onSubmit={(event) => void create(event)}
      >
        <h3 className="flex items-center gap-2 text-xs font-semibold">
          <Webhook className="h-4 w-4" />
          Create webhook
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            onChange={(event) => setName(event.target.value)}
            placeholder="Route name"
            value={name}
          />
          <Input
            onChange={(event) => setEvents(event.target.value)}
            placeholder="Events, comma-separated"
            value={events}
          />
        </div>
        <Input
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description"
          value={description}
        />
        <div className="flex justify-end">
          <Button disabled={creating || !name.trim()} type="submit">
            <Plus />
            Create
          </Button>
        </div>
      </form>
      {secret ? (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs">
          <p className="font-medium">
            Copy this secret now; it will only be shown once.
          </p>
          <code className="mt-2 block break-all select-all font-mono">
            {secret}
          </code>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
        {items.map((item) => (
          <li className="px-3 py-3" key={item.name}>
            <div className="flex items-center gap-3">
              <Webhook className="h-4 w-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">{item.name}</span>
                <span className="block truncate font-mono text-[9.5px] text-muted-foreground">
                  {item.url}
                </span>
              </span>
              <Button
                aria-label={`Edit ${item.name}`}
                onClick={() =>
                  editing === item.name ? setEditing(null) : startEdit(item)
                }
                size="icon"
                variant="ghost"
              >
                <Pencil />
              </Button>
              <Switch
                checked={item.enabled}
                onCheckedChange={(enabled) =>
                  void setHermesWebhookEnabled(
                    item.name,
                    enabled,
                    profileId,
                  ).then(refresh)
                }
              />
              <Button
                className="text-destructive hover:text-destructive"
                onClick={() =>
                  void (async () => {
                    if (!confirm(`Delete webhook “${item.name}”?`)) return;
                    const result = await deleteHermesWebhook(
                      item.name,
                      profileId,
                    );
                    if (!result.ok) setError(result.error || "Delete failed");
                    else await refresh();
                  })()
                }
                size="icon"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </div>
            {editing === item.name ? (
              <div className="mt-3 grid gap-2 border-t border-border/45 pt-3">
                <Input
                  onChange={(event) => setEditDescription(event.target.value)}
                  placeholder="Description"
                  value={editDescription}
                />
                <Input
                  onChange={(event) => setEditEvents(event.target.value)}
                  placeholder="Events, comma-separated"
                  value={editEvents}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={() => setEditing(null)}
                    size="sm"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={saving}
                    onClick={() => void saveEdit(item)}
                    size="sm"
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

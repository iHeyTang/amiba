import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Label,
  ScrollArea,
  Switch,
  usePluginT,
} from "@amiba/ui/plugin";
import type { ConfigureProviderInput } from "./view-types.js";
import type { ProviderSettingsController } from "./ModelProviderConfigTab.js";
import type {
  ModelPlaneSnapshotShape,
  ModelProviderProfileShape,
} from "./view-types.js";
import { modelPlaneI18n } from "./i18n.js";

export const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function configurationDiff(
  before: unknown,
  after: unknown,
  path: string[] = [],
): ConfigureProviderInput["ops"] {
  if (equal(before, after)) return [];
  if (after === undefined) return [{ op: "unset", path }];
  if (after && typeof after === "object" && !Array.isArray(after)) {
    return [
      ...new Set([
        ...Object.keys(object(before)),
        ...Object.keys(object(after)),
      ]),
    ].flatMap((key) =>
      configurationDiff(object(before)[key], object(after)[key], [
        ...path,
        key,
      ]),
    );
  }
  return [{ op: "set", path, value: after }];
}
const containsSecret = (schema: unknown): boolean => {
  const s = object(schema);
  return (
    object(s.meta).role === "secret" ||
    Object.values(object(s.dict)).some(containsSecret) ||
    (s.inner !== undefined && containsSecret(s.inner)) ||
    (Array.isArray(s.list) && s.list.some(containsSecret))
  );
};
/** Render the plugin's schema with Amiba controls. Unknown compound dialects
 * remain editable as JSON; validation and ownership stay with official DSH. */
export function SchemaField({
  schema,
  value,
  onChange,
  path,
  providerId,
  credentials,
  onCredential,
  credentialState,
}: {
  schema: unknown;
  value: unknown;
  onChange: (value: unknown) => void;
  path: string[];
  providerId: string;
  credentials: Record<string, string | undefined>;
  onCredential: (ref: string, value: string | undefined) => void;
  credentialState: ModelPlaneSnapshotShape["credentials"];
}) {
  const { t } = usePluginT(modelPlaneI18n);
  const s = object(schema),
    meta = object(s.meta);
  const label =
    typeof meta.description === "string"
      ? meta.description
      : (path.at(-1) ?? "");
  const id = `provider-field-${providerId}-${path.join("-")}`;
  const nested = (
    childSchema: unknown,
    child: unknown,
    change: (v: unknown) => void,
    key: string,
  ) => (
    <SchemaField
      key={key}
      schema={childSchema}
      value={child}
      onChange={change}
      path={[...path, key]}
      providerId={providerId}
      credentials={credentials}
      onCredential={onCredential}
      credentialState={credentialState}
    />
  );
  if (meta.role === "credential-ref") {
    const stem =
      path.join(".") === "apiKeyEnv"
        ? providerId
        : `${providerId}_${path.join("_")}`;
    const ref =
      typeof value === "string" && value
        ? value
        : `${stem.replace(/[^a-z0-9_]/gi, "_").toUpperCase()}_API_KEY`;
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            disabled={credentialState[ref]?.writable === false}
            value={credentials[ref] ?? ""}
            placeholder={
              credentialState[ref]?.configured
                ? t("official.keyStored")
                : t("options.dshModels.apiKey")
            }
            onChange={(e) => {
              onCredential(ref, e.target.value);
              if (e.target.value && value !== ref) onChange(ref);
            }}
          />
          {credentialState[ref]?.configured && (
            <Button
              type="button"
              variant="ghost"
              disabled={credentialState[ref]?.writable === false}
              onClick={() => onCredential(ref, undefined)}
            >
              {t("common.delete")}
            </Button>
          )}
        </div>
        {ref in credentials && credentials[ref] === undefined && (
          <p className="text-xs text-muted-foreground">
            {t("official.keyWillRemove")}
          </p>
        )}
      </div>
    );
  }
  if (s.type === "object")
    return (
      <div className="space-y-3">
        {Object.entries(object(s.dict)).map(([key, child]) =>
          nested(
            child,
            object(value)[key],
            (v) => {
              const next = { ...object(value) };
              if (v === undefined) delete next[key];
              else next[key] = v;
              onChange(next);
            },
            key,
          ),
        )}
      </div>
    );
  if (s.type === "array" && !containsSecret(s)) {
    const rows = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-xs text-muted-foreground">{label}</legend>
        {rows.map((row, i) => (
          <div key={i} className="space-y-2 border-b border-border/50 pb-3">
            {nested(
              s.inner,
              row,
              (v) => onChange(rows.map((r, n) => (n === i ? v : r))),
              String(i),
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange(rows.filter((_, n) => n !== i))}
            >
              {t("common.delete")}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onChange([...rows, object(s.inner).type === "object" ? {} : ""])
          }
        >
          {t("official.addRow")}
        </Button>
      </fieldset>
    );
  }
  const choices =
    s.type === "union" && Array.isArray(s.list)
      ? s.list.map(object).filter((n) => n.type === "const")
      : [];
  if (choices.length && choices.length === (s.list as unknown[]).length)
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <select
          id={id}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={value === undefined ? "" : JSON.stringify(value)}
          onChange={(e) =>
            onChange(
              e.target.value === "" ? undefined : JSON.parse(e.target.value),
            )
          }
        >
          <option value="">{t("official.inherit")}</option>
          {choices.map((choice) => (
            <option
              key={JSON.stringify(choice.value)}
              value={JSON.stringify(choice.value)}
            >
              {String(choice.value)}
            </option>
          ))}
        </select>
      </div>
    );
  if (s.type === "boolean")
    return (
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        <Switch id={id} checked={value === true} onCheckedChange={onChange} />
      </div>
    );
  if (s.type === "const") return null;
  if (s.type === "string" || s.type === "number")
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type={
            meta.role === "secret"
              ? "password"
              : s.type === "number"
                ? "number"
                : "text"
          }
          autoComplete={meta.role === "secret" ? "new-password" : "off"}
          value={
            typeof value === "string" || typeof value === "number" ? value : ""
          }
          onChange={(e) =>
            onChange(
              e.target.value === ""
                ? undefined
                : s.type === "number"
                  ? Number(e.target.value)
                  : e.target.value,
            )
          }
        />
      </div>
    );
  return (
    <JsonField
      label={label}
      id={id}
      value={value}
      onChange={onChange}
      readOnly={containsSecret(s)}
    />
  );
}
function JsonField({
  label,
  id,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
}) {
  const [text, setText] = useState(
    value === undefined ? "" : JSON.stringify(value, null, 2),
  );
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        readOnly={readOnly}
        rows={4}
        className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          try {
            onChange(next.trim() ? JSON.parse(next) : undefined);
            e.target.setCustomValidity("");
          } catch {
            e.target.setCustomValidity("Invalid JSON");
          }
        }}
      />
    </div>
  );
}
export function OfficialProviderEditor({
  provider,
  snapshot,
  adapter,
  onClose,
  onSaved,
}: {
  provider: ModelProviderProfileShape;
  snapshot: ModelPlaneSnapshotShape;
  adapter: ProviderSettingsController;
  onClose: () => void;
  onSaved: (snapshot: ModelPlaneSnapshotShape) => void;
}) {
  const { t } = usePluginT(modelPlaneI18n);
  const [config, setConfig] = useState(provider.configuration);
  const [draft, setDraft] = useState<unknown>(
    provider.configuration?.value ?? {},
  );
  const [credentials, setCredentials] = useState<
    Record<string, string | undefined>
  >({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  async function refreshModels() {
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await adapter.discover({ provider });
      setNotice(`${t("official.refreshed")} (${result.models.length})`);
      const next = (await adapter.snapshot()).providers.find(
        (p) => p.id === provider.id,
      )?.configuration;
      if (next && config && equal(config.value, draft)) {
        setConfig(next);
        setDraft(next.value);
      }
    } catch (caught) {
      setError(String(caught));
    } finally {
      setPending(false);
    }
  }
  async function remove() {
    if (!window.confirm(t("options.dshModels.deleteConfirm"))) return;
    setPending(true);
    setError(undefined);
    try {
      onSaved(await adapter.remove(provider.id, snapshot.revision));
    } catch (caught) {
      setError(String(caught));
    } finally {
      setPending(false);
    }
  }
  async function save() {
    if (!config || !adapter.configure) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await adapter.configure(provider.id, {
        expectedRevision: config.revision,
        ops: configurationDiff(config.value, draft),
        credentials: Object.entries(credentials)
          .filter(([, value]) => value === undefined || value.trim())
          .map(([ref, value]) => ({
            ref,
            ...(value === undefined ? {} : { value: value.trim() }),
          })),
      });
      setCredentials({});
      onSaved(result);
    } catch (caught) {
      // Settings may have committed before a credential write failed. Refresh
      // its revision so retrying never repeats a stale whole-profile write.
      setError(String(caught));
      const latest = await adapter.snapshot().catch(() => undefined);
      const next = latest?.providers.find(
        (p) => p.id === provider.id,
      )?.configuration;
      if (next && equal(next.value, draft)) setConfig(next);
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{provider.displayName}</DialogTitle>
          <DialogDescription>
            {config
              ? t("official.configuration")
              : t("official.noConfiguration")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-4 p-1">
              {config && (
                <SchemaField
                  schema={config.schema}
                  value={draft}
                  onChange={setDraft}
                  path={[]}
                  providerId={provider.id}
                  credentials={credentials}
                  onCredential={(ref, value) =>
                    setCredentials((previous) => ({
                      ...previous,
                      [ref]: value,
                    }))
                  }
                  credentialState={snapshot.credentials}
                />
              )}
              {config && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => void refreshModels()}
                >
                  {t("official.refreshModels")}
                </Button>
              )}
              {notice && (
                <p role="status" className="text-xs text-muted-foreground">
                  {notice}
                </p>
              )}
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            {config?.removable && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => void remove()}
              >
                {t("common.delete")}
              </Button>
            )}
            {config && (
              <Button type="submit" disabled={pending || !provider.editable}>
                {t("common.save")}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

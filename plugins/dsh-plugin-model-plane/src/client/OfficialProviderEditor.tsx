import { jsonValue } from "./schema-object.js";
import { ChevronDown, RefreshCw } from "lucide-react";
import {
  providerFieldKeys,
  providerHelpKeys,
} from "./provider-field-presentation.js";
import { reasoningLabel } from "./reasoning-labels.js";
import {
  ProviderCardExtension,
  type ProviderCardRenderer,
} from "./model-settings-extensions.js";
import { useId, useState } from "react";
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
  ModelIcon,
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
  return [{ op: "set", path, value: jsonValue(after) }];
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
  const field =
    providerFieldKeys[path.at(-1) ?? ""] ??
    (meta.role === "credential-ref" || meta.role === "secret"
      ? "apiKeyEnv"
      : undefined);
  const label = path.includes("thinkingBudgets")
    ? reasoningLabel({ id: path.at(-1) ?? "" }, t)
    : field
      ? t(`provider.field.${field}`)
      : typeof meta.description === "string"
        ? meta.description
        : (path.at(-1) ?? "")
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replace(/[_-]/g, " ");
  const id = `provider-field-${providerId}-${path.join("-")}`;
  const help =
    field && providerHelpKeys.has(field)
      ? t(`provider.help.${field}`)
      : undefined;
  const description = help ? (
    <p
      id={`${id}-help`}
      className="text-xs leading-relaxed text-muted-foreground"
    >
      {help}
    </p>
  ) : null;
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
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={id} className="text-sm font-medium">
            {label}
          </Label>
          {credentialState[ref]?.configured &&
            !(ref in credentials && credentials[ref] === undefined) && (
              <span className="text-xs text-muted-foreground">
                {t("provider.keySaved")}
              </span>
            )}
        </div>
        {description}
        <div className="flex items-center gap-2">
          <Input
            id={id}
            aria-describedby={help ? `${id}-help` : undefined}
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
              {t("provider.removeKey")}
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
      <fieldset className="min-w-0 space-y-5">
        {path.length > 0 && !/^\d+$/.test(path.at(-1) ?? "") && (
          <legend className="mb-2 text-sm font-semibold">{label}</legend>
        )}
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
      </fieldset>
    );
  if (s.type === "array" && !containsSecret(s)) {
    const rows = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">{label}</legend>
        {description}
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
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <select
          id={id}
          aria-describedby={help ? `${id}-help` : undefined}
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
              {field === "reasoningEffort"
                ? reasoningLabel({ id: String(choice.value) }, t)
                : ["enabled", "disabled", "auto", "adaptive"].includes(
                      String(choice.value),
                    ) && field === "thinking"
                  ? t(`provider.choice.${choice.value}`)
                  : String(choice.value)}
            </option>
          ))}
        </select>
        {description}
      </div>
    );
  if (s.type === "boolean")
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <Label htmlFor={id} className="text-sm font-medium">
            {label}
          </Label>
          {description}
        </div>
        <Switch id={id} checked={value === true} onCheckedChange={onChange} />
      </div>
    );
  if (s.type === "const") return null;
  if (s.type === "string" || s.type === "number")
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <Input
          id={id}
          type={
            meta.role === "secret"
              ? "password"
              : s.type === "number"
                ? "number"
                : "text"
          }
          aria-describedby={help ? `${id}-help` : undefined}
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
        {description}
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
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
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
const connectionFields = new Set([
  "apiKeyEnv",
  "apiKey",
  "baseURL",
  "baseUrl",
  "endpoint",
  "displayName",
  "region",
  "projectId",
  "organization",
]);
function ProviderConfiguration(props: Parameters<typeof SchemaField>[0]) {
  const { t } = usePluginT(modelPlaneI18n);
  const schema = object(props.schema);
  if (schema.type !== "object") return <SchemaField {...props} />;
  const fields = Object.entries(object(schema.dict));
  const connection = fields.filter(
    ([key, field]) =>
      connectionFields.has(key) ||
      containsSecret(field) ||
      object(object(field).meta).role === "credential-ref",
  );
  const advanced = fields.filter((entry) => !connection.includes(entry));
  const render = ([key, child]: [string, unknown]) => (
    <SchemaField
      {...props}
      key={key}
      schema={child}
      path={[key]}
      value={object(props.value)[key]}
      onChange={(value) => {
        const next = { ...object(props.value) };
        if (value === undefined) delete next[key];
        else next[key] = value;
        props.onChange(next);
      }}
    />
  );
  return (
    <>
      {connection.length > 0 && (
        <div className="space-y-5">{connection.map(render)}</div>
      )}
      {advanced.length > 0 && (
        <details
          className="group border-t border-border/50 pt-5"
          data-provider-advanced
        >
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
            {t("provider.options")}
          </summary>
          <div className="space-y-5 pt-5">
            {advanced.map((entry) => (
              <section key={entry[0]} className="min-w-0">
                {render(entry)}
              </section>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
export function OfficialProviderEditor({
  provider,
  snapshot,
  adapter,
  onClose,
  onSaved,
  renderProviderCard,
  displayModels,
  onRefreshed,
}: {
  provider: ModelProviderProfileShape;
  displayModels?: ModelProviderProfileShape["models"];
  onRefreshed?: (snapshot: ModelPlaneSnapshotShape) => void;
  snapshot: ModelPlaneSnapshotShape;
  adapter: ProviderSettingsController;
  renderProviderCard?: ProviderCardRenderer;
  onClose: () => void;
  onSaved: (snapshot: ModelPlaneSnapshotShape) => void;
}) {
  const { t } = usePluginT(modelPlaneI18n);
  const formId = useId();
  const [config, setConfig] = useState(provider.configuration);
  const models = displayModels ?? provider.models;
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
      await adapter.discover({ provider });
      const latest = await adapter.snapshot();
      onRefreshed?.(latest);
      setNotice(t("official.refreshed"));
      const next = latest.providers.find(
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
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        size="full"
        className="!flex h-[min(90dvh,52rem)] flex-col gap-0 overflow-hidden p-0"
        data-provider-config-dialog
      >
        <DialogHeader className="shrink-0 border-b border-border/50 px-6 py-5 pr-12 text-left">
          <div className="flex items-center gap-3">
            <ModelIcon
              model=""
              provider={provider.id}
              className="h-7 w-7 shrink-0"
            />
            <DialogTitle className="text-lg tracking-tight">
              {provider.displayName}
            </DialogTitle>
          </div>
          <DialogDescription>
            {config
              ? t("official.configuration")
              : t("official.noConfiguration")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <section
            className="flex h-48 min-h-0 shrink-0 flex-col border-b border-border/50 md:h-auto md:w-[36%] md:border-b-0 md:border-r"
            aria-label={t("options.models.provider.models")}
          >
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-3 px-6 py-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    {t("options.models.provider.models")}{" "}
                    <span className="ml-1 font-normal text-muted-foreground">
                      {models.length}
                    </span>
                  </h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground"
                    disabled={pending}
                    onClick={() => void refreshModels()}
                  >
                    <RefreshCw className="h-3 w-3" />
                    {t("provider.refresh")}
                  </Button>
                </div>
                {models.length > 0 ? (
                  <ul className="divide-y divide-border/40">
                    {models.map((model) => (
                      <li
                        key={model.id}
                        className="flex min-w-0 flex-col gap-0.5 py-2.5"
                      >
                        <span className="text-sm">
                          {model.name || model.id}
                        </span>
                        {model.name && model.name !== model.id && (
                          <span className="truncate text-xs text-muted-foreground">
                            {model.id}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("options.models.provider.noModels")}
                  </p>
                )}
              </div>
            </ScrollArea>
          </section>
          <ScrollArea
            className="min-h-0 min-w-0 flex-1"
            data-provider-config-scroll
          >
            <div className="space-y-6 px-6 py-5">
              <form
                id={formId}
                onInvalidCapture={(event) => {
                  let parent = event.target as HTMLElement | null;
                  while (parent) {
                    if (parent instanceof HTMLDetailsElement)
                      parent.open = true;
                    parent = parent.parentElement;
                  }
                }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <fieldset
                  disabled={pending || !provider.editable}
                  className="min-w-0 space-y-6"
                >
                  <ProviderConfiguration
                    schema={config?.schema ?? { type: "object", dict: {} }}
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
                </fieldset>
              </form>
              <ProviderCardExtension
                owner={provider.providerCard}
                render={renderProviderCard}
              />
            </div>
          </ScrollArea>
        </div>
        {(notice || error) && (
          <div
            className="max-h-24 shrink-0 overflow-y-auto px-6 py-2"
            aria-live="polite"
          >
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
        )}
        <DialogFooter className="shrink-0 gap-2 border-t border-border/50 px-6 py-4 sm:items-center sm:space-x-0">
          {config?.removable && (
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground sm:mr-auto"
              disabled={pending}
              onClick={() => void remove()}
            >
              {t("provider.removeProvider")}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
          {config && (
            <Button
              form={formId}
              type="submit"
              disabled={pending || !provider.editable}
            >
              {t("common.save")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

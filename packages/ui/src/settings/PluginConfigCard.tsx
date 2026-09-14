import { useId } from "react";
import { Button, Input } from "../primitives";
import { usePluginT } from "@amiba/i18n/plugin";

export interface PluginConfigField {
  name: string;
  label: string;
  text: string;
  overridden: boolean;
  invalid: boolean;
  secret?: boolean;
  disabled?: boolean;
  hint?: string;
}
export interface PluginConfigCardProps {
  title: string;
  state: {
    available: boolean;
    writable: boolean;
    dirty: boolean;
    invalid: boolean;
    saving: boolean;
    failed: boolean;
  };
  fields: readonly PluginConfigField[];
  edit(field: string, text: string): void;
  resetField(field: string): void;
  save(): void;
  discard(): void;
}

/** Presentation only: the official controller owns staged values and all writes. */
export function PluginConfigCard({
  title,
  state,
  fields,
  edit,
  resetField,
  save,
  discard,
}: PluginConfigCardProps) {
  const prefix = useId();
  const { language } = usePluginT();
  const zh = language === "zh-CN";
  if (!state.available) return null;
  const locked = !state.writable || state.saving;
  return (
    <form
      aria-label={title}
      className="mx-6 mb-4 space-y-4 rounded-lg border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!locked && state.dirty && !state.invalid) save();
      }}
    >
      <h3 className="text-sm font-medium">{title}</h3>
      {!state.writable && (
        <p className="text-xs text-muted-foreground">
          {zh
            ? "当前连接仅可读取配置。"
            : "Configuration is read-only for this connection."}
        </p>
      )}
      {fields.map((field) => (
        <div key={field.name} className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm" htmlFor={`${prefix}-${field.name}`}>
              {field.label}
            </label>
            {!field.secret && field.overridden && (
              <span className="text-xs text-muted-foreground">
                {zh ? "已自定义" : "Overridden"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              id={`${prefix}-${field.name}`}
              type={field.secret ? "password" : "text"}
              autoComplete={field.secret ? "new-password" : "off"}
              value={field.text}
              disabled={locked || field.disabled}
              aria-invalid={field.invalid || undefined}
              aria-describedby={
                field.hint ? `${prefix}-${field.name}-hint` : undefined
              }
              onChange={(event) => edit(field.name, event.target.value)}
            />
            {!field.secret && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={locked || !field.overridden}
                onClick={() => resetField(field.name)}
              >
                {zh ? "恢复继承" : "Reset"}
              </Button>
            )}
          </div>
          {field.hint && (
            <p
              id={`${prefix}-${field.name}-hint`}
              className="text-xs text-muted-foreground"
            >
              {field.hint}
            </p>
          )}
          {field.invalid && (
            <p role="alert" className="text-xs text-destructive">
              {zh ? "请输入有效值。" : "Enter a valid value."}
            </p>
          )}
        </div>
      ))}
      {state.failed && (
        <p role="alert" className="text-sm text-destructive">
          {zh
            ? "保存未成功，修改已保留，请检查后重试。"
            : "Changes were not saved. Your edits are preserved; check them and retry."}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!state.dirty || state.saving}
          onClick={discard}
        >
          {zh ? "撤销修改" : "Discard"}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={locked || !state.dirty || state.invalid}
        >
          {state.saving ? (zh ? "保存中…" : "Saving…") : zh ? "保存" : "Save"}
        </Button>
      </div>
    </form>
  );
}

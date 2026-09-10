import { useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { Button, Switch, usePluginT } from "@amiba/ui/plugin";
import type { ConnectSettingsHost } from "@amiba/dsh-plugin-connector-core/client";
import type { PersonalAuthorization, PersonalStatus } from "../personal.js";
import type {
  LarkPersonalRemote,
  PersonalRequest,
  PersonalResult,
} from "../personal-remote.js";
import { personalI18n } from "./i18n-personal.js";
export function LarkPersonalSettings({
  host,
  remote,
}: {
  host: ConnectSettingsHost;
  remote: LarkPersonalRemote;
}) {
  const { t } = usePluginT(personalI18n);
  const [status, setStatus] = useState<PersonalStatus>();
  const [flow, setFlow] = useState<PersonalAuthorization>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const alive = useRef(false),
    pending = useRef<PersonalAuthorization>();
  const id = host.connect.id;
  const call = async (
    input: Omit<PersonalRequest, "connectionId">,
  ): Promise<PersonalResult> => {
    const result = await remote.manage({ ...input, connectionId: id });
    if (!result.ok) throw new Error("personal_authorization_failed");
    return result.value;
  };
  useEffect(() => {
    alive.current = true;
    if (host.connect.enabled)
      void call({ action: "status" }).then(
        (result) => {
          if (alive.current) setStatus(result.status);
        },
        () => {
          if (alive.current) setError(true);
        },
      );
    return () => {
      alive.current = false;
      const active = pending.current;
      if (active?.state === "pending")
        void remote
          .manage({ action: "cancel", connectionId: id, flowId: active.id })
          .catch(() => undefined);
    };
  }, [id, remote, host.connect.enabled]);
  useEffect(() => {
    if (!flow || flow.state !== "pending") return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await call({ action: "poll", flowId: flow.id });
        if (stopped) return;
        const next = result.authorization!;
        pending.current = next;
        setFlow(next);
        if (next.state === "completed") {
          const current = await call({ action: "status" });
          if (!stopped) setStatus(current.status);
        } else if (next.state === "pending")
          timer = setTimeout(() => void poll(), 5000);
      } catch {
        if (!stopped) setError(true);
      }
    };
    timer = setTimeout(() => void poll(), 5000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [flow?.id, remote, id]);
  const run = (action: () => Promise<void>) => {
    setBusy(true);
    setError(false);
    void action()
      .catch(() => {
        if (alive.current) setError(true);
      })
      .finally(() => {
        if (alive.current) setBusy(false);
      });
  };
  const begin = () =>
    run(async () => {
      const result = await call({ action: "begin" });
      if (!alive.current) {
        if (result.authorization)
          await call({ action: "cancel", flowId: result.authorization.id });
        return;
      }
      pending.current = result.authorization;
      setFlow(result.authorization);
    });
  const qr =
    flow?.state === "pending"
      ? (() => {
          const code = qrcode(0, "M");
          code.addData(flow.verificationUrl);
          code.make();
          return code.createDataURL(4, 12);
        })()
      : undefined;
  return (
    <section className="space-y-5 py-4" aria-labelledby="lark-personal-heading">
      <div className="space-y-2">
        <h3 id="lark-personal-heading" className="text-base font-semibold">
          {t("lark.personal.title")}
        </h3>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {t("lark.personal.description")}
        </p>
      </div>
      {!host.connect.enabled ? (
        <p className="text-sm text-muted-foreground">
          {t("lark.personal.enable")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              {status
                ? status.access.label || t("lark.personal.unauthorized")
                : t("lark.personal.loading")}
            </p>
            <Button disabled={busy} variant="outline" onClick={begin}>
              {t(
                status?.access.state === "authorized"
                  ? "lark.personal.retry"
                  : "lark.personal.connect",
              )}
            </Button>
          </div>
          {qr && flow && (
            <div className="flex flex-wrap items-center gap-6 rounded-xl bg-muted/30 p-5">
              <img
                src={qr}
                alt={t("lark.personal.scan")}
                className="h-40 w-40 rounded-lg"
              />
              <div className="space-y-3">
                <p className="text-sm font-medium">{t("lark.personal.scan")}</p>
                <p className="font-mono text-sm">{flow.userCode}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" asChild>
                    <a
                      href={flow.verificationUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("lark.personal.browser")}
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      run(async () => {
                        await call({ action: "cancel", flowId: flow.id });
                        pending.current = undefined;
                        setFlow(undefined);
                      })
                    }
                  >
                    {t("lark.personal.cancel")}
                  </Button>
                </div>
              </div>
            </div>
          )}
          {flow?.state === "expired" && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("lark.personal.expired")}
            </p>
          )}
          <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
            {t("lark.personal.scopes")}
          </p>
          {status?.access.state === "authorized" && (
            <>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {status.access.capabilities.map((capability, index) => (
                  <span
                    key={capability.id}
                    className={
                      capability.available
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }
                  >
                    {t(
                      [
                        "lark.personal.contacts",
                        "lark.personal.search",
                        "lark.personal.read",
                      ][index]!,
                    )}{" "}
                    · {capability.available ? "✓" : t("lark.personal.missing")}
                  </span>
                ))}
              </div>
              <label className="flex items-start justify-between gap-6 py-2">
                <span className="space-y-1">
                  <span className="block text-sm font-medium">
                    {t("lark.personal.agent")}
                  </span>
                  <span className="block max-w-xl text-sm leading-6 text-muted-foreground">
                    {t("lark.personal.agentDescription")}
                  </span>
                </span>
                <Switch
                  checked={status.modelAccess}
                  disabled={busy}
                  onCheckedChange={(allowed) =>
                    run(async () => {
                      const result = await call({
                        action: "model-access",
                        allowed,
                      });
                      if (alive.current) setStatus(result.status);
                    })
                  }
                />
              </label>
            </>
          )}
          {status?.access.identity === "user" && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await call({ action: "disconnect" });
                  if (alive.current) {
                    setStatus(result.status);
                    setFlow(undefined);
                    pending.current = undefined;
                  }
                })
              }
            >
              {t("lark.personal.disconnect")}
            </Button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t("lark.personal.error")}
        </p>
      )}
    </section>
  );
}

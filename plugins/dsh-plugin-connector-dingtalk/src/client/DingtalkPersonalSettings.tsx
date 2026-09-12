import { useEffect, useRef, useState } from "react";
import { Check, FileText, MessageSquare } from "lucide-react";
import qrcode from "qrcode-generator";
import { Button, Switch, usePluginT } from "@amiba/ui/plugin";
import type { ConnectSettingsHost } from "@amiba/dsh-plugin-connector-core/client";
import type { PersonalAuthorization, PersonalStatus } from "../personal.js";
import type {
  DingtalkPersonalRemote,
  PersonalRequest,
  PersonalResult,
} from "../personal-remote.js";
import { personalI18n } from "./i18n-personal.js";

export function DingtalkPersonalSettings({
  host,
  remote,
  onDone,
  autoStart = false,
}: {
  host: ConnectSettingsHost;
  remote: DingtalkPersonalRemote;
  onDone?: () => void;
  autoStart?: boolean;
}) {
  const { t } = usePluginT(personalI18n);
  const [status, setStatus] = useState<PersonalStatus>();
  const [flow, setFlow] = useState<PersonalAuthorization>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const alive = useRef(false),
    pending = useRef<PersonalAuthorization>();
  // Only the explicit “let AI read” action authorizes enabling model access.
  // Merely opening settings never changes a user's existing access choice.
  const consent = useRef(false);
  const id = host.connect.id;
  const call = async (
    input: Omit<PersonalRequest, "connectionId">,
  ): Promise<PersonalResult> => {
    const result = await remote.manage({ ...input, connectionId: id });
    if (!result.ok) throw new Error("connection_action_failed");
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
      consent.current = false;
      const active = pending.current;
      if (active?.state === "pending")
        void remote
          .manage({ action: "cancel", connectionId: id, flowId: active.id })
          .catch(() => undefined);
    };
  }, [id, remote, host.connect.enabled]);
  useEffect(() => {
    if (!flow || flow.state !== "pending") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await call({ action: "poll", flowId: flow.id });
        if (stopped) return;
        const next = result.authorization!;
        pending.current = next;
        setFlow(next);
        if (next.state === "completed") {
          const current = await call(
            consent.current
              ? { action: "complete-connection" }
              : { action: "status" },
          );
          if (!stopped) {
            consent.current = false;
            setStatus(current.status);
            setError(false);
          }
        } else if (next.state === "pending")
          timer = setTimeout(() => void poll(), 5000);
      } catch {
        if (!stopped) {
          setError(true);
          timer = setTimeout(() => void poll(), 5000);
        }
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
  const authorized = status?.access.state === "authorized";
  const docsGranted = [
    "dingtalk:documents:search",
    "dingtalk:documents:read",
  ].every((scope) =>
    status?.access.capabilities.some((c) => c.id === scope && c.available),
  );
  const documentsReady = authorized && docsGranted && status.modelAccess;
  const ready = documentsReady && status.work === "ready";
  const connect = () =>
    run(async () => {
      if (authorized && docsGranted) {
        const current = await call({ action: "complete-connection" });
        if (alive.current) setStatus(current.status);
        return;
      }
      consent.current = true;
      const result = await call({ action: "begin" });
      if (!alive.current) {
        if (result.authorization)
          await call({ action: "cancel", flowId: result.authorization.id });
        return;
      }
      pending.current = result.authorization;
      setFlow(result.authorization);
    });
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current || !status || !host.connect.enabled)
      return;
    started.current = true;
    if (!ready) connect();
  }, [autoStart, !!status, host.connect.enabled]);
  useEffect(() => {
    if (status?.work !== "pending") return;
    let stopped = false;
    const timer = setTimeout(() => {
      void call({ action: "status" }).then(
        (result) => {
          if (!stopped) setStatus(result.status);
        },
        () => {
          if (!stopped) {
            setError(true);
            setStatus((current) =>
              current ? { ...current, work: "unavailable" } : current,
            );
          }
        },
      );
    }, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [status, id, remote]);
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
    <section
      className="space-y-6 py-4"
      aria-labelledby="dingtalk-personal-heading"
    >
      <div className="space-y-2">
        {onDone && (
          <p className="text-xs text-muted-foreground">
            {t("dingtalk.personal.step")}
          </p>
        )}
        <h3 id="dingtalk-personal-heading" className="text-lg font-semibold">
          {t("dingtalk.personal.title")}
        </h3>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {t("dingtalk.personal.description")}
        </p>
      </div>
      <div className="divide-y divide-border/50">
        <div className="flex gap-3 py-4">
          <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium">
              {t("dingtalk.personal.messaging")}
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              {t("dingtalk.personal.messagingHint")}
            </p>
          </div>
          <span className="max-w-40 shrink-0 text-right text-xs leading-5 text-muted-foreground">
            {t(
              host.connect.status.state === "ready"
                ? "dingtalk.personal.messagesReady"
                : host.connect.status.state === "connecting"
                  ? "dingtalk.personal.messagesWaiting"
                  : "dingtalk.personal.messagesError",
            )}
          </span>
        </div>
        <div className="flex gap-3 py-4">
          <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("dingtalk.personal.docs")}</p>
            <p className="text-sm leading-6 text-muted-foreground">
              {t("dingtalk.personal.docsHint")}
            </p>
            <p role="status" className="flex items-center gap-2 text-sm">
              {ready && <Check className="h-4 w-4" />}
              {t(
                !host.connect.enabled
                  ? "dingtalk.personal.enable"
                  : !status
                    ? "dingtalk.personal.loading"
                    : status?.work === "pending"
                      ? "dingtalk.personal.finishing"
                      : ready
                        ? "dingtalk.personal.ready"
                        : authorized && !docsGranted
                          ? "dingtalk.personal.partial"
                          : authorized
                            ? "dingtalk.personal.paused"
                            : "dingtalk.personal.unauthorized",
              )}
            </p>
          </div>
        </div>
      </div>
      {host.connect.enabled && (
        <>
          {!ready && !qr && status?.work !== "pending" && (
            <div className="space-y-3">
              {authorized && !docsGranted && (
                <p className="text-sm text-muted-foreground">
                  {t("dingtalk.personal.partialHint")}
                </p>
              )}
              <Button disabled={busy || (!status && !error)} onClick={connect}>
                {t(
                  authorized && docsGranted
                    ? "dingtalk.personal.resume"
                    : "dingtalk.personal.connect",
                )}
              </Button>
              <p className="max-w-xl text-xs leading-5 text-muted-foreground">
                {t("dingtalk.personal.consent")}
              </p>
            </div>
          )}
          {qr && flow && (
            <div className="flex flex-wrap items-center gap-6 rounded-xl bg-muted/30 p-5">
              <img
                src={qr}
                alt={t("dingtalk.personal.scan")}
                className="h-40 w-40 rounded-lg"
              />
              <div className="max-w-sm space-y-3">
                <p className="text-sm font-medium">
                  {t("dingtalk.personal.scan")}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t("dingtalk.personal.consent")}
                </p>
                {flow.userCode && (
                  <p className="font-mono text-sm">{flow.userCode}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" asChild>
                    <a
                      href={flow.verificationUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("dingtalk.personal.browser")}
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        consent.current = false;
                        await call({ action: "cancel", flowId: flow.id });
                        if (alive.current) {
                          pending.current = undefined;
                          setFlow(undefined);
                        }
                      })
                    }
                  >
                    {t("dingtalk.personal.cancel")}
                  </Button>
                </div>
              </div>
            </div>
          )}
          {flow?.state === "expired" && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("dingtalk.personal.expired")}
            </p>
          )}
          {status?.work === "pending" && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("dingtalk.personal.finishing")}
            </p>
          )}
          {ready && onDone && (
            <Button onClick={onDone}>{t("dingtalk.personal.finish")}</Button>
          )}
          {status?.access.identity === "user" && (
            <details className="space-y-4">
              <summary className="cursor-pointer text-sm text-muted-foreground">
                {t("dingtalk.personal.advanced")}
                {status.access.label ? ` · ${status.access.label}` : ""}
              </summary>
              <label className="flex items-start justify-between gap-6">
                <span className="space-y-1">
                  <span className="block text-sm font-medium">
                    {t("dingtalk.personal.agent")}
                  </span>
                  <span className="block max-w-xl text-xs leading-5 text-muted-foreground">
                    {t("dingtalk.personal.agentDescription")}
                  </span>
                </span>
                <Switch
                  checked={status.modelAccess}
                  disabled={busy || !!qr}
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
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    consent.current = false;
                    const result = await call({ action: "disconnect" });
                    if (alive.current) {
                      setStatus(result.status);
                      setFlow(undefined);
                      pending.current = undefined;
                    }
                  })
                }
              >
                {t("dingtalk.personal.disconnect")}
              </Button>
            </details>
          )}
        </>
      )}
      <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
        {t("dingtalk.personal.boundary")}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t("dingtalk.personal.error")}
        </p>
      )}
    </section>
  );
}

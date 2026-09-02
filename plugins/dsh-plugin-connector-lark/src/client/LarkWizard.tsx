import { Loader2, Plus, QrCode } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import qrcode from "qrcode-generator";

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  usePluginT,
  type PluginTranslateFn,
} from "@amiba/ui/plugin";
import type { ConnectWizardHost } from "@amiba/dsh-plugin-connector-core/client";

import { larkI18n } from "./i18n.js";

/**
 * The onboarding snapshot the center hands back, derived from the host's own
 * adapter signature instead of importing connector-core's Host-side
 * `types.js`. Keeps this body's only connector-core dependency the type of
 * the `host` prop it is already handed.
 */
type OnboardingView = Awaited<
  ReturnType<ConnectWizardHost["adapter"]["pollOnboarding"]>
>;

/** Poll cadence for `adapter.pollOnboarding` while a scan session is pending. */
const ONBOARD_POLL_INTERVAL_MS = 1500;

/**
 * Wraps `usePluginT` with this plugin's own i18n overlay (see `./i18n.ts`) —
 * same convention connector-core's own client files use, so overlay-covered
 * keys resolve locally instead of depending on a host `options.connect.*`
 * bundle that no longer carries them.
 */
function useT() {
  return usePluginT(larkI18n);
}

/**
 * The onboarding failure codes this wizard owns copy for. Everything else —
 * including connector-core's connect-lifecycle codes — falls through to the
 * raw message rather than duplicating core's vocabulary here (see `./i18n.ts`).
 */
const KNOWN_ERRORS: Record<string, string> = {
  onboarding_not_found: "options.connect.dsh.error.onboarding_not_found",
  onboarding_unsupported: "options.connect.dsh.error.onboarding_unsupported",
};

function describeError(t: PluginTranslateFn, cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const key = KNOWN_ERRORS[message];
  return key ? t(key) : message;
}

/**
 * Maps a raw onboarding `statusNote` token — the lark provider forwards the
 * Lark SDK's `registerApp` `onStatusChange` status string verbatim through
 * `handle.emit({ kind: "status", note: status })` (see `../provider.ts`) — to
 * translated copy. The provider keeps emitting the SDK's own stable token
 * untouched and translation, a presentation concern, lives entirely here. A
 * token this dict hasn't caught up with falls back to the raw string rather
 * than showing nothing.
 */
const KNOWN_STATUS_NOTES: Record<string, string> = {
  polling: "options.connect.dsh.onboard.note.polling",
  slow_down: "options.connect.dsh.onboard.note.slow_down",
  domain_switched: "options.connect.dsh.onboard.note.domain_switched",
};

function describeStatusNote(t: PluginTranslateFn, note: string): string {
  const key = KNOWN_STATUS_NOTES[note];
  return key ? t(key) : note;
}

/**
 * The Lark/Feishu connect wizard body, mounted by connector-core's
 * `ConnectWizardChrome` for the `"lark"` provider. Two ways in:
 *
 * - **scan** (default): `beginOnboarding` opens a session, a 1.5s poll drives
 *   the QR + status pane, and a `completed` view hands the created connect
 *   straight to `host.done`.
 * - **manual**: App ID / App Secret / Domain, submitted through
 *   `host.adapter.create`.
 *
 * Depends on nothing from connector-core but the `host` prop (its type aside),
 * so the same body works in the settings modal and, later, in the composer.
 */
export function LarkWizard({ host }: { host: ConnectWizardHost }): ReactNode {
  const { t } = useT();
  // The chrome rebuilds `host` on every render and the user can still be
  // typing the connect name / switching the preset while a scan is in flight,
  // so every call site reads through this ref AT CALL TIME instead of closing
  // over the render's `host`. That also keeps the callbacks below dependency-
  // free, which is what lets the unmount teardown be a true unmount-only
  // effect rather than one that re-runs on each keystroke.
  const hostRef = useRef(host);
  hostRef.current = host;

  const [mode, setMode] = useState<"scan" | "manual">("scan");
  const [onboarding, setOnboarding] = useState<OnboardingView | null>(null);
  const [beginning, setBeginning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [domain, setDomain] = useState("feishu");

  // `sessionIdRef`/`pollRef` are refs (not state): they're read from
  // interval/cleanup callbacks that must always see the latest value without
  // re-subscribing, and writing them must never itself trigger a render.
  const sessionIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards against a slow poll response overlapping with the next tick.
  const pollingRef = useRef(false);
  // Bumped every time the current onboarding context is torn down (mode
  // switched, component unmounted — see `cancelCurrentSession`). `beginScan`
  // snapshots this before calling `adapter.beginOnboarding` and compares it
  // after the await resolves: if it moved on, the just-created session belongs
  // to a context nobody's looking at anymore and gets cancelled instead of
  // silently adopted.
  const sessionContextRef = useRef(0);
  // True while this component instance is mounted. `beginScan`/`poll` await an
  // adapter call that can outlive the component (the modal closes, or the whole
  // settings page unmounts, mid-request); checking this ref after the await —
  // alongside the `sessionIdRef` comparison in `poll` — stops that stale
  // response from resurrecting state, starting a poll interval nothing will
  // ever clear, or firing `host.done`/`setError` on a component nobody is
  // looking at.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearPollInterval = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /**
   * Tears down whatever onboarding session is currently live: stops the poll
   * interval, forgets the local session id, fires a best-effort cancel to the
   * adapter for the session that was live (a fire-and-forget from a change
   * handler or an effect cleanup has nowhere to surface a failure and nothing
   * to await), resets the onboarding view, and bumps `sessionContextRef` so a
   * `beginOnboarding` call already in flight treats its eventual response as
   * belonging to a dead context (see `beginScan`'s staleness guard).
   *
   * Shared by the scan→manual switch and the unmount cleanup — the two places
   * a scan session's context disappears out from under it — so a QR already
   * displayed to the host never outlives the UI that showed it and isn't left
   * for the 10-minute host-side GC.
   */
  const cancelCurrentSession = useCallback(() => {
    clearPollInterval();
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    sessionContextRef.current += 1;
    if (sessionId) {
      void Promise.resolve()
        .then(() => hostRef.current.adapter.cancelOnboarding(sessionId))
        .catch(() => {});
    }
    if (mountedRef.current) setOnboarding(null);
  }, [clearPollInterval]);

  // Unmount teardown. `cancelCurrentSession` is dependency-stable, so this
  // cleanup runs exactly once — when the wizard goes away (the modal closes,
  // the chrome swaps in another provider's body, the settings page unmounts).
  // It is declared AFTER the `mountedRef` effect on purpose: React runs
  // cleanups in declaration order, so `mountedRef` is already false by the
  // time this one runs and the teardown skips its `setOnboarding`.
  useEffect(() => {
    return () => {
      cancelCurrentSession();
    };
  }, [cancelCurrentSession]);

  /**
   * Scan <-> manual toggle. Leaving scan mid-flight must not leave the
   * just-displayed QR live host-side; `cancelCurrentSession` is a no-op when
   * there's nothing to cancel, so this is safe on every switch rather than
   * only the scan-to-manual direction. Switching back to scan intentionally
   * starts fresh: nothing here re-adopts the session just cancelled or begins
   * a new one — the user has to click "Start scanning" again.
   */
  function handleModeChange(next: "scan" | "manual") {
    setMode(next);
    cancelCurrentSession();
  }

  const poll = useCallback(async () => {
    if (pollingRef.current) return;
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    pollingRef.current = true;
    try {
      const view = await hostRef.current.adapter.pollOnboarding(sessionId);
      // Stale-response guard: the component may have unmounted, or the session
      // may have been torn down (mode switched, a newer session started) while
      // this request was in flight. Comparing against the id this poll started
      // with catches every teardown path; `mountedRef` additionally covers the
      // pathological case of a still-current session id on an unmounted
      // instance. Bail before touching any state rather than resurrect a dead
      // session.
      if (!mountedRef.current || sessionIdRef.current !== sessionId) return;
      setOnboarding(view);
      if (view.state === "pending") return;
      // Terminal state: stop polling and let go of the session id so a later
      // unmount doesn't also fire a redundant cancel.
      sessionIdRef.current = null;
      clearPollInterval();
      if (view.state === "completed") {
        // `connect` is only guaranteed alongside `completed`; a completed view
        // without one is a broken response, not a successful connect, so it
        // takes the error path instead of handing `undefined` to the chrome.
        if (view.connect) {
          hostRef.current.done(view.connect);
          return;
        }
        setError(t("options.connect.dsh.onboard.error.generic"));
        setOnboarding(null);
      } else if (view.state === "error") {
        setError(
          view.error
            ? describeError(t, new Error(view.error))
            : t("options.connect.dsh.onboard.error.generic"),
        );
        // Terminal error, no live session left to retry into: drop the
        // onboarding view so `!onboarding` goes back to true and the begin
        // button re-renders. The error paragraph (set just above) stays visible
        // until the next `beginScan()` call clears it.
        setOnboarding(null);
      }
    } catch (cause) {
      if (!mountedRef.current || sessionIdRef.current !== sessionId) return;
      sessionIdRef.current = null;
      clearPollInterval();
      setError(describeError(t, cause));
    } finally {
      pollingRef.current = false;
    }
  }, [clearPollInterval, t]);

  async function beginScan() {
    const current = hostRef.current;
    const name = current.connectName.trim();
    const agentPreset = current.agentPreset.trim();
    if (!name) return;
    setError(null);
    setBeginning(true);
    // Snapshot the session context before the round trip: `beginOnboarding`
    // can outlive the context it was called for (mode switched) while this
    // component stays mounted the whole time — see `cancelCurrentSession`,
    // which is what bumps this ref.
    const sessionContextAtStart = sessionContextRef.current;
    try {
      const view = await current.adapter.beginOnboarding({
        provider: current.providerId,
        name,
        agentPreset,
      });
      // Same stale-response concern as `poll`, extended: the wizard may have
      // unmounted while `beginOnboarding` was in flight (`mountedRef`), or it
      // is still mounted but the mode flipped out from under this call
      // (`sessionContextRef` moved on).
      const stale =
        !mountedRef.current ||
        sessionContextRef.current !== sessionContextAtStart;
      if (stale) {
        // A `pending` view means the center already created a live session
        // (and possibly issued a QR) for a context that's gone. Cancel it now
        // instead of leaving it to the 10-minute host-side GC — this session
        // was never adopted into `sessionIdRef` for `cancelCurrentSession` to
        // find, so the fire-and-forget is inlined here.
        if (view.state === "pending") {
          void Promise.resolve()
            .then(() => current.adapter.cancelOnboarding(view.sessionId))
            .catch(() => {});
        }
        return;
      }
      setOnboarding(view);
      if (view.state === "pending") {
        sessionIdRef.current = view.sessionId;
        clearPollInterval();
        pollRef.current = setInterval(() => {
          void poll();
        }, ONBOARD_POLL_INTERVAL_MS);
        return;
      }
      if (view.state === "completed") {
        if (view.connect) {
          current.done(view.connect);
          return;
        }
        setError(t("options.connect.dsh.onboard.error.generic"));
        setOnboarding(null);
        return;
      }
      if (view.state === "error") {
        setError(
          view.error
            ? describeError(t, new Error(view.error))
            : t("options.connect.dsh.onboard.error.generic"),
        );
        // Terminal error on the very first response: no live session to retry
        // into. Drop the onboarding view so the begin button re-renders, same
        // as the poll-error path.
        setOnboarding(null);
      }
      // "cancelled" as an initial state is not expected from a fresh begin
      // call; nothing further to render if the center ever returns it.
    } catch (cause) {
      if (!mountedRef.current) return;
      setError(describeError(t, cause));
    } finally {
      if (mountedRef.current) setBeginning(false);
    }
  }

  async function submit() {
    const current = hostRef.current;
    const name = current.connectName.trim();
    const trimmedAppId = appId.trim();
    const trimmedAppSecret = appSecret.trim();
    if (!name || !trimmedAppId || !trimmedAppSecret) return;
    setSaving(true);
    setError(null);
    try {
      const connect = await current.adapter.create({
        provider: current.providerId,
        name,
        agentPreset: current.agentPreset.trim(),
        // The secret leaves this component exactly here and nowhere else — it
        // is never logged, echoed into an error message, or put in the DOM
        // outside its own password input.
        config: {
          appId: trimmedAppId,
          appSecret: trimmedAppSecret,
          domain,
        },
      });
      current.done(connect);
    } catch (cause) {
      if (mountedRef.current) setError(describeError(t, cause));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  const canBeginScan = Boolean(host.connectName.trim());
  const canSubmit =
    Boolean(host.connectName.trim()) &&
    Boolean(appId.trim()) &&
    Boolean(appSecret.trim());

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-border/55 p-1">
        <Button
          className="flex-1"
          onClick={() => handleModeChange("scan")}
          size="sm"
          type="button"
          variant={mode === "scan" ? "default" : "ghost"}
        >
          {t("options.connect.dsh.onboard.modeScan")}
        </Button>
        <Button
          className="flex-1"
          onClick={() => handleModeChange("manual")}
          size="sm"
          type="button"
          variant={mode === "manual" ? "default" : "ghost"}
        >
          {t("options.connect.dsh.onboard.modeManual")}
        </Button>
      </div>

      {mode === "scan" ? (
        onboarding ? (
          <OnboardingScanPane onboarding={onboarding} t={t} />
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("options.connect.dsh.onboard.intro")}
          </p>
        )
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dsh-connect-lark-app-id">
              {t("options.connect.dsh.lark.appId")}
            </Label>
            <Input
              id="dsh-connect-lark-app-id"
              onChange={(event) => setAppId(event.target.value)}
              value={appId}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dsh-connect-lark-app-secret">
              {t("options.connect.dsh.lark.appSecret")}
            </Label>
            <Input
              id="dsh-connect-lark-app-secret"
              onChange={(event) => setAppSecret(event.target.value)}
              type="password"
              value={appSecret}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dsh-connect-lark-domain">
              {t("options.connect.dsh.lark.domain")}
            </Label>
            <Select onValueChange={setDomain} value={domain}>
              <SelectTrigger id="dsh-connect-lark-domain">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="feishu">Feishu</SelectItem>
                <SelectItem value="lark">Lark</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button onClick={() => host.cancel()} type="button" variant="ghost">
          {t("options.connect.dsh.cancel")}
        </Button>
        {mode === "scan" ? (
          !onboarding ? (
            <Button
              disabled={beginning || !canBeginScan}
              onClick={() => void beginScan()}
              type="button"
            >
              {beginning ? <Loader2 className="animate-spin" /> : <QrCode />}
              {t("options.connect.dsh.onboard.begin")}
              {beginning ? (
                <span className="sr-only">
                  {t("options.connect.dsh.loading")}
                </span>
              ) : null}
            </Button>
          ) : null
        ) : (
          <Button
            disabled={saving || !canSubmit}
            onClick={() => void submit()}
            type="button"
          >
            {saving ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("options.connect.dsh.submit")}
            {saving ? (
              <span className="sr-only">{t("options.connect.dsh.loading")}</span>
            ) : null}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Scan-mode content once a session exists. Renders defensively: an
 * `OnboardingView` update is server-pushed and its optional fields
 * (`qrUrl`/`statusNote`) can legitimately be absent — a session that's still
 * pending before the first QR is issued, or a provider that only ever pushes
 * status text — so this never assumes either is present. `error` state is
 * handled by the shared error paragraph in `LarkWizard` (via `describeError`),
 * not here.
 */
function OnboardingScanPane({
  onboarding,
  t,
}: {
  onboarding: OnboardingView;
  t: PluginTranslateFn;
}) {
  if (onboarding.state === "error") return null;

  if (onboarding.qrUrl) {
    const qr = qrcode(0, "M");
    qr.addData(onboarding.qrUrl);
    qr.make();
    const svg = qr.createSvgTag({ cellSize: 4, margin: 2 });
    const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    return (
      <div className="space-y-3 rounded-xl border border-border/55 p-4 text-center">
        <img
          alt={t("options.connect.dsh.onboard.qrAlt")}
          className="mx-auto h-40 w-40"
          src={dataUrl}
        />
        <p className="text-xs text-muted-foreground">
          {t("options.connect.dsh.onboard.scanInstructions")}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {t("options.connect.dsh.onboard.longConnectionHint")}
        </p>
        {onboarding.statusNote ? (
          <p className="text-[11px] text-muted-foreground">
            {describeStatusNote(t, onboarding.statusNote)}
          </p>
        ) : null}
      </div>
    );
  }

  // Graceful degradation: no `qrUrl` yet — render the status note if the
  // provider sent one, otherwise a generic waiting line. Never an empty/broken
  // pane, and never a crash on an absent optional field.
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border/55 px-4 py-6 text-center text-xs text-muted-foreground">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      <span>
        {onboarding.statusNote
          ? describeStatusNote(t, onboarding.statusNote)
          : t("options.connect.dsh.onboard.waiting")}
      </span>
    </div>
  );
}

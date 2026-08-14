import { Check, Loader2, MessageCircleQuestion } from "lucide-react";
import { useEffect, useState } from "react";

import type { HermesClarifyRequest } from "@amiba/core";
import { useT } from "@amiba/i18n";

import { Button, Input, cn } from "../../primitives";

export function ClarifyBanner({
  request,
  inFlight,
  error,
  onRespond,
}: {
  request: HermesClarifyRequest;
  inFlight: boolean;
  error: string | null;
  onRespond: (response: string) => void;
}) {
  const { t } = useT();
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    setSelected([]);
    setCustom("");
  }, [request.clarifyId]);

  function toggle(choice: string) {
    if (!request.multiSelect) {
      onRespond(choice);
      return;
    }
    setSelected((current) =>
      current.includes(choice)
        ? current.filter((value) => value !== choice)
        : [...current, choice],
    );
  }

  function submitSelected() {
    if (selected.length > 0) onRespond(JSON.stringify(selected));
  }

  function submitCustom() {
    if (custom.trim()) onRespond(custom.trim());
  }

  return (
    <div className="mb-2 rounded-xl border border-primary/25 bg-background/95 p-3 shadow-sm backdrop-blur">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 rounded-md bg-primary/10 p-1.5 text-primary">
          <MessageCircleQuestion className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t("sidepanel.clarify.label")}
          </p>
          <p className="mt-1 text-sm leading-relaxed">{request.question}</p>

          {request.choices && request.choices.length > 0 ? (
            <div className="mt-3 grid gap-1.5">
              {request.choices.map((choice) => {
                const active = selected.includes(choice);
                return (
                  <button
                    className={cn(
                      "flex min-h-9 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      active
                        ? "border-primary/50 bg-primary/10 text-foreground"
                        : "border-border/70 bg-muted/10 hover:bg-muted/40",
                    )}
                    disabled={inFlight}
                    key={choice}
                    onClick={() => toggle(choice)}
                    type="button"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center border",
                        request.multiSelect ? "rounded" : "rounded-full",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {active ? <Check className="h-3 w-3" /> : null}
                    </span>
                    {choice}
                  </button>
                );
              })}
              {request.multiSelect ? (
                <Button
                  className="mt-1"
                  disabled={inFlight || selected.length === 0}
                  onClick={submitSelected}
                  size="sm"
                  type="button"
                >
                  {inFlight ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {t("sidepanel.clarify.confirmSelection")}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex gap-2">
            <Input
              aria-label={t("sidepanel.clarify.customAnswer")}
              disabled={inFlight}
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitCustom();
              }}
              placeholder={t("sidepanel.clarify.customAnswer")}
              value={custom}
            />
            <Button
              disabled={inFlight || !custom.trim()}
              onClick={submitCustom}
              size="sm"
              type="button"
            >
              {inFlight ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {t("sidepanel.clarify.send")}
            </Button>
          </div>
          {error ? (
            <p className="mt-2 text-xs text-destructive">{error}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

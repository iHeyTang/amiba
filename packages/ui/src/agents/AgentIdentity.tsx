import { Fingerprint } from "lucide-react";

import type { HermesProfile } from "@amiba/core";

import { cn } from "../primitives";

export function AgentIdentity({
  className,
  iconClassName,
  profile,
  showDescription = false,
}: {
  className?: string;
  iconClassName?: string;
  profile: Pick<HermesProfile, "name" | "description">;
  showDescription?: boolean;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary",
          iconClassName,
        )}
      >
        <Fingerprint className="h-4 w-4" strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {profile.name}
        </span>
        {showDescription && profile.description ? (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {profile.description}
          </span>
        ) : null}
      </span>
    </span>
  );
}

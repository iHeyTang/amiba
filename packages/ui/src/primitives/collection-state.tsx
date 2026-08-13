import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "./cn";

export interface CollectionStateProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  children: ReactNode;
  icon?: ReactNode;
}

/**
 * Stable geometry for loading, empty, and no-result collection states.
 *
 * Keep every state of a collection inside this same shell and only swap its
 * content. That prevents copy, icons, and the surrounding page from jumping
 * when an async request settles.
 */
export function CollectionState({
  children,
  className,
  icon,
  ...props
}: CollectionStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-64 flex-col items-center justify-center text-center",
        className,
      )}
      data-ui="collection-state"
      {...props}
    >
      {icon ? (
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-muted/55 text-muted-foreground/70 [&_svg]:h-3.5 [&_svg]:w-3.5">
          {icon}
        </span>
      ) : null}
      <p className={cn("text-sm text-muted-foreground", icon && "mt-3")}>
        {children}
      </p>
    </div>
  );
}

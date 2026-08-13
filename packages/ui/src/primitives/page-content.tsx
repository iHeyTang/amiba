import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "./cn";

export type PageContentSize = "sm" | "md" | "lg" | "full";
export type PageContentPadding = "page" | "compact" | "none";

const SIZE_CLASS: Record<PageContentSize, string> = {
  sm: "max-w-2xl",
  md: "max-w-3xl",
  lg: "max-w-4xl",
  full: "max-w-none",
};

export interface PageContentProps
  extends Omit<ComponentPropsWithoutRef<"div">, "title"> {
  title?: ReactNode;
  bodyClassName?: string;
  size?: PageContentSize;
  padding?: PageContentPadding;
}

/**
 * Shared page geometry for workspace and settings surfaces.
 *
 * Width and page insets live here so product pages select a named size
 * instead of scattering one-off `max-w-*` containers through the app.
 */
export function PageContent({
  title,
  bodyClassName,
  size = "lg",
  padding = "page",
  className,
  children,
  ...props
}: PageContentProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full",
        SIZE_CLASS[size],
        padding === "page" && "px-7 pb-12 pt-7",
        padding === "compact" && "p-6",
        className,
      )}
      {...props}
    >
      {title ? (
        <h1 className="mb-7 text-xl font-normal leading-7 tracking-[-0.01em]">
          {title}
        </h1>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "./cn";
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

export type DialogOverlayVariant = "dimmed" | "transparent";
export type DialogContentSize =
  | "sm"
  | "compact"
  | "md"
  | "wide"
  | "lg"
  | "xl"
  | "full";
export type DialogContentAppearance = "surface" | "bare";

const DIALOG_SIZE_CLASS: Record<DialogContentSize, string> = {
  sm: "max-w-sm",
  compact: "max-w-md",
  md: "max-w-lg",
  wide: "max-w-xl",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-5xl",
};

/** One motion contract for every modal-sized surface in the product. */
export const DIALOG_MOTION_MS = 200;

export const DIALOG_OVERLAY_MOTION_CLASS =
  "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fill-mode-forwards data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none";

const DIALOG_CENTERED_POSITION_CLASS =
  "fixed left-[50%] top-[50%] z-[var(--z-modal)] w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] text-popover-foreground outline-none";

export const DIALOG_CONTENT_MOTION_CLASS =
  "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fill-mode-forwards data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 motion-reduce:animate-none";

interface DialogOverlayProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> {
  variant?: DialogOverlayVariant;
}

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  DialogOverlayProps
>(({ className, variant = "dimmed", ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-dialog-overlay={variant}
    data-ui-overlay="dialog-overlay"
    className={cn(
      "fixed inset-0 z-[var(--z-modal)]",
      DIALOG_OVERLAY_MOTION_CLASS,
      variant === "transparent" ? "bg-transparent" : "bg-black/80",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /**
   * Skip the default top-right ✕ button. Use when the consuming surface
   * wants to render its own close affordance (e.g. an image lightbox that
   * places a floating circular close badge outside the content padding).
   */
  hideDefaultClose?: boolean;
  /** Keep modal semantics while allowing transparent-window hosts to omit dimming. */
  overlayVariant?: DialogOverlayVariant;
  /** Semantic width preset; the shared frame remains invariant. */
  size?: DialogContentSize;
  /** `bare` is reserved for media lightboxes whose content is the surface. */
  appearance?: DialogContentAppearance;
}

const CENTERED_DIALOG_ANIMATION_STYLE = {
  "--tw-enter-translate-x": "-50%",
  "--tw-enter-translate-y": "-50%",
  "--tw-exit-translate-x": "-50%",
  "--tw-exit-translate-y": "-50%",
  transformOrigin: "center",
} as React.CSSProperties;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    {
      className,
      children,
      appearance = "surface",
      hideDefaultClose = false,
      overlayVariant = "dimmed",
      size = "md",
      style,
      ...props
    },
    ref,
  ) => (
    <DialogPortal>
      <DialogOverlay variant={overlayVariant} />
      <DialogPrimitive.Content
        ref={ref}
        data-ui-overlay="dialog"
        data-glass-surface={appearance}
        className={cn(
          DIALOG_CENTERED_POSITION_CLASS,
          DIALOG_CONTENT_MOTION_CLASS,
          appearance === "surface"
            ? "grid gap-4 rounded-2xl border border-border/60 bg-popover p-6 shadow-overlay"
            : "border-0 bg-transparent p-0 shadow-none",
          DIALOG_SIZE_CLASS[size],
          className,
        )}
        style={{ ...style, ...CENTERED_DIALOG_ANIMATION_STYLE }}
        {...props}
      >
        {children}
        {hideDefaultClose ? null : (
          <DialogPrimitive.Close className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:pointer-events-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  ),
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};

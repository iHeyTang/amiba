import { Check, ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "./cn";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  type PopoverContentSize,
} from "./popover";

export const CASCADE_MENU_MAX_DEPTH = 5;

const exclusiveMenuGroups = new Map<string, Map<string, () => void>>();

export interface CascadeMenuItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  checked?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
  children?: readonly CascadeMenuItem[];
  onSelect?: () => void;
}

export interface CascadeMenuProps {
  trigger: React.ReactElement;
  items: readonly CascadeMenuItem[];
  ariaLabel: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
  size?: PopoverContentSize;
  maxDepth?: number;
  className?: string;
  exclusiveGroup?: string;
}

export function CascadeMenu({
  trigger,
  items,
  ariaLabel,
  open: controlledOpen,
  onOpenChange,
  align = "end",
  size = "compact",
  maxDepth = CASCADE_MENU_MAX_DEPTH,
  className,
  exclusiveGroup,
}: CascadeMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const [openPath, setOpenPath] = React.useState<string[]>([]);
  const suppressCloseAutoFocus = React.useRef(false);
  const instanceId = React.useId();
  const open = controlledOpen ?? uncontrolledOpen;
  const depthLimit = Math.max(
    1,
    Math.min(CASCADE_MENU_MAX_DEPTH, Math.floor(maxDepth)),
  );

  const commitRootOpen = React.useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
      if (!next) setOpenPath([]);
    },
    [controlledOpen, onOpenChange],
  );

  React.useEffect(() => {
    if (!exclusiveGroup || !open) return;
    const group =
      exclusiveMenuGroups.get(exclusiveGroup) ?? new Map<string, () => void>();
    group.set(instanceId, () => {
      suppressCloseAutoFocus.current = true;
      commitRootOpen(false);
    });
    exclusiveMenuGroups.set(exclusiveGroup, group);
    return () => {
      group.delete(instanceId);
      if (group.size === 0) exclusiveMenuGroups.delete(exclusiveGroup);
    };
  }, [commitRootOpen, exclusiveGroup, instanceId, open]);

  const setRootOpen = (next: boolean) => {
    if (next && exclusiveGroup) {
      exclusiveMenuGroups.get(exclusiveGroup)?.forEach((close, id) => {
        if (id !== instanceId) close();
      });
    }
    commitRootOpen(next);
  };

  React.useEffect(() => {
    if (!open) setOpenPath([]);
  }, [open]);

  const closeAll = () => setRootOpen(false);
  const openChild = (depth: number, id: string) => {
    setOpenPath((previous) => [...previous.slice(0, depth - 1), id]);
  };
  const closeChildren = (depth: number) => {
    setOpenPath((previous) => previous.slice(0, depth - 1));
  };
  const groupedTrigger = exclusiveGroup
    ? React.cloneElement(
        trigger as React.ReactElement<Record<string, unknown>>,
        { "data-cascade-menu-group": exclusiveGroup },
      )
    : trigger;

  return (
    <Popover open={open} onOpenChange={setRootOpen}>
      <PopoverTrigger asChild>{groupedTrigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        role="menu"
        aria-label={ariaLabel}
        data-cascade-menu-group={exclusiveGroup}
        size={size}
        padding="sm"
        className={cn("space-y-0.5", className)}
        onPointerDownOutside={(event) => {
          const target = event.detail.originalEvent.target;
          const targetGroup =
            target instanceof Element
              ? target.closest<HTMLElement>("[data-cascade-menu-group]")
                  ?.dataset.cascadeMenuGroup
              : undefined;
          if (targetGroup === exclusiveGroup)
            suppressCloseAutoFocus.current = true;
        }}
        onCloseAutoFocus={(event) => {
          const activeGroup =
            document.activeElement instanceof Element
              ? document.activeElement.closest<HTMLElement>(
                  "[data-cascade-menu-group]",
                )?.dataset.cascadeMenuGroup
              : undefined;
          if (
            suppressCloseAutoFocus.current ||
            (exclusiveGroup !== undefined && activeGroup === exclusiveGroup)
          )
            event.preventDefault();
          suppressCloseAutoFocus.current = false;
        }}
      >
        <CascadeMenuLevel
          items={items}
          depth={1}
          maxDepth={depthLimit}
          size={size}
          openPath={openPath}
          openChild={openChild}
          closeChildren={closeChildren}
          closeAll={closeAll}
        />
      </PopoverContent>
    </Popover>
  );
}

interface CascadeMenuLevelProps {
  items: readonly CascadeMenuItem[];
  depth: number;
  maxDepth: number;
  size: PopoverContentSize;
  openPath: readonly string[];
  openChild: (depth: number, id: string) => void;
  closeChildren: (depth: number) => void;
  closeAll: () => void;
}

function CascadeMenuLevel({
  items,
  depth,
  maxDepth,
  size,
  openPath,
  openChild,
  closeChildren,
  closeAll,
}: CascadeMenuLevelProps) {
  return items.map((item) => {
    const hasChildren =
      depth < maxDepth && Boolean(item.children?.length) && !item.disabled;

    if (!hasChildren) {
      return (
        <React.Fragment key={item.id}>
          {item.separatorBefore ? (
            <div role="separator" className="my-1 h-px bg-border/50" />
          ) : null}
          <CascadeMenuRow
            item={item}
            onPointerMove={() => closeChildren(depth)}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect?.();
              closeAll();
            }}
          />
        </React.Fragment>
      );
    }

    const childOpen = openPath[depth - 1] === item.id;
    return (
      <React.Fragment key={item.id}>
        {item.separatorBefore ? (
          <div role="separator" className="my-1 h-px bg-border/50" />
        ) : null}
        <Popover
          open={childOpen}
          onOpenChange={(next) => {
            if (next) openChild(depth, item.id);
          }}
        >
          <PopoverAnchor asChild>
            <CascadeMenuRow
              item={item}
              hasChildren
              aria-expanded={childOpen}
              onPointerMove={() => openChild(depth, item.id)}
              onClick={() => openChild(depth, item.id)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight") return;
                event.preventDefault();
                openChild(depth, item.id);
              }}
            />
          </PopoverAnchor>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={4}
            role="menu"
            aria-label={typeof item.label === "string" ? item.label : undefined}
            size={size}
            padding="sm"
            className="space-y-0.5"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              closeChildren(depth);
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft") return;
              event.preventDefault();
              closeChildren(depth);
            }}
          >
            <CascadeMenuLevel
              items={item.children ?? []}
              depth={depth + 1}
              maxDepth={maxDepth}
              size={size}
              openPath={openPath}
              openChild={openChild}
              closeChildren={closeChildren}
              closeAll={closeAll}
            />
          </PopoverContent>
        </Popover>
      </React.Fragment>
    );
  });
}

interface CascadeMenuRowProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  item: CascadeMenuItem;
  hasChildren?: boolean;
}

const CascadeMenuRow = React.forwardRef<HTMLButtonElement, CascadeMenuRowProps>(
  function CascadeMenuRow(
    { item, hasChildren = false, className, ...buttonProps },
    ref,
  ) {
    const checked = item.checked !== undefined;

    return (
      <button
        ref={ref}
        type="button"
        role={checked ? "menuitemradio" : "menuitem"}
        aria-checked={checked ? item.checked : undefined}
        aria-haspopup={hasChildren ? "menu" : undefined}
        disabled={item.disabled}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-foreground/80 transition-colors",
          "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40",
          item.destructive && "text-destructive hover:bg-destructive/10",
          className,
        )}
        {...buttonProps}
      >
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">
          {item.icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">
          {hasChildren ? <ChevronRight /> : item.checked ? <Check /> : null}
        </span>
      </button>
    );
  },
);

CascadeMenuRow.displayName = "CascadeMenuRow";

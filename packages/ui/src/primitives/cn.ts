import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Tailwind-aware className builder. Lives in the UI package because it's
 * inseparable from Tailwind's class-merge semantics — nothing in
 * ``@amiba/app-runtime/utils`` should know about Tailwind.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

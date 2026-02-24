// lib/utils.ts — Utility function for conditional CSS class merging.
// Used by shadcn-vue components throughout the frontend.

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges class names with Tailwind CSS conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

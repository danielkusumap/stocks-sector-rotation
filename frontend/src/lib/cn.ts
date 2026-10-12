import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Gabung class Tailwind; class yang belakangan menang (dipakai semua komponen UI). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

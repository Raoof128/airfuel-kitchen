import { createContext, useContext } from "react";
import type { KitchenData, Recipe } from "../lib/schema";
export interface AppContextValue {
  data: KitchenData;
  recipes: Recipe[];
  run: (
    operation: () => Promise<unknown>,
    message?: string,
  ) => Promise<boolean>;
  navigate: (path: string) => void;
}
export const AppContext = createContext<AppContextValue | null>(null);
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("App context missing");
  return value;
}
export function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 }).format(
    value,
  );
}
const spoonFractions: [number, string][] = [
  [0.125, "⅛"],
  [0.25, "¼"],
  [1 / 3, "⅓"],
  [0.5, "½"],
  [2 / 3, "⅔"],
  [0.75, "¾"],
];
// Spoon and cup measures read as kitchen fractions ("⅓ tsp"), not decimals ("0.3 tsp").
// Other units, and values with no close common fraction, keep decimal formatting.
export function formatAmount(value: number, unit: string) {
  if (!["tsp", "tbsp", "cup", "cups"].includes(unit) || value <= 0)
    return formatQuantity(value);
  const whole = Math.floor(value + 0.02);
  const rest = value - whole;
  if (rest < 0.02) return String(whole);
  const match = spoonFractions.find(([f]) => Math.abs(rest - f) < 0.03);
  if (!match) return formatQuantity(value);
  return whole ? `${whole}${match[1]}` : match[1];
}
// Joins optional ingredient details without a dangling separator.
export function ingredientDetails(...parts: (string | undefined)[]) {
  return parts.filter((part) => part && part.trim()).join(" · ");
}
export function readableDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

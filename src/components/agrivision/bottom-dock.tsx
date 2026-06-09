"use client";

import type { ComponentType } from "react";
import { BarChart3, Camera, LineChart, Sparkles, CalendarDays, History as HistoryIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type DockView = "detect" | "plan" | "market" | "history" | "advisor" | "accuracy";

const items: Array<{ id: DockView; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "detect", label: "Detect", icon: Camera },
  { id: "plan", label: "Plan", icon: CalendarDays },
  { id: "market", label: "Market", icon: LineChart },
  { id: "advisor", label: "Advisor", icon: Sparkles },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "accuracy", label: "Accuracy", icon: BarChart3 },
];

export function BottomDock({
  value,
  onValueChange,
}: {
  value: DockView;
  onValueChange: (view: DockView) => void;
}) {
  return (
    <nav className="fixed bottom-4 left-1/2 z-50 w-[min(560px,calc(100%-2rem))] -translate-x-1/2 print:hidden">
      <div className="grid grid-cols-6 rounded-2xl bg-card/60 p-2 shadow-sm ring-1 ring-border/60 backdrop-blur">
        {items.map(item => {
          const active = item.id === value;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onValueChange(item.id)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] transition duration-150 active:scale-[0.98]",
                active ? "bg-foreground/[0.04] text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
              <span className="leading-none">{item.label}</span>
              {active ? <span className="absolute -top-1 h-1 w-6 rounded-full bg-primary/70" /> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

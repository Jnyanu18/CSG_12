"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export type QuickAction = {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  icon?: ComponentType<{ className?: string }>;
  disabled?: boolean;
  onSelect: () => void;
};

function scoreAction(action: QuickAction, q: string) {
  if (!q) return 1;
  const haystack = `${action.label} ${action.description || ""} ${(action.keywords || []).join(" ")}`.toLowerCase();
  const query = q.toLowerCase().trim();
  if (!query) return 1;
  if (haystack.includes(query)) return 3;
  // Simple token overlap to keep it lightweight.
  const tokens = query.split(/\s+/g).filter(Boolean);
  const hits = tokens.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0);
  return hits;
}

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("agrivision:quickactions", onOpen);
    return () => window.removeEventListener("agrivision:quickactions", onOpen);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim();
    const scored = actions
      .map(a => ({ a, s: scoreAction(a, q) }))
      .filter(x => (q ? x.s > 0 : true))
      .sort((x, y) => y.s - x.s);
    return scored.map(x => x.a);
  }, [actions, query]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isCmdK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setOpen(o => !o);
        return;
      }
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex(i => i + 1);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex(i => i - 1);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const action = filtered[wrapIndex(activeIndex, filtered.length)];
        if (action && !action.disabled) {
          setOpen(false);
          action.onSelect();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, filtered, open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Give Radix a tick to mount.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const clampedIndex = wrapIndex(activeIndex, filtered.length);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl border-0 bg-card/70 p-0 shadow-xl ring-1 ring-border/60 backdrop-blur">
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search actions… (Ctrl K)"
            className="h-9 border-0 bg-transparent px-0 py-0 shadow-none ring-0 focus-visible:ring-0"
          />
        </div>

        <ScrollArea className="max-h-[360px]">
          <div className="p-2">
            {filtered.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                No actions found.
              </div>
            ) : (
              filtered.map((action, idx) => {
                const active = idx === clampedIndex;
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => {
                      if (action.disabled) return;
                      setOpen(false);
                      action.onSelect();
                    }}
                    disabled={action.disabled}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                      active ? "bg-foreground/[0.04]" : "hover:bg-foreground/[0.03]",
                      action.disabled ? "opacity-50" : ""
                    )}
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted ring-1 ring-border/60">
                      {Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : <span className="h-2 w-2 rounded-full bg-primary/70" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{action.label}</div>
                      {action.description ? (
                        <div className="truncate text-xs text-muted-foreground">{action.description}</div>
                      ) : null}
                    </div>
                    <div className="hidden text-[10px] text-muted-foreground sm:block">ENTER</div>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
          <div>Tip: Use ↑ ↓ to navigate</div>
          <div className="tabular-nums">Esc to close</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function wrapIndex(i: number, len: number) {
  if (len <= 0) return 0;
  const mod = i % len;
  return mod < 0 ? mod + len : mod;
}

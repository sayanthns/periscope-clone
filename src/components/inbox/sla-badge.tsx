"use client";

/**
 * SLA status pill for a conversation.
 *
 * Priority of what to show:
 *   1. first-response breached → red "FR overdue"
 *   2. resolution breached     → red "Res overdue"
 *   3. first-response pending  → countdown to FR due (amber < 25% left)
 *   4. resolution pending      → countdown to resolution due
 *   5. resolved/met clean      → nothing (or a subtle ✓ in detailed mode)
 *
 * `now` is passed in so a parent ticking clock re-renders all badges
 * together without each badge owning a timer.
 */

import type { Conversation } from "@/types";
import { cn } from "@/lib/utils";

function fmtDelta(ms: number): string {
  const past = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  let v: string;
  if (d > 0) v = `${d}d ${h % 24}h`;
  else if (h > 0) v = `${h}h ${m % 60}m`;
  else v = `${m}m`;
  return past ? `${v} over` : v;
}

export function slaState(c: Conversation, nowMs: number) {
  if (c.first_response_breached && !c.first_response_met_at) {
    return { tone: "breach" as const, label: "FR overdue" };
  }
  if (c.resolution_breached && !c.resolved_at) {
    return { tone: "breach" as const, label: "Res overdue" };
  }
  if (c.first_response_due_at && !c.first_response_met_at) {
    const left = new Date(c.first_response_due_at).getTime() - nowMs;
    if (left < 0) return { tone: "breach" as const, label: "FR overdue" };
    const total = 1; // unknown window; use absolute thresholds
    void total;
    const tone = left < 5 * 60_000 ? "warn" : "ok";
    return { tone: tone as "ok" | "warn", label: `FR ${fmtDelta(left)}` };
  }
  if (c.resolution_due_at && !c.resolved_at) {
    const left = new Date(c.resolution_due_at).getTime() - nowMs;
    if (left < 0) return { tone: "breach" as const, label: "Res overdue" };
    const tone = left < 30 * 60_000 ? "warn" : "ok";
    return { tone: tone as "ok" | "warn", label: `Res ${fmtDelta(left)}` };
  }
  return null;
}

export function SlaBadge({
  conversation,
  nowMs,
  className,
}: {
  conversation: Conversation;
  nowMs: number;
  className?: string;
}) {
  const state = slaState(conversation, nowMs);
  if (!state) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide",
        state.tone === "breach" && "bg-red-500/20 text-red-400",
        state.tone === "warn" && "bg-amber-500/20 text-amber-400",
        state.tone === "ok" && "bg-emerald-500/15 text-emerald-400",
        className,
      )}
      title="SLA"
    >
      ⏱ {state.label}
    </span>
  );
}

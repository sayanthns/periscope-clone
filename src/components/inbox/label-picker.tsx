"use client";

/**
 * Chat label picker — Periskope-style labels on conversations.
 *
 * Renders a Tag icon button (thread header). The dropdown lists the
 * account's labels with a check toggle for the current conversation and
 * an inline "create label" input at the bottom. All reads/writes go
 * through the supabase client directly — RLS scopes rows to account
 * members.
 */

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { ChatLabel } from "@/types";
import { Tag, Check, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const LABEL_COLORS = [
  "#8b5cf6", // violet
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#ec4899", // pink
];

interface LabelPickerProps {
  conversationId: string;
  /** Notify parent so the list chip display can update without refetch. */
  onChanged?: () => void;
}

export function LabelPicker({ conversationId, onChanged }: LabelPickerProps) {
  const { accountId } = useAuth();
  const [labels, setLabels] = useState<ChatLabel[]>([]);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const [labelsRes, appliedRes] = await Promise.all([
      supabase.from("labels").select("*").eq("account_id", accountId).order("name"),
      supabase.from("conversation_labels").select("label_id").eq("conversation_id", conversationId),
    ]);
    if (labelsRes.data) setLabels(labelsRes.data as ChatLabel[]);
    if (appliedRes.data) {
      setApplied(new Set(appliedRes.data.map((r: { label_id: string }) => r.label_id)));
    }
  }, [accountId, conversationId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback(
    async (labelId: string) => {
      const supabase = createClient();
      const isOn = applied.has(labelId);
      // Optimistic flip
      setApplied((prev) => {
        const next = new Set(prev);
        if (isOn) next.delete(labelId);
        else next.add(labelId);
        return next;
      });
      if (isOn) {
        await supabase
          .from("conversation_labels")
          .delete()
          .eq("conversation_id", conversationId)
          .eq("label_id", labelId);
      } else {
        await supabase
          .from("conversation_labels")
          .insert({ conversation_id: conversationId, label_id: labelId });
      }
      onChanged?.();
    },
    [applied, conversationId, onChanged],
  );

  const createLabel = useCallback(async () => {
    const name = newName.trim();
    if (!name || !accountId || creating) return;
    setCreating(true);
    try {
      const supabase = createClient();
      const color = LABEL_COLORS[labels.length % LABEL_COLORS.length];
      const { data, error } = await supabase
        .from("labels")
        .insert({ account_id: accountId, name, color })
        .select()
        .single();
      if (!error && data) {
        setLabels((prev) => [...prev, data as ChatLabel].sort((a, b) => a.name.localeCompare(b.name)));
        setNewName("");
        // Apply to current conversation immediately — creating from a
        // thread means "label this chat"
        await supabase
          .from("conversation_labels")
          .insert({ conversation_id: conversationId, label_id: (data as ChatLabel).id });
        setApplied((prev) => new Set(prev).add((data as ChatLabel).id));
        onChanged?.();
      }
    } finally {
      setCreating(false);
    }
  }, [newName, accountId, creating, labels.length, conversationId, onChanged]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="Labels"
        className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
      >
        <Tag className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 border-slate-700 bg-slate-800 p-1">
        {labels.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-slate-500">No labels yet — create one below</p>
        )}
        {labels.map((label) => (
          <button
            key={label.id}
            onClick={(e) => {
              e.preventDefault();
              toggle(label.id);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-200 hover:bg-slate-700/60"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: label.color }}
            />
            <span className="flex-1 truncate text-left">{label.name}</span>
            {applied.has(label.id) && <Check className="h-3.5 w-3.5 text-primary" />}
          </button>
        ))}
        <div className="mt-1 flex items-center gap-1 border-t border-slate-700 px-1 pt-1.5 pb-0.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                createLabel();
              }
              e.stopPropagation();
            }}
            placeholder="New label…"
            className="h-7 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-white placeholder-slate-500 outline-none focus:border-primary/50"
          />
          <button
            onClick={(e) => {
              e.preventDefault();
              createLabel();
            }}
            disabled={!newName.trim() || creating}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md",
              newName.trim()
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "text-slate-600",
            )}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

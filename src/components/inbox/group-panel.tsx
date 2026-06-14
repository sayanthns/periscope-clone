"use client";

/**
 * Group management panel — Periskope parity for the right sidebar.
 *
 * - Participants: live list from WhatsApp (via baileys metadata), add by
 *   phone, remove, export CSV
 * - Auto-replies: keyword → reply rules stored in group_auto_replies,
 *   matched server-side on every inbound group message
 */

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Users,
  Download,
  Plus,
  Trash2,
  Crown,
  RefreshCw,
  MessageSquareReply,
} from "lucide-react";
import { toast } from "sonner";

interface Participant {
  jid: string;
  admin: string | null;
  /** false when the member is a privacy LID we couldn't map to a phone */
  resolved?: boolean;
  /** display name (pushName) — present even when the number is hidden */
  name?: string | null;
}

interface AutoReply {
  id: string;
  keyword: string;
  reply_text: string;
  enabled: boolean;
}

interface GroupPanelProps {
  groupJid: string;
}

export function GroupPanel({ groupJid }: GroupPanelProps) {
  const { accountId, isOwner, isAdmin } = useAuth();
  const canManage = isOwner || isAdmin;

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loadingParts, setLoadingParts] = useState(false);
  const [addPhone, setAddPhone] = useState("");
  const [working, setWorking] = useState(false);

  const [rules, setRules] = useState<AutoReply[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [newReply, setNewReply] = useState("");

  const loadParticipants = useCallback(async () => {
    setLoadingParts(true);
    try {
      const res = await fetch(
        `/api/whatsapp/groups/participants?jid=${encodeURIComponent(groupJid)}`,
      );
      const payload = await res.json().catch(() => ({}));
      if (res.ok) setParticipants(payload.participants ?? []);
      else toast.error(payload?.error || "Failed to load participants");
    } finally {
      setLoadingParts(false);
    }
  }, [groupJid]);

  const loadRules = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("group_auto_replies")
      .select("id, keyword, reply_text, enabled")
      .eq("account_id", accountId)
      .eq("group_jid", groupJid)
      .order("keyword");
    setRules((data as AutoReply[]) ?? []);
  }, [accountId, groupJid]);

  useEffect(() => {
    loadParticipants();
    loadRules();
  }, [loadParticipants, loadRules]);

  const mutateParticipants = useCallback(
    async (action: "add" | "remove", phones: string[]) => {
      setWorking(true);
      try {
        const res = await fetch("/api/whatsapp/groups/participants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jid: groupJid, action, phones }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(payload?.error || `${action} failed`);
          return;
        }
        toast.success(action === "add" ? "Participant added" : "Participant removed");
        setAddPhone("");
        loadParticipants();
      } finally {
        setWorking(false);
      }
    },
    [groupJid, loadParticipants],
  );

  const exportCsv = useCallback(() => {
    if (!participants.length) {
      toast.info("Nothing to export");
      return;
    }
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const csv = [
      "name,phone,role",
      ...participants.map((p) => {
        const phone = p.resolved !== false && p.jid.endsWith("@s.whatsapp.net")
          ? `+${p.jid.split("@")[0]}`
          : "hidden";
        return `${esc(p.name ?? "")},${phone},${p.admin ? p.admin : "member"}`;
      }),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "group-members.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [participants]);

  const addRule = useCallback(async () => {
    if (!accountId || !newKeyword.trim() || !newReply.trim()) return;
    const supabase = createClient();
    const { error } = await supabase.from("group_auto_replies").insert({
      account_id: accountId,
      group_jid: groupJid,
      keyword: newKeyword.trim(),
      reply_text: newReply.trim(),
    });
    if (error) {
      toast.error(error.message.includes("duplicate") ? "Keyword already exists" : error.message);
      return;
    }
    setNewKeyword("");
    setNewReply("");
    loadRules();
    toast.success("Auto-reply added");
  }, [accountId, groupJid, newKeyword, newReply, loadRules]);

  const deleteRule = useCallback(async (id: string) => {
    const supabase = createClient();
    await supabase.from("group_auto_replies").delete().eq("id", id);
    loadRules();
  }, [loadRules]);

  const toggleRule = useCallback(async (rule: AutoReply) => {
    const supabase = createClient();
    await supabase
      .from("group_auto_replies")
      .update({ enabled: !rule.enabled })
      .eq("id", rule.id);
    loadRules();
  }, [loadRules]);

  return (
    <>
      {/* Participants */}
      <div>
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500">
            <Users className="h-3 w-3" />
            Members ({participants.length})
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={loadParticipants}
              title="Refresh"
              className="text-slate-500 hover:text-white"
            >
              <RefreshCw className={loadingParts ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
            </button>
            <button
              onClick={exportCsv}
              title="Export CSV"
              className="text-slate-500 hover:text-white"
            >
              <Download className="h-3 w-3" />
            </button>
          </div>
        </div>

        {canManage && (
          <div className="mt-2 flex gap-1">
            <input
              value={addPhone}
              onChange={(e) => setAddPhone(e.target.value)}
              placeholder="9198765… add member"
              className="h-7 flex-1 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs text-white placeholder-slate-500 outline-none focus:border-primary/50"
            />
            <Button
              size="sm"
              className="h-7 w-7 bg-primary p-0 hover:bg-primary/90"
              disabled={addPhone.replace(/\D/g, "").length < 10 || working}
              onClick={() => mutateParticipants("add", [addPhone])}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        )}

        <div className="mt-2 max-h-44 space-y-0.5 overflow-y-auto">
          {participants.map((p) => (
            <div
              key={p.jid}
              className="group flex items-center gap-2 rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              {p.admin ? (
                <Crown className="h-3 w-3 shrink-0 text-amber-400" />
              ) : (
                <span className="h-3 w-3 shrink-0" />
              )}
              {p.resolved !== false && p.jid.endsWith("@s.whatsapp.net") ? (
                <span className="flex-1 truncate">
                  {p.name ? `${p.name} · +${p.jid.split("@")[0]}` : `+${p.jid.split("@")[0]}`}
                </span>
              ) : p.name ? (
                // Number privacy-hidden but we know who they are
                <span className="flex-1 truncate">
                  {p.name} <span className="text-slate-500">· hidden #</span>
                </span>
              ) : (
                <span className="flex-1 truncate italic text-slate-500">
                  Member
                </span>
              )}
              {canManage && !p.admin && (
                <button
                  onClick={() => mutateParticipants("remove", [p.jid])}
                  title="Remove from group"
                  className="hidden text-slate-600 hover:text-red-400 group-hover:block"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {!participants.length && !loadingParts && (
            <p className="px-2 text-xs text-slate-600">Couldn&apos;t load members</p>
          )}
        </div>
      </div>

      <div className="my-4 border-t border-slate-800" />

      {/* Auto-replies */}
      <div>
        <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-slate-500">
          <MessageSquareReply className="h-3 w-3" />
          Auto-replies
        </div>

        <div className="mt-2 space-y-1">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="group rounded-md bg-slate-800 px-2 py-1.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleRule(rule)}
                  className={
                    rule.enabled
                      ? "font-mono font-medium text-primary"
                      : "font-mono font-medium text-slate-600 line-through"
                  }
                  title={rule.enabled ? "Click to disable" : "Click to enable"}
                >
                  {rule.keyword}
                </button>
                <span className="flex-1" />
                <button
                  onClick={() => deleteRule(rule.id)}
                  className="hidden text-slate-600 hover:text-red-400 group-hover:block"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <p className="mt-0.5 truncate text-slate-400">{rule.reply_text}</p>
            </div>
          ))}
        </div>

        <div className="mt-2 space-y-1">
          <input
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder="Trigger keyword e.g. price"
            className="h-7 w-full rounded-md border border-slate-700 bg-slate-800 px-2 text-xs text-white placeholder-slate-500 outline-none focus:border-primary/50"
          />
          <div className="flex gap-1">
            <input
              value={newReply}
              onChange={(e) => setNewReply(e.target.value)}
              placeholder="Reply text"
              className="h-7 flex-1 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs text-white placeholder-slate-500 outline-none focus:border-primary/50"
            />
            <Button
              size="sm"
              className="h-7 w-7 bg-primary p-0 hover:bg-primary/90"
              disabled={!newKeyword.trim() || !newReply.trim()}
              onClick={addRule}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

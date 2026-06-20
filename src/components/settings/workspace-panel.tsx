"use client";

/**
 * Workspace settings — Periskope-parity account-level toggles + exports.
 *
 * - Auto-assignment: round-robin new conversations across members
 * - Number masking: hide customer phone numbers from non-admin agents
 * - Data export: contacts / conversations as CSV (client-side blob)
 */

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Download, Shuffle, EyeOff, Key, Webhook, Plus, Trash2, Copy, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { format } from "date-fns";

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  last_status: number | null;
  last_fired_at: string | null;
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) {
    toast.info("Nothing to export");
    return;
  }
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function WorkspacePanel() {
  const { accountId, user } = useAuth();
  const [autoAssign, setAutoAssign] = useState(false);
  const [maskNumbers, setMaskNumbers] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  // API keys
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);

  // Webhooks
  const [hooks, setHooks] = useState<WebhookRow[]>([]);
  const [newHookUrl, setNewHookUrl] = useState("");

  // SLA policy
  const [sla, setSla] = useState({
    first_response_mins: 30,
    resolution_mins: 1440,
    business_hours_only: false,
    work_start: "09:00",
    work_end: "18:00",
    enabled: true,
  });
  const [slaLoaded, setSlaLoaded] = useState(false);
  const [savingSla, setSavingSla] = useState(false);

  const loadSla = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("sla_policies")
      .select("first_response_mins, resolution_mins, business_hours_only, work_start, work_end, enabled")
      .eq("account_id", accountId)
      .maybeSingle();
    if (data) setSla((s) => ({ ...s, ...data }));
    setSlaLoaded(true);
  }, [accountId]);

  const saveSla = useCallback(async () => {
    if (!accountId || savingSla) return;
    setSavingSla(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("sla_policies")
        .upsert({ account_id: accountId, ...sla, updated_at: new Date().toISOString() }, { onConflict: "account_id" });
      if (error) toast.error(`SLA save failed: ${error.message}`);
      else toast.success("SLA policy saved");
    } finally {
      setSavingSla(false);
    }
  }, [accountId, sla, savingSla]);

  const loadApiKeys = useCallback(async () => {
    const res = await fetch("/api/account/api-keys");
    if (!res.ok) return;
    const payload = await res.json();
    setApiKeys(payload.keys ?? []);
  }, []);

  const loadHooks = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("webhooks")
      .select("id, url, events, enabled, last_status, last_fired_at")
      .order("created_at", { ascending: false });
    setHooks((data as WebhookRow[]) ?? []);
  }, [accountId]);

  useEffect(() => {
    loadApiKeys();
    loadHooks();
    loadSla();
  }, [loadApiKeys, loadHooks, loadSla]);

  const createApiKey = useCallback(async () => {
    if (!newKeyName.trim() || creatingKey) return;
    setCreatingKey(true);
    try {
      const res = await fetch("/api/account/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload?.error || "Failed to create key");
        return;
      }
      setFreshKey(payload.raw);
      setNewKeyName("");
      loadApiKeys();
    } finally {
      setCreatingKey(false);
    }
  }, [newKeyName, creatingKey, loadApiKeys]);

  const deleteApiKey = useCallback(async (id: string) => {
    await fetch(`/api/account/api-keys?id=${id}`, { method: "DELETE" });
    loadApiKeys();
  }, [loadApiKeys]);

  const addHook = useCallback(async () => {
    const url = newHookUrl.trim();
    if (!accountId || !user || !/^https:\/\//.test(url)) {
      toast.error("Webhook URL must start with https://");
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.from("webhooks").insert({
      account_id: accountId,
      url,
      created_by: user.id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewHookUrl("");
    loadHooks();
    toast.success("Webhook added — message.received events will be POSTed");
  }, [accountId, user, newHookUrl, loadHooks]);

  const deleteHook = useCallback(async (id: string) => {
    const supabase = createClient();
    await supabase.from("webhooks").delete().eq("id", id);
    loadHooks();
  }, [loadHooks]);

  const toggleHook = useCallback(async (hook: WebhookRow) => {
    const supabase = createClient();
    await supabase.from("webhooks").update({ enabled: !hook.enabled }).eq("id", hook.id);
    loadHooks();
  }, [loadHooks]);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    supabase
      .from("accounts")
      .select("auto_assign_enabled, mask_numbers")
      .eq("id", accountId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setAutoAssign(!!data.auto_assign_enabled);
          setMaskNumbers(!!data.mask_numbers);
        }
        setLoaded(true);
      });
  }, [accountId]);

  const updateFlag = useCallback(
    async (field: "auto_assign_enabled" | "mask_numbers", value: boolean) => {
      if (!accountId) return;
      const supabase = createClient();
      const { error } = await supabase
        .from("accounts")
        .update({ [field]: value })
        .eq("id", accountId);
      if (error) {
        toast.error(`Failed to save: ${error.message}`);
        return false;
      }
      return true;
    },
    [accountId],
  );

  const exportContacts = useCallback(async () => {
    setExporting("contacts");
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("contacts")
        .select("name, phone, email, company, is_group, opted_in, created_at")
        .order("created_at", { ascending: false });
      downloadCsv("contacts.csv", data ?? []);
    } finally {
      setExporting(null);
    }
  }, []);

  const exportConversations = useCallback(async () => {
    setExporting("conversations");
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("conversations")
        .select("id, status, is_group, group_name, last_message_text, last_message_at, unread_count, created_at")
        .order("last_message_at", { ascending: false });
      downloadCsv("conversations.csv", data ?? []);
    } finally {
      setExporting(null);
    }
  }, []);

  return (
    <div className="space-y-6">
      <Card className="border-slate-700 bg-slate-900">
        <CardHeader>
          <CardTitle className="text-base text-white">Inbox automation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Shuffle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium text-white">Auto-assign new conversations</p>
                <p className="text-xs text-slate-400">
                  Distribute new chats to team members round-robin as they arrive.
                </p>
              </div>
            </div>
            <Switch
              checked={autoAssign}
              disabled={!loaded}
              onCheckedChange={async (v) => {
                setAutoAssign(v);
                const ok = await updateFlag("auto_assign_enabled", v);
                if (!ok) setAutoAssign(!v);
                else toast.success(v ? "Auto-assignment on" : "Auto-assignment off");
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium text-white">Mask phone numbers</p>
                <p className="text-xs text-slate-400">
                  Hide customer numbers from agents — only admins and owners see full numbers.
                </p>
              </div>
            </div>
            <Switch
              checked={maskNumbers}
              disabled={!loaded}
              onCheckedChange={async (v) => {
                setMaskNumbers(v);
                const ok = await updateFlag("mask_numbers", v);
                if (!ok) setMaskNumbers(!v);
                else toast.success(v ? "Number masking on" : "Number masking off");
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* SLA policy */}
      <Card className="border-slate-700 bg-slate-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Clock className="h-4 w-4 text-primary" /> SLA targets
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-300">SLA tracking enabled</p>
            <Switch
              checked={sla.enabled}
              disabled={!slaLoaded}
              onCheckedChange={(v) => setSla((s) => ({ ...s, enabled: v }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              First response (minutes)
              <Input
                type="number"
                min={1}
                value={sla.first_response_mins}
                onChange={(e) => setSla((s) => ({ ...s, first_response_mins: Number(e.target.value) || 0 }))}
                className="border-slate-700 bg-slate-800 text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Resolution (minutes)
              <Input
                type="number"
                min={1}
                value={sla.resolution_mins}
                onChange={(e) => setSla((s) => ({ ...s, resolution_mins: Number(e.target.value) || 0 }))}
                className="border-slate-700 bg-slate-800 text-white"
              />
            </label>
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-300">Count business hours only</p>
            <Switch
              checked={sla.business_hours_only}
              disabled={!slaLoaded}
              onCheckedChange={(v) => setSla((s) => ({ ...s, business_hours_only: v }))}
            />
          </div>
          {sla.business_hours_only && (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Work start
                <Input
                  type="time"
                  value={sla.work_start}
                  onChange={(e) => setSla((s) => ({ ...s, work_start: e.target.value }))}
                  className="border-slate-700 bg-slate-800 text-white [color-scheme:dark]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Work end
                <Input
                  type="time"
                  value={sla.work_end}
                  onChange={(e) => setSla((s) => ({ ...s, work_end: e.target.value }))}
                  className="border-slate-700 bg-slate-800 text-white [color-scheme:dark]"
                />
              </label>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={saveSla} disabled={savingSla} className="bg-primary hover:bg-primary/90">
              {savingSla ? "Saving…" : "Save SLA"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Key className="h-4 w-4 text-primary" /> API keys
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {freshKey && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-xs font-medium text-amber-400">
                Copy this key now — it won&apos;t be shown again
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-slate-950 px-2 py-1 text-xs text-amber-200">
                  {freshKey}
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 p-0 text-amber-400"
                  onClick={() => {
                    navigator.clipboard.writeText(freshKey);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                Use: <code>POST /api/v1/messages</code> with header{" "}
                <code>Authorization: Bearer &lt;key&gt;</code> and body{" "}
                <code>{"{ phone, text }"}</code> or <code>{"{ group_jid, text }"}</code>
              </p>
            </div>
          )}

          {apiKeys.map((k) => (
            <div
              key={k.id}
              className="flex items-center gap-3 rounded-lg bg-slate-800 px-3 py-2 text-sm"
            >
              <span className="font-medium text-white">{k.name}</span>
              <code className="text-xs text-slate-500">{k.key_prefix}…</code>
              <span className="flex-1" />
              <span className="text-[11px] text-slate-500">
                {k.last_used_at
                  ? `used ${format(new Date(k.last_used_at), "d MMM HH:mm")}`
                  : "never used"}
              </span>
              <button
                onClick={() => deleteApiKey(k.id)}
                className="text-slate-600 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          <div className="flex gap-2">
            <Input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name e.g. Zapier"
              className="border-slate-700 bg-slate-800 text-sm text-white placeholder-slate-500"
            />
            <Button
              disabled={!newKeyName.trim() || creatingKey}
              onClick={createApiKey}
              className="bg-primary hover:bg-primary/90"
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Create
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Webhook className="h-4 w-4 text-primary" /> Webhooks
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-400">
            POST <code>message.received</code> events to your endpoint as they arrive.
          </p>
          {hooks.map((h) => (
            <div
              key={h.id}
              className="flex items-center gap-3 rounded-lg bg-slate-800 px-3 py-2 text-sm"
            >
              <button
                onClick={() => toggleHook(h)}
                className={h.enabled ? "text-primary" : "text-slate-600"}
                title={h.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
              >
                ●
              </button>
              <span className="flex-1 truncate text-slate-200">{h.url}</span>
              {h.last_status !== null && (
                <span
                  className={
                    h.last_status >= 200 && h.last_status < 300
                      ? "text-[11px] text-green-400"
                      : "text-[11px] text-red-400"
                  }
                >
                  {h.last_status === -1 ? "timeout" : h.last_status}
                </span>
              )}
              <button
                onClick={() => deleteHook(h.id)}
                className="text-slate-600 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              value={newHookUrl}
              onChange={(e) => setNewHookUrl(e.target.value)}
              placeholder="https://your-endpoint.example.com/hook"
              className="border-slate-700 bg-slate-800 text-sm text-white placeholder-slate-500"
            />
            <Button
              disabled={!newHookUrl.trim()}
              onClick={addHook}
              className="bg-primary hover:bg-primary/90"
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-900">
        <CardHeader>
          <CardTitle className="text-base text-white">Data export</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={exportContacts}
            disabled={exporting !== null}
            className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            <Download className="mr-2 h-4 w-4" />
            {exporting === "contacts" ? "Exporting…" : "Export contacts (CSV)"}
          </Button>
          <Button
            variant="outline"
            onClick={exportConversations}
            disabled={exporting !== null}
            className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            <Download className="mr-2 h-4 w-4" />
            {exporting === "conversations" ? "Exporting…" : "Export conversations (CSV)"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

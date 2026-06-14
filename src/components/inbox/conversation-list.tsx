"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, ChatLabel } from "@/types";
import { Search, ChevronDown, Users, SquarePen, Tag, Megaphone, Pin, BellOff, Smartphone } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-slate-500",
};

const FILTER_OPTIONS: { label: string; value: ConversationStatus | "all" | "archived" }[] = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Pending", value: "pending" },
  { label: "Closed", value: "closed" },
  { label: "Archived", value: "archived" },
];

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConversationStatus | "all" | "archived">("all");
  const [groupsOnly, setGroupsOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  // Full-text search: conversation ids whose MESSAGES match the query.
  // Debounced 300ms; merged into the name/phone/last-message filter below.
  const [msgMatchIds, setMsgMatchIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    const q = search.trim();
    if (q.length < 3) {
      setMsgMatchIds(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("messages")
        .select("conversation_id")
        .ilike("content_text", `%${q}%`)
        .limit(300);
      if (cancelled) return;
      setMsgMatchIds(
        new Set((data ?? []).map((r: { conversation_id: string }) => r.conversation_id)),
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  // Chat labels: account labels + conversation→labels map for filter + chips
  const [labels, setLabels] = useState<ChatLabel[]>([]);
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [convLabels, setConvLabels] = useState<Map<string, string[]>>(new Map());

  // Multi-number: filter the inbox by which connected number owns the chat.
  const [accountNumbers, setAccountNumbers] = useState<{ phone_number_id: string; label: string | null }[]>([]);
  const [numberFilter, setNumberFilter] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/whatsapp/baileys?list=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.numbers) setAccountNumbers(d.numbers); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const [labelsRes, mapRes] = await Promise.all([
        supabase.from("labels").select("*").order("name"),
        supabase.from("conversation_labels").select("conversation_id, label_id"),
      ]);
      if (cancelled) return;
      if (labelsRes.data) setLabels(labelsRes.data as ChatLabel[]);
      if (mapRes.data) {
        const map = new Map<string, string[]>();
        for (const row of mapRes.data as { conversation_id: string; label_id: string }[]) {
          const list = map.get(row.conversation_id) ?? [];
          list.push(row.label_id);
          map.set(row.conversation_id, list);
        }
        setConvLabels(map);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resyncToken]);

  // New conversation dialog
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [newConvError, setNewConvError] = useState<string | null>(null);
  const [newConvLoading, setNewConvLoading] = useState(false);

  // Group broadcast dialog
  const [gbOpen, setGbOpen] = useState(false);
  const [gbSelected, setGbSelected] = useState<Set<string>>(new Set());
  const [gbText, setGbText] = useState("");
  const [gbSearch, setGbSearch] = useState("");
  const [gbSending, setGbSending] = useState(false);
  const [gbResult, setGbResult] = useState<string | null>(null);

  const groupConvs = useMemo(
    () => conversations.filter((c) => c.is_group === true),
    [conversations],
  );

  const gbFiltered = useMemo(() => {
    if (!gbSearch.trim()) return groupConvs;
    const q = gbSearch.toLowerCase();
    return groupConvs.filter((c) =>
      (c.group_name ?? c.contact?.name ?? "").toLowerCase().includes(q),
    );
  }, [groupConvs, gbSearch]);

  const handleGroupBroadcast = useCallback(async () => {
    if (gbSelected.size === 0 || !gbText.trim() || gbSending) return;
    setGbSending(true);
    setGbResult(null);
    try {
      const res = await fetch("/api/whatsapp/group-broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_ids: Array.from(gbSelected),
          text: gbText.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGbResult(data?.error ?? `Failed (${res.status})`);
        return;
      }
      setGbResult(`Sent to ${data.sent} groups${data.failed ? `, ${data.failed} failed` : ""}`);
      setGbText("");
      setGbSelected(new Set());
    } catch {
      setGbResult("Network error");
    } finally {
      setGbSending(false);
    }
  }, [gbSelected, gbText, gbSending]);

  const handleNewConversation = useCallback(async () => {
    setNewConvError(null);
    const phone = newPhone.replace(/\D/g, "");
    if (phone.length < 10) {
      setNewConvError("Enter a valid phone number with country code, e.g. 919876543210");
      return;
    }
    if (!newMessage.trim()) {
      setNewConvError("Message cannot be empty");
      return;
    }
    setNewConvLoading(true);
    try {
      const res = await fetch("/api/whatsapp/new-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, text: newMessage.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNewConvError(data?.error ?? "Failed to send message");
        setNewConvLoading(false);
        return;
      }
      // success — close dialog, reset fields
      setNewConvOpen(false);
      setNewPhone("");
      setNewMessage("");
    } catch {
      setNewConvError("Network error — check connection");
    } finally {
      setNewConvLoading(false);
    }
  }, [newPhone, newMessage]);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, contact:contacts(*)")
        .order("last_message_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  const filtered = useMemo(() => {
    let result = conversations;

    // Archived: hidden everywhere except the explicit Archived view
    if (filter === "archived") {
      result = result.filter((c) => c.archived === true);
    } else {
      result = result.filter((c) => c.archived !== true);
      if (filter !== "all") {
        result = result.filter((c) => c.status === filter);
      }
    }

    if (groupsOnly) {
      result = result.filter((c) => c.is_group === true);
    }

    if (labelFilter) {
      result = result.filter((c) =>
        (convLabels.get(c.id) ?? []).includes(labelFilter),
      );
    }

    if (numberFilter) {
      result = result.filter((c) => c.phone_number_id === numberFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = (c.group_name ?? c.contact?.name ?? "").toLowerCase();
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return (
          name.includes(q) ||
          phone.includes(q) ||
          lastMsg.includes(q) ||
          // Full-text: any message in the conversation matched
          (msgMatchIds?.has(c.id) ?? false)
        );
      });
    }

    // Pinned chats stick to the top, each section newest-first
    return [...result].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const at = a.last_message_at ? Date.parse(a.last_message_at) : 0;
      const bt = b.last_message_at ? Date.parse(b.last_message_at) : 0;
      return bt - at;
    });
  }, [conversations, filter, search, groupsOnly, labelFilter, numberFilter, convLabels, msgMatchIds]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-slate-800 bg-slate-900 lg:w-80">
      {/* Header row */}
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-sm font-semibold text-white">Conversations</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setGbOpen(true); setGbResult(null); }}
            title="Message multiple groups"
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <Megaphone className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setNewConvOpen(true); setNewConvError(null); }}
            title="New conversation"
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <SquarePen className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Group Broadcast Dialog */}
      <Dialog open={gbOpen} onOpenChange={setGbOpen}>
        <DialogContent className="border-slate-700 bg-slate-900 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">Message multiple groups</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-1">
            {gbResult && (
              <div className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                gbResult.startsWith("Sent")
                  ? "border-green-500/20 bg-green-500/10 text-green-400"
                  : "border-red-500/20 bg-red-500/10 text-red-400",
              )}>
                {gbResult}
              </div>
            )}
            <Input
              value={gbSearch}
              onChange={(e) => setGbSearch(e.target.value)}
              placeholder="Search groups…"
              className="border-slate-700 bg-slate-800 text-sm text-white placeholder-slate-500"
            />
            <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-700">
              {gbFiltered.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-slate-500">No groups</p>
              ) : (
                gbFiltered.map((c) => {
                  const checked = gbSelected.has(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() =>
                        setGbSelected((prev) => {
                          const next = new Set(prev);
                          if (checked) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                        checked ? "bg-primary/15 text-white" : "text-slate-300 hover:bg-slate-800",
                      )}
                    >
                      <span className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        checked ? "border-primary bg-primary" : "border-slate-600",
                      )}>
                        {checked && <span className="text-[10px] text-white">✓</span>}
                      </span>
                      <Users className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                      <span className="truncate">{c.group_name ?? c.contact?.name ?? "Group"}</span>
                    </button>
                  );
                })
              )}
            </div>
            <p className="text-xs text-slate-500">{gbSelected.size} selected (max 50)</p>
            <textarea
              rows={3}
              placeholder="Type your message…"
              value={gbText}
              onChange={(e) => setGbText(e.target.value)}
              className="w-full resize-none rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-primary/50"
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setGbOpen(false)}
              className="text-slate-400 hover:text-white"
            >
              Close
            </Button>
            <Button
              disabled={gbSelected.size === 0 || !gbText.trim() || gbSending}
              onClick={handleGroupBroadcast}
              className="bg-primary hover:bg-primary/90"
            >
              {gbSending ? "Sending…" : `Send to ${gbSelected.size} group${gbSelected.size === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Conversation Dialog */}
      <Dialog open={newConvOpen} onOpenChange={setNewConvOpen}>
        <DialogContent className="border-slate-700 bg-slate-900 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">New Conversation</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            {newConvError && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {newConvError}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label className="text-slate-300 text-sm">Phone number</Label>
              <Input
                placeholder="919876543210 (with country code)"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:border-primary focus-visible:ring-primary/20"
              />
              <p className="text-xs text-slate-500">Include country code, no + or spaces</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-slate-300 text-sm">First message</Label>
              <textarea
                rows={3}
                placeholder="Type your message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="w-full resize-none rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-primary/50"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setNewConvOpen(false)}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleNewConversation}
              disabled={newConvLoading}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {newConvLoading ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Search + Filter */}
      <div className="space-y-2 border-b border-slate-800 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder="Search conversations..."
            className="border-slate-700 bg-slate-800 pl-9 text-sm text-white placeholder-slate-500 focus:border-primary/50"
          />
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-slate-400 hover:text-white rounded-md hover:bg-slate-800">
                {activeFilter?.label ?? "All"}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-slate-700 bg-slate-800"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "text-sm",
                    filter === opt.value
                      ? "text-primary"
                      : "text-slate-300"
                  )}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Groups toggle */}
          <button
            onClick={() => setGroupsOnly((v) => !v)}
            title={groupsOnly ? "Show all conversations" : "Show groups only"}
            className={cn(
              "inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs transition-colors",
              groupsOnly
                ? "bg-primary/20 text-primary"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            )}
          >
            <Users className="h-3 w-3" />
            Groups
          </button>

          {/* Number filter — only when the account has >1 connected number */}
          {accountNumbers.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs transition-colors",
                  numberFilter
                    ? "bg-primary/20 text-primary"
                    : "text-slate-400 hover:text-white hover:bg-slate-800",
                )}
              >
                <Smartphone className="h-3 w-3" />
                {numberFilter
                  ? (accountNumbers.find((n) => n.phone_number_id === numberFilter)?.label
                      ?? `+${numberFilter}`)
                  : "Number"}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="border-slate-700 bg-slate-800">
                <DropdownMenuItem
                  onClick={() => setNumberFilter(null)}
                  className={cn("text-sm", !numberFilter ? "text-primary" : "text-slate-300")}
                >
                  All numbers
                </DropdownMenuItem>
                {accountNumbers.map((n) => (
                  <DropdownMenuItem
                    key={n.phone_number_id}
                    onClick={() => setNumberFilter(n.phone_number_id)}
                    className={cn(
                      "text-sm",
                      numberFilter === n.phone_number_id ? "text-primary" : "text-slate-300",
                    )}
                  >
                    {n.label ? `${n.label} (+${n.phone_number_id})` : `+${n.phone_number_id}`}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Label filter */}
          {labels.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs transition-colors",
                  labelFilter
                    ? "bg-primary/20 text-primary"
                    : "text-slate-400 hover:text-white hover:bg-slate-800",
                )}
              >
                <Tag className="h-3 w-3" />
                {labelFilter
                  ? (labels.find((l) => l.id === labelFilter)?.name ?? "Label")
                  : "Label"}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="border-slate-700 bg-slate-800">
                <DropdownMenuItem
                  onClick={() => setLabelFilter(null)}
                  className={cn("text-sm", !labelFilter ? "text-primary" : "text-slate-300")}
                >
                  All labels
                </DropdownMenuItem>
                {labels.map((l) => (
                  <DropdownMenuItem
                    key={l.id}
                    onClick={() => setLabelFilter(l.id)}
                    className={cn(
                      "text-sm gap-2",
                      labelFilter === l.id ? "text-primary" : "text-slate-300",
                    )}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: l.color }}
                    />
                    {l.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Conversation Items */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-slate-500">No conversations found</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                itemLabels={(convLabels.get(conv.id) ?? [])
                  .map((id) => labels.find((l) => l.id === id))
                  .filter((l): l is ChatLabel => !!l)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  itemLabels?: ChatLabel[];
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  itemLabels = [],
}: ConversationItemProps) {
  const contact = conversation.contact;
  // Group conversations: prefer group_name, fall back to contact.name
  const isGroup = conversation.is_group === true;
  const displayName = isGroup
    ? (conversation.group_name ?? contact?.name ?? "Group")
    : (contact?.name || contact?.phone || "Unknown");
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : "";

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-800/50",
        isActive && "border-l-2 border-primary bg-slate-800/70"
      )}
    >
      {/* Avatar */}
      <div className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center text-sm font-medium text-white",
        isGroup ? "rounded-lg bg-primary/20" : "rounded-full bg-slate-700"
      )}>
        {isGroup ? (
          <Users className="h-5 w-5 text-primary" />
        ) : contact?.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1">
            {conversation.pinned && (
              <Pin className="h-3 w-3 shrink-0 rotate-45 text-primary" />
            )}
            <span className="truncate text-sm font-medium text-white">
              {displayName}
            </span>
            {conversation.muted && (
              <BellOff className="h-3 w-3 shrink-0 text-slate-600" />
            )}
          </span>
          <span className="shrink-0 text-[10px] text-slate-500">{timeAgo}</span>
        </div>
        {itemLabels.length > 0 && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {itemLabels.slice(0, 3).map((l) => (
              <span
                key={l.id}
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[9px] font-medium"
                style={{ backgroundColor: `${l.color}26`, color: l.color }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: l.color }}
                />
                {l.name}
              </span>
            ))}
          </div>
        )}
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-slate-400">
            {conversation.last_message_text || "No messages yet"}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span
                className={cn(
                  "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold",
                  conversation.muted
                    ? "bg-slate-700 text-slate-400"
                    : "bg-primary text-primary-foreground",
                )}
              >
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>
      </div>
    </button>
  );
}

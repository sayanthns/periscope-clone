"use client";

import { useState, useRef, useCallback, KeyboardEvent, useEffect } from "react";
import { Send, Zap, Clock, StickyNote, MessageSquare, X, Paperclip, Mic, Square, AtSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { useCan } from "@/hooks/use-can";
import { cn } from "@/lib/utils";
import { ReplyQuote } from "./reply-quote";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { format } from "date-fns";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

interface MessageComposerProps {
  conversationId: string;
  /** @deprecated Baileys has no session expiry. Kept for API compat. */
  sessionExpired: boolean;
  onSend: (text: string, replyToId?: string, isNote?: boolean, mentionedJids?: string[]) => void;
  /** @deprecated Baileys has no Meta templates. Kept for API compat. */
  onOpenTemplates?: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
  /** Group context — enables the @mention picker */
  isGroup?: boolean;
  groupJid?: string;
}

interface GroupMember {
  jid: string;
  phone: string;
  admin: string | null;
}

interface QuickReply {
  id: string;
  shortcut: string;
  message: string;
}

interface ScheduledRow {
  id: string;
  content_text: string;
  send_at: string;
  recurrence: string | null;
}

export function MessageComposer({
  conversationId,
  sessionExpired: _sessionExpired,
  onSend,
  replyTo,
  onClearReply,
  isGroup = false,
  groupJid,
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [noteMode, setNoteMode] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [suggestions, setSuggestions] = useState<QuickReply[]>([]);
  const [suggestionIdx, setSuggestionIdx] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = useCan("send-messages");
  const readOnly = !canSend;

  // Schedule dialog
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [pendingScheduled, setPendingScheduled] = useState<ScheduledRow[]>([]);

  // Media attach
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // ── @mentions (groups) ─────────────────────────────────────
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const mentionedRef = useRef<Map<string, string>>(new Map()); // "@phone" → jid

  useEffect(() => {
    mentionedRef.current.clear();
    if (!isGroup || !groupJid) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/whatsapp/groups/participants?jid=${encodeURIComponent(groupJid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (cancelled || !payload?.participants) return;
        setMembers(
          payload.participants
            // Unresolved privacy LIDs can't be mentioned by number — hide
            // them until the lid→phone map learns the pair (they message once)
            .filter((p: { jid: string }) => p.jid.endsWith("@s.whatsapp.net"))
            .map((p: { jid: string; admin: string | null }) => ({
              jid: p.jid,
              phone: p.jid.split("@")[0],
              admin: p.admin,
            })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isGroup, groupJid, conversationId]);

  const mentionMatches = mentionQuery !== null
    ? members.filter((m) => m.phone.includes(mentionQuery)).slice(0, 8)
    : [];

  const insertMention = useCallback((member: GroupMember) => {
    setText((prev) => {
      const at = prev.lastIndexOf("@");
      if (at === -1) return prev;
      const tag = `@${member.phone} `;
      mentionedRef.current.set(`@${member.phone}`, member.jid);
      return prev.slice(0, at) + tag;
    });
    setMentionQuery(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  // ── Typing presence (throttled to one ping / 3s) ───────────
  const lastPresenceRef = useRef(0);
  const pingPresence = useCallback((state: "composing" | "recording" | "paused") => {
    if (noteMode) return;
    const now = Date.now();
    if (state !== "paused" && now - lastPresenceRef.current < 3000) return;
    lastPresenceRef.current = now;
    void fetch("/api/whatsapp/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId, state }),
    }).catch(() => {});
  }, [conversationId, noteMode]);

  // ── Voice note recording ───────────────────────────────────
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopRecorderTimer = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : "audio/webm;codecs=opus";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(250);
      recorderRef.current = recorder;
      setRecording(true);
      setRecordSecs(0);
      recordTimerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
      pingPresence("recording");
    } catch {
      toast.error("Microphone access denied");
    }
  }, [pingPresence]);

  const stopRecording = useCallback(async (send: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    stopRecorderTimer();
    setRecording(false);

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    recorder.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;

    if (!send) return;
    // Capture the recorded length (whole seconds, min 1) so WhatsApp shows
    // the voice-note duration instead of falling back to the clock time.
    const durationSecs = Math.max(1, recordSecs);
    const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
    if (blob.size < 1000) {
      toast.info("Recording too short");
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const ext = recorder.mimeType.includes("ogg") ? "ogg" : "webm";
      const path = `outbound/voice-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("wa-media")
        .upload(path, blob, { contentType: recorder.mimeType });
      if (upErr) {
        toast.error(`Upload failed: ${upErr.message}`);
        return;
      }
      const { data: pub } = supabase.storage.from("wa-media").getPublicUrl(path);
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          message_type: "audio",
          media_url: pub.publicUrl,
          media_mimetype: "audio/ogg; codecs=opus",
          media_ptt: true,
          media_duration: durationSecs,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload?.error || "Voice note failed");
        return;
      }
      toast.success("Voice note sent");
    } finally {
      setUploading(false);
    }
  }, [conversationId]);

  useEffect(() => () => stopRecorderTimer(), []);

  const handleAttach = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow re-selecting the same file
      if (!file || uploading) return;

      if (file.size > 50 * 1024 * 1024) {
        toast.error("File too large — max 50 MB");
        return;
      }

      const kind = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : file.type.startsWith("audio/")
            ? "audio"
            : "document";

      setUploading(true);
      try {
        const supabase = createClient();
        const safeName = file.name.replace(/[^\w.\-]/g, "_");
        const path = `outbound/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("wa-media")
          .upload(path, file, { contentType: file.type || "application/octet-stream" });
        if (upErr) {
          toast.error(`Upload failed: ${upErr.message}`);
          return;
        }
        const { data: pub } = supabase.storage.from("wa-media").getPublicUrl(path);

        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversationId,
            message_type: kind,
            media_url: pub.publicUrl,
            media_mimetype: file.type || undefined,
            // Caption: whatever's typed in the box (document captions show
            // the filename if box is empty)
            content_text: text.trim() || (kind === "document" ? file.name : undefined),
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(payload?.error || `Send failed (${res.status})`);
          return;
        }
        setText("");
        toast.success(`${kind.charAt(0).toUpperCase() + kind.slice(1)} sent`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [conversationId, text, uploading],
  );

  // Load quick replies once
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles').select('account_id').eq('user_id', user.id).maybeSingle();
      if (!profile?.account_id) return;
      const { data } = await supabase
        .from('quick_replies').select('id,shortcut,message')
        .eq('account_id', profile.account_id).order('shortcut');
      if (data) setQuickReplies(data);
    });
  }, []);

  // Load pending scheduled messages for this conversation
  const loadScheduled = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/whatsapp/scheduled?conversation_id=${conversationId}`,
      );
      if (!res.ok) return;
      const payload = await res.json();
      setPendingScheduled(payload.scheduled ?? []);
    } catch { /* non-critical */ }
  }, [conversationId]);

  useEffect(() => {
    loadScheduled();
  }, [loadScheduled]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      // Collect jids for any "@phone" tags still present in the text
      const mentionedJids: string[] = [];
      for (const [tag, jid] of mentionedRef.current) {
        if (trimmed.includes(tag)) mentionedJids.push(jid);
      }
      onSend(trimmed, replyTo?.id, noteMode, mentionedJids.length ? mentionedJids : undefined);
      mentionedRef.current.clear();
      pingPresence("paused");
      setText("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setShowSuggestions(false);
      setSuggestions([]);
      setMentionQuery(null);
    } finally {
      setSending(false);
    }
  }, [text, sending, onSend, replyTo?.id, noteMode, pingPresence]);

  const handleSchedule = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !scheduleAt || scheduling) return;
    setScheduling(true);
    try {
      const res = await fetch("/api/whatsapp/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          content_text: trimmed,
          send_at: new Date(scheduleAt).toISOString(),
          recurrence: recurrence || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload?.error || `Schedule failed (${res.status})`);
        return;
      }
      toast.success(
        `Scheduled for ${format(new Date(scheduleAt), "d MMM, HH:mm")}${recurrence ? ` (${recurrence})` : ""}`,
      );
      setText("");
      setScheduleOpen(false);
      setScheduleAt("");
      setRecurrence("");
      loadScheduled();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Schedule failed");
    } finally {
      setScheduling(false);
    }
  }, [text, scheduleAt, recurrence, scheduling, conversationId, loadScheduled]);

  const cancelScheduled = useCallback(async (id: string) => {
    await fetch(`/api/whatsapp/scheduled?id=${id}`, { method: "DELETE" });
    loadScheduled();
  }, [loadScheduled]);

  const insertQuickReply = useCallback((qr: QuickReply) => {
    setText(qr.message);
    setShowSuggestions(false);
    setSuggestions([]);
    setTimeout(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        adjustHeight();
      }
    }, 0);
  }, [adjustHeight]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setText(val);
      adjustHeight();
      if (val.trim()) pingPresence("composing");

      // @mention detection (groups): live query after the last "@"
      if (isGroup && members.length > 0) {
        const at = val.lastIndexOf("@");
        if (at !== -1 && (at === 0 || /\s/.test(val[at - 1]))) {
          const after = val.slice(at + 1);
          if (/^\d{0,15}$/.test(after)) {
            setMentionQuery(after);
            setMentionIdx(0);
          } else {
            setMentionQuery(null);
          }
        } else {
          setMentionQuery(null);
        }
      }

      // Show quick reply suggestions when text starts with "/"
      if (val.startsWith('/') && quickReplies.length > 0) {
        const query = val.slice(1).toLowerCase();
        const matches = quickReplies.filter(
          (qr) => qr.shortcut.slice(1).toLowerCase().startsWith(query)
        );
        if (matches.length > 0) {
          setSuggestions(matches);
          setSuggestionIdx(0);
          setShowSuggestions(true);
          return;
        }
      }
      setShowSuggestions(false);
      setSuggestions([]);
    },
    [adjustHeight, quickReplies, pingPresence, isGroup, members.length]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // @mention navigation takes priority while the picker is open
      if (mentionQuery !== null && mentionMatches.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionIdx((i) => (i + 1) % mentionMatches.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionIdx((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
          return;
        }
        if (e.key === "Tab" || e.key === "Enter") {
          e.preventDefault();
          insertMention(mentionMatches[mentionIdx]);
          return;
        }
        if (e.key === "Escape") {
          setMentionQuery(null);
          return;
        }
      }

      if (showSuggestions && suggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSuggestionIdx((i) => (i + 1) % suggestions.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSuggestionIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && showSuggestions)) {
          e.preventDefault();
          insertQuickReply(suggestions[suggestionIdx]);
          return;
        }
        if (e.key === 'Escape') {
          setShowSuggestions(false);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, showSuggestions, suggestions, suggestionIdx, insertQuickReply, mentionQuery, mentionMatches, mentionIdx, insertMention]
  );

  return (
    <div className={cn(
      "shrink-0 border-t border-slate-800 p-3 transition-colors",
      noteMode ? "bg-amber-950/30" : "bg-slate-900",
    )}>
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}

      {/* Pending scheduled messages strip */}
      {pendingScheduled.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {pendingScheduled.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-300"
            >
              <Clock className="h-3 w-3 shrink-0 text-primary" />
              <span className="truncate flex-1">{s.content_text}</span>
              <span className="shrink-0 text-slate-500">
                {format(new Date(s.send_at), "d MMM HH:mm")}
                {s.recurrence ? ` · ${s.recurrence}` : ""}
              </span>
              <button
                onClick={() => cancelScheduled(s.id)}
                title="Cancel scheduled message"
                className="shrink-0 text-slate-500 hover:text-red-400"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* @mention picker (groups) */}
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div className="mb-2 overflow-hidden rounded-xl border border-slate-700 bg-slate-800 shadow-lg">
          {mentionMatches.map((m, idx) => (
            <button
              key={m.jid}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(m);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                idx === mentionIdx
                  ? "bg-primary/20 text-white"
                  : "text-slate-300 hover:bg-slate-700/50",
              )}
            >
              <AtSign className="h-3 w-3 shrink-0 text-primary" />
              <span className="flex-1">+{m.phone}</span>
              {m.admin && <span className="text-[10px] text-amber-400">admin</span>}
            </button>
          ))}
        </div>
      )}

      {/* Recording bar */}
      {recording && (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-950/30 px-3 py-2">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <span className="flex-1 text-sm text-red-300">
            Recording… {Math.floor(recordSecs / 60)}:{String(recordSecs % 60).padStart(2, "0")}
          </span>
          <button
            onClick={() => void stopRecording(false)}
            className="rounded-md px-2 py-1 text-xs text-slate-400 hover:text-white"
          >
            Cancel
          </button>
          <Button
            size="sm"
            onClick={() => void stopRecording(true)}
            className="h-7 bg-red-600 px-3 text-xs hover:bg-red-600/90"
          >
            <Send className="mr-1 h-3 w-3" /> Send
          </Button>
        </div>
      )}

      {/* Quick reply suggestions popup */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="mb-2 rounded-xl border border-slate-700 bg-slate-800 overflow-hidden shadow-lg">
          {suggestions.map((qr, idx) => (
            <button
              key={qr.id}
              onMouseDown={(e) => { e.preventDefault(); insertQuickReply(qr); }}
              className={cn(
                "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors",
                idx === suggestionIdx
                  ? "bg-primary/20 text-white"
                  : "text-slate-300 hover:bg-slate-700/50"
              )}
            >
              <span className="text-[11px] font-mono font-medium text-primary">{qr.shortcut}</span>
              <span className="text-xs text-slate-400 truncate">{qr.message}</span>
            </button>
          ))}
        </div>
      )}

      {/* Message / Note mode toggle */}
      <div className="mb-2 flex items-center gap-1">
        <button
          onClick={() => setNoteMode(false)}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
            !noteMode
              ? "bg-primary/20 text-primary"
              : "text-slate-500 hover:text-slate-300",
          )}
        >
          <MessageSquare className="h-3 w-3" /> Message
        </button>
        <button
          onClick={() => setNoteMode(true)}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
            noteMode
              ? "bg-amber-500/20 text-amber-400"
              : "text-slate-500 hover:text-slate-300",
          )}
        >
          <StickyNote className="h-3 w-3" /> Note
        </button>
        {noteMode && (
          <span className="ml-1 text-[10px] text-amber-500/70">
            Team-only — not sent to WhatsApp
          </span>
        )}
      </div>

      <div className="flex items-end gap-2">
        {/* Quick replies hint button */}
        <Button
          variant="ghost"
          size="sm"
          title="Quick replies (type / to trigger)"
          className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-white"
          onClick={() => {
            setText('/');
            const el = textareaRef.current;
            if (el) { el.focus(); }
            // Trigger suggestions for all quick replies
            setSuggestions(quickReplies);
            setSuggestionIdx(0);
            setShowSuggestions(quickReplies.length > 0);
          }}
          disabled={readOnly}
        >
          <Zap className="h-4 w-4" />
        </Button>

        {/* Schedule button — opens dialog using current draft text */}
        {!noteMode && (
          <Button
            variant="ghost"
            size="sm"
            title="Schedule message"
            className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-white"
            onClick={() => {
              if (!text.trim()) {
                toast.info("Type the message first, then schedule it");
                return;
              }
              setScheduleOpen(true);
            }}
            disabled={readOnly}
          >
            <Clock className="h-4 w-4" />
          </Button>
        )}

        {/* Attach media */}
        {!noteMode && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
              className="hidden"
              onChange={handleAttach}
            />
            <Button
              variant="ghost"
              size="sm"
              title="Attach file (typed text becomes the caption)"
              className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-white"
              onClick={() => fileInputRef.current?.click()}
              disabled={readOnly || uploading}
            >
              {uploading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </Button>
          </>
        )}

        {/* Voice note */}
        {!noteMode && (
          <Button
            variant="ghost"
            size="sm"
            title={recording ? "Stop recording" : "Record voice note"}
            className={cn(
              "h-9 w-9 shrink-0 p-0",
              recording ? "text-red-400 hover:text-red-300" : "text-slate-400 hover:text-white",
            )}
            onClick={() => (recording ? void stopRecording(true) : void startRecording())}
            disabled={readOnly || uploading}
          >
            {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            readOnly
              ? "Read-only — viewers can browse but not reply"
              : noteMode
                ? "Type a private note… (visible to your team only)"
                : "Type a message… (/ for quick replies, Shift+Enter for new line)"
          }
          disabled={readOnly}
          rows={1}
          title={readOnly ? "Read-only — your role can't send messages" : undefined}
          className={cn(
            "flex-1 resize-none rounded-xl border px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors",
            noteMode
              ? "border-amber-700/50 bg-amber-950/40 focus:border-amber-500/60"
              : "border-slate-700 bg-slate-800 focus:border-primary/50",
            readOnly && "cursor-not-allowed opacity-50"
          )}
        />

        <GatedButton
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          disabled={!text.trim() || sending}
          onClick={handleSend}
          className={cn(
            "h-9 w-9 shrink-0 p-0 disabled:opacity-40",
            noteMode
              ? "bg-amber-600 hover:bg-amber-600/90"
              : "bg-primary hover:bg-primary/90",
          )}
        >
          {noteMode ? <StickyNote className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </GatedButton>
      </div>

      {/* Schedule dialog */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="border-slate-700 bg-slate-900 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Schedule message</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300">
              {text}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm text-slate-300">Send at</Label>
              <input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                min={format(new Date(Date.now() + 60_000), "yyyy-MM-dd'T'HH:mm")}
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-primary/50 [color-scheme:dark]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm text-slate-300">Repeat</Label>
              <select
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-primary/50"
              >
                <option value="">Don&apos;t repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setScheduleOpen(false)}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              disabled={!scheduleAt || scheduling}
              onClick={handleSchedule}
              className="bg-primary hover:bg-primary/90"
            >
              {scheduling ? "Scheduling…" : "Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

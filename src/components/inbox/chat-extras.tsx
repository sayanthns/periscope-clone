"use client";

/**
 * Per-chat extras for the right sidebar — Periskope parity:
 *
 * - Tasks: lightweight tickets tied to this conversation (title,
 *   assignee, due date, open/done)
 * - Custom properties: free-form key→value pairs stored in
 *   conversations.custom_properties (JSONB)
 */

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  CheckSquare,
  Square,
  Plus,
  Trash2,
  ListTodo,
  Settings2,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface TaskRow {
  id: string;
  title: string;
  assignee_id: string | null;
  due_date: string | null;
  status: "open" | "done";
  created_at: string;
}

interface ProfileLite {
  user_id: string;
  full_name: string | null;
}

interface ChatExtrasProps {
  conversationId: string;
  customProperties?: Record<string, string>;
}

export function ChatExtras({ conversationId, customProperties }: ChatExtrasProps) {
  const { accountId, user } = useAuth();

  // ── Tasks ──────────────────────────────────────────────────
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [newDue, setNewDue] = useState("");

  const loadTasks = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("tasks")
      .select("id, title, assignee_id, due_date, status, created_at")
      .eq("conversation_id", conversationId)
      .order("status", { ascending: true })
      .order("created_at", { ascending: false });
    setTasks((data as TaskRow[]) ?? []);
  }, [conversationId]);

  useEffect(() => {
    loadTasks();
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("user_id, full_name")
      .then(({ data }) => setProfiles((data as ProfileLite[]) ?? []));
  }, [loadTasks]);

  const addTask = useCallback(async () => {
    if (!accountId || !user || !newTitle.trim()) return;
    const supabase = createClient();
    const { error } = await supabase.from("tasks").insert({
      account_id: accountId,
      conversation_id: conversationId,
      title: newTitle.trim(),
      assignee_id: newAssignee || null,
      due_date: newDue || null,
      created_by: user.id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewTitle("");
    setNewAssignee("");
    setNewDue("");
    loadTasks();
  }, [accountId, user, newTitle, newAssignee, newDue, conversationId, loadTasks]);

  const toggleTask = useCallback(async (task: TaskRow) => {
    const supabase = createClient();
    const done = task.status === "open";
    await supabase
      .from("tasks")
      .update({
        status: done ? "done" : "open",
        completed_at: done ? new Date().toISOString() : null,
      })
      .eq("id", task.id);
    loadTasks();
  }, [loadTasks]);

  const deleteTask = useCallback(async (id: string) => {
    const supabase = createClient();
    await supabase.from("tasks").delete().eq("id", id);
    loadTasks();
  }, [loadTasks]);

  const nameFor = useCallback(
    (userId: string | null) =>
      profiles.find((p) => p.user_id === userId)?.full_name ?? null,
    [profiles],
  );

  // ── Custom properties ──────────────────────────────────────
  const [props, setProps] = useState<Record<string, string>>(customProperties ?? {});
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  useEffect(() => {
    setProps(customProperties ?? {});
  }, [customProperties, conversationId]);

  const saveProps = useCallback(async (next: Record<string, string>) => {
    setProps(next);
    const supabase = createClient();
    const { error } = await supabase
      .from("conversations")
      .update({ custom_properties: next })
      .eq("id", conversationId);
    if (error) toast.error(error.message);
  }, [conversationId]);

  const addProp = useCallback(() => {
    const k = newKey.trim();
    if (!k) return;
    saveProps({ ...props, [k]: newValue.trim() });
    setNewKey("");
    setNewValue("");
  }, [newKey, newValue, props, saveProps]);

  const removeProp = useCallback((key: string) => {
    const next = { ...props };
    delete next[key];
    saveProps(next);
  }, [props, saveProps]);

  const openTasks = tasks.filter((t) => t.status === "open");
  const doneTasks = tasks.filter((t) => t.status === "done");

  return (
    <>
      {/* Tasks */}
      <div>
        <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-slate-500">
          <ListTodo className="h-3 w-3" />
          Tasks {openTasks.length > 0 && `(${openTasks.length} open)`}
        </div>

        <div className="mt-2 space-y-1">
          {[...openTasks, ...doneTasks].map((task) => (
            <div
              key={task.id}
              className="group flex items-start gap-2 rounded-md bg-slate-800 px-2 py-1.5 text-xs"
            >
              <button onClick={() => toggleTask(task)} className="mt-px shrink-0">
                {task.status === "done" ? (
                  <CheckSquare className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Square className="h-3.5 w-3.5 text-slate-500 hover:text-white" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className={task.status === "done" ? "text-slate-500 line-through" : "text-slate-200"}>
                  {task.title}
                </p>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
                  {nameFor(task.assignee_id) && <span>@{nameFor(task.assignee_id)}</span>}
                  {task.due_date && (
                    <span className={
                      task.status === "open" && new Date(task.due_date) < new Date()
                        ? "text-red-400"
                        : ""
                    }>
                      due {format(new Date(task.due_date), "d MMM")}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => deleteTask(task.id)}
                className="hidden shrink-0 text-slate-600 hover:text-red-400 group-hover:block"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2 space-y-1">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTask();
            }}
            placeholder="New task…"
            className="h-7 w-full rounded-md border border-slate-700 bg-slate-800 px-2 text-xs text-white placeholder-slate-500 outline-none focus:border-primary/50"
          />
          <div className="flex gap-1">
            <select
              value={newAssignee}
              onChange={(e) => setNewAssignee(e.target.value)}
              className="h-7 flex-1 rounded-md border border-slate-700 bg-slate-800 px-1 text-xs text-slate-300 outline-none"
            >
              <option value="">Unassigned</option>
              {profiles.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.full_name ?? p.user_id.slice(0, 8)}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={newDue}
              onChange={(e) => setNewDue(e.target.value)}
              className="h-7 w-28 rounded-md border border-slate-700 bg-slate-800 px-1 text-xs text-slate-300 outline-none [color-scheme:dark]"
            />
            <Button
              size="sm"
              className="h-7 w-7 bg-primary p-0 hover:bg-primary/90"
              disabled={!newTitle.trim()}
              onClick={addTask}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      <div className="my-4 border-t border-slate-800" />

      {/* Custom properties */}
      <div>
        <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-slate-500">
          <Settings2 className="h-3 w-3" />
          Properties
        </div>

        <div className="mt-2 space-y-1">
          {Object.entries(props).map(([key, value]) => (
            <div
              key={key}
              className="group flex items-center gap-2 rounded-md bg-slate-800 px-2 py-1 text-xs"
            >
              <span className="shrink-0 font-medium text-slate-400">{key}</span>
              <span className="flex-1 truncate text-right text-slate-200">{value}</span>
              <button
                onClick={() => removeProp(key)}
                className="hidden shrink-0 text-slate-600 hover:text-red-400 group-hover:block"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2 flex gap-1">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="Key"
            className="h-7 w-20 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs text-white placeholder-slate-500 outline-none focus:border-primary/50"
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addProp();
            }}
            placeholder="Value"
            className="h-7 flex-1 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs text-white placeholder-slate-500 outline-none focus:border-primary/50"
          />
          <Button
            size="sm"
            className="h-7 w-7 bg-primary p-0 hover:bg-primary/90"
            disabled={!newKey.trim()}
            onClick={addProp}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </>
  );
}

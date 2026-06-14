'use client';

/**
 * QuickRepliesManager
 *
 * Replaces the Meta-specific TemplateManager for Baileys-based WhatsApp.
 * Quick replies are canned text snippets identified by a shortcut (e.g. "/hello").
 * In the message composer, typing "/" shows matching suggestions.
 *
 * Table: quick_replies (account_id, shortcut, message)
 */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, X, Check, Loader2, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface QuickReply {
  id: string;
  account_id: string;
  shortcut: string;
  message: string;
  created_at: string;
}

interface FormState {
  shortcut: string;
  message: string;
}

const EMPTY_FORM: FormState = { shortcut: '', message: '' };

export function QuickRepliesManager() {
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<QuickReply | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [accountId, setAccountId] = useState<string | null>(null);

  const supabase = createClient();

  // Load account_id + quick replies
  const load = useCallback(async () => {
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.account_id) { setLoading(false); return; }
    setAccountId(profile.account_id);

    const { data, error } = await supabase
      .from('quick_replies')
      .select('*')
      .eq('account_id', profile.account_id)
      .order('shortcut');

    if (error) {
      toast.error('Failed to load quick replies');
    } else {
      setItems(data ?? []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(item: QuickReply) {
    setEditTarget(item);
    setForm({ shortcut: item.shortcut, message: item.message });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditTarget(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    if (!accountId) return;

    const shortcut = form.shortcut.trim().replace(/^\/+/, ''); // strip leading slashes
    const message = form.message.trim();

    if (!shortcut) { toast.error('Shortcut is required'); return; }
    if (!message) { toast.error('Message is required'); return; }

    setSaving(true);

    if (editTarget) {
      const { error } = await supabase
        .from('quick_replies')
        .update({ shortcut: `/${shortcut}`, message, updated_at: new Date().toISOString() })
        .eq('id', editTarget.id);

      if (error) {
        toast.error(error.message.includes('unique') ? 'Shortcut already exists' : 'Failed to save');
      } else {
        toast.success('Quick reply updated');
        closeDialog();
        load();
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('quick_replies')
        .insert({ account_id: accountId, shortcut: `/${shortcut}`, message, created_by: user?.id });

      if (error) {
        toast.error(error.message.includes('unique') ? 'Shortcut already exists' : 'Failed to save');
      } else {
        toast.success('Quick reply created');
        closeDialog();
        load();
      }
    }

    setSaving(false);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    const { error } = await supabase.from('quick_replies').delete().eq('id', id);
    if (error) {
      toast.error('Failed to delete');
    } else {
      toast.success('Deleted');
      setItems((prev) => prev.filter((r) => r.id !== id));
    }
    setDeleting(null);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Quick Replies</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Canned responses your team can insert with a <code className="text-primary text-[11px]">/shortcut</code> in the message composer.
          </p>
        </div>
        <Button onClick={openCreate} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          New
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : items.length === 0 ? (
        <Card className="border-slate-700 bg-slate-900">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Zap className="h-8 w-8 text-slate-600" />
            <p className="text-sm text-slate-400">No quick replies yet — create one to speed up responses.</p>
            <Button onClick={openCreate} variant="outline" size="sm" className="border-slate-700 gap-1.5">
              <Plus className="h-4 w-4" />
              Create your first quick reply
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Card key={item.id} className="border-slate-700 bg-slate-900">
              <CardContent className="flex items-start justify-between gap-4 py-3 px-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-mono font-medium text-primary">{item.shortcut}</span>
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-2 whitespace-pre-wrap">{item.message}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-400 hover:text-white"
                    onClick={() => openEdit(item)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-400 hover:text-red-400"
                    onClick={() => handleDelete(item.id)}
                    disabled={deleting === item.id}
                  >
                    {deleting === item.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />
                    }
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="border-slate-700 bg-slate-900 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Quick Reply' : 'New Quick Reply'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="shortcut" className="text-slate-300 text-xs">
                Shortcut <span className="text-slate-500">(type this in the composer to insert)</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">/</span>
                <Input
                  id="shortcut"
                  value={form.shortcut.replace(/^\//, '')}
                  onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value }))}
                  placeholder="hello"
                  className="pl-6 border-slate-700 bg-slate-800 text-white"
                  maxLength={40}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="message" className="text-slate-300 text-xs">Message</Label>
              <Textarea
                id="message"
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                placeholder="Hello! How can I help you today?"
                className="border-slate-700 bg-slate-800 text-white resize-none"
                rows={4}
                maxLength={1024}
              />
              <p className="text-right text-[10px] text-slate-500">{form.message.length}/1024</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog} className="text-slate-400" disabled={saving}>
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {editTarget ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

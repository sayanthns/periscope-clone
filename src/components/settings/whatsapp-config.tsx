'use client';

/**
 * WhatsApp connection settings — MULTI-NUMBER Baileys QR flow.
 *
 * An account can link several WhatsApp numbers, each its own session.
 * This panel lists every connected number with its live status and
 * per-number actions (re-link / disconnect / remove), plus an
 * "Add a number" form that runs the QR scan for a new number without
 * touching the others.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Loader2,
  Smartphone,
  QrCode,
  Wifi,
  WifiOff,
  Trash2,
  Plus,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface NumberRow {
  phone_number_id: string;
  label: string | null;
  status: 'connected' | 'disconnected';
  connected_at: string | null;
}

export function WhatsAppConfig() {
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [numbers, setNumbers] = useState<NumberRow[]>([]);

  // Add-number form
  const [phoneInput, setPhoneInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Active QR scan (for the number currently being linked)
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const loadNumbers = useCallback(async () => {
    const res = await fetch('/api/whatsapp/baileys?list=1').catch(() => null);
    if (res?.ok) {
      const data = await res.json() as { numbers: NumberRow[] };
      setNumbers(data.numbers ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) { setLoading(false); return; }
    loadNumbers();
  }, [authLoading, profileLoading, user, accountId, loadNumbers]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = useCallback((pid: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/whatsapp/baileys?phoneId=${encodeURIComponent(pid)}`);
        if (!res.ok) return;
        const data = await res.json() as { status: string; qrImage: string | null };
        if (data.status === 'connected') {
          stopPolling();
          setScanningId(null);
          setQrImage(null);
          toast.success('WhatsApp number connected!');
          loadNumbers();
        } else if (data.status === 'scanning') {
          setQrImage(data.qrImage);
        } else if (data.status === 'disconnected') {
          stopPolling();
          setQrImage(null);
          setScanningId(null);
          loadNumbers();
        }
      } catch { /* keep polling */ }
    }, 2000);
  }, [stopPolling, loadNumbers]);

  const connect = useCallback(async (pid: string, label?: string) => {
    setConnecting(true);
    setQrImage(null);
    setScanningId(pid);
    try {
      const res = await fetch('/api/whatsapp/baileys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_id: pid, label }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to start session');
        setScanningId(null);
        return;
      }
      toast('Scan the QR in WhatsApp → Linked Devices', { icon: '📱' });
      startPolling(pid);
      loadNumbers();
    } catch {
      toast.error('Could not reach the server. Is baileys-service running?');
      setScanningId(null);
    } finally {
      setConnecting(false);
    }
  }, [startPolling, loadNumbers]);

  const handleAdd = useCallback(() => {
    const pid = phoneInput.replace(/\D/g, '');
    if (pid.length < 7 || pid.length > 15) {
      toast.error('Enter a valid number without + (e.g. 919876543210)');
      return;
    }
    if (numbers.some((n) => n.phone_number_id === pid)) {
      toast.error('That number is already added');
      return;
    }
    void connect(pid, labelInput.trim() || undefined);
    setPhoneInput('');
    setLabelInput('');
  }, [phoneInput, labelInput, numbers, connect]);

  const disconnect = useCallback(async (pid: string, remove: boolean) => {
    const msg = remove
      ? 'Remove this number completely? Its conversations stay but it stops syncing.'
      : 'Log out this number? You can re-link with a new QR.';
    if (!confirm(msg)) return;
    stopPolling();
    if (scanningId === pid) { setScanningId(null); setQrImage(null); }
    await fetch(`/api/whatsapp/baileys?phoneId=${encodeURIComponent(pid)}${remove ? '&remove=1' : ''}`, {
      method: 'DELETE',
    }).catch(() => {});
    toast.success(remove ? 'Number removed' : 'Disconnected');
    loadNumbers();
  }, [scanningId, stopPolling, loadNumbers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px] mt-4">
      <div className="space-y-4">
        {/* Connected numbers list */}
        {numbers.length > 0 && (
          <Card className="bg-slate-900 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white text-base">Your numbers ({numbers.length})</CardTitle>
              <CardDescription className="text-slate-400">
                Each number runs its own WhatsApp session. Conversations route to the number they arrived on.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {numbers.map((n) => {
                const isScanning = scanningId === n.phone_number_id;
                return (
                  <div
                    key={n.phone_number_id}
                    className="rounded-lg border border-slate-700 bg-slate-800/50 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <Smartphone className={n.status === 'connected' ? 'size-5 text-emerald-400' : 'size-5 text-slate-500'} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm text-white">+{n.phone_number_id}</span>
                          {n.label && <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">{n.label}</span>}
                        </div>
                        <span className={
                          n.status === 'connected'
                            ? 'inline-flex items-center gap-1 text-[11px] text-emerald-400'
                            : 'inline-flex items-center gap-1 text-[11px] text-slate-500'
                        }>
                          {n.status === 'connected'
                            ? <><CheckCircle2 className="size-3" /> Connected</>
                            : <><WifiOff className="size-3" /> Disconnected</>}
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost" size="sm"
                          title="Re-link (new QR)"
                          className="h-8 px-2 text-slate-400 hover:text-white"
                          disabled={connecting && isScanning}
                          onClick={() => connect(n.phone_number_id, n.label ?? undefined)}
                        >
                          <QrCode className="size-4" />
                        </Button>
                        {n.status === 'connected' && (
                          <Button
                            variant="ghost" size="sm"
                            title="Disconnect"
                            className="h-8 px-2 text-amber-400 hover:text-amber-300"
                            onClick={() => disconnect(n.phone_number_id, false)}
                          >
                            <WifiOff className="size-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost" size="sm"
                          title="Remove"
                          className="h-8 px-2 text-red-400 hover:text-red-300"
                          onClick={() => disconnect(n.phone_number_id, true)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Inline QR while linking this number */}
                    {isScanning && (
                      <div className="mt-3 flex flex-col items-center gap-2 border-t border-slate-700 pt-3">
                        {qrImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={qrImage} alt="QR" width={220} height={220} className="rounded-lg border-4 border-white" />
                        ) : (
                          <div className="flex h-56 w-56 items-center justify-center rounded-lg bg-slate-800">
                            <Loader2 className="size-7 animate-spin text-slate-400" />
                          </div>
                        )}
                        <p className="text-xs text-slate-400">WhatsApp → Linked Devices → Link a Device</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Add a number */}
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Plus className="size-4" /> Add a number
            </CardTitle>
            <CardDescription className="text-slate-400">
              Full international format, digits only, no + (e.g. 919876543210).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">Phone number</Label>
                <Input
                  placeholder="919876543210"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value.replace(/\D/g, ''))}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 font-mono"
                  maxLength={15}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">Label (optional)</Label>
                <Input
                  placeholder="Sales / Support…"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  maxLength={24}
                />
              </div>
            </div>
            <Button
              onClick={handleAdd}
              disabled={connecting || !phoneInput.trim()}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {connecting
                ? <><Loader2 className="size-4 animate-spin" /> Starting…</>
                : <><QrCode className="size-4" /> Connect &amp; show QR</>}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Instructions */}
      <div>
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-base">How it works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-400">
            {[
              'Add a number and click Connect — a QR appears under that number.',
              'On that phone: WhatsApp → Linked Devices → Link a Device → scan.',
              'Repeat to link more numbers. Each gets its own inbox filter.',
            ].map((t, i) => (
              <div key={i} className="flex gap-3">
                <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shrink-0 mt-0.5">{i + 1}</span>
                <p>{t}</p>
              </div>
            ))}
            <div className="mt-4 pt-4 border-t border-slate-700 flex items-start gap-2">
              <Wifi className="size-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-slate-500">
                Uses WhatsApp Web protocol (Baileys). Each linked phone must stay online. If a number disconnects, click the QR icon to re-link.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  LogIn,
  Smartphone,
  Inbox,
  MessageSquare,
  Users,
  Zap,
  Radio,
  Contact,
  Tag,
  UsersRound,
  ShieldOff,
  Gauge,
  Wrench,
} from "lucide-react";

// ── Section definitions ──────────────────────────────────────────────────────

const SECTIONS = [
  { id: "logging-in",       label: "Logging In",               icon: LogIn },
  { id: "connecting-wa",    label: "Connecting WhatsApp",      icon: Smartphone },
  { id: "inbox",            label: "The Inbox",                icon: Inbox },
  { id: "messaging",        label: "Reading & Replying",       icon: MessageSquare },
  { id: "groups",           label: "Group Conversations",      icon: Users },
  { id: "quick-replies",    label: "Quick Replies",            icon: Zap },
  { id: "broadcasts",       label: "Broadcasts",               icon: Radio },
  { id: "contacts",         label: "Contacts",                 icon: Contact },
  { id: "tags",             label: "Tags",                     icon: Tag },
  { id: "team",             label: "Team & Roles",             icon: UsersRound },
  { id: "optout",           label: "Opt-Out / STOP",          icon: ShieldOff },
  { id: "rate-limits",      label: "Rate Limits",              icon: Gauge },
  { id: "troubleshooting",  label: "Troubleshooting",          icon: Wrench },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

// ── Sub-components ────────────────────────────────────────────────────────────

function H2({ id, children }: { id: SectionId; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="mb-4 mt-10 flex scroll-mt-6 items-center gap-2 text-xl font-bold text-white first:mt-0"
    >
      <span className="h-px flex-1 bg-slate-800" />
      <span>{children}</span>
      <span className="h-px flex-1 bg-slate-800" />
    </h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 mt-6 text-base font-semibold text-white">{children}</h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-slate-300">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mb-4 ml-4 list-disc space-y-1 text-sm text-slate-300">
      {children}
    </ul>
  );
}

function OL({ children }: { children: React.ReactNode }) {
  return (
    <ol className="mb-4 ml-4 list-decimal space-y-1 text-sm text-slate-300">
      {children}
    </ol>
  );
}

function Callout({ type = "info", children }: { type?: "info" | "warning" | "tip"; children: React.ReactNode }) {
  const styles = {
    info:    "border-primary/40 bg-primary/10 text-primary",
    warning: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    tip:     "border-green-500/40 bg-green-500/10 text-green-300",
  };
  const labels = { info: "ℹ Note", warning: "⚠ Important", tip: "💡 Tip" };
  return (
    <div className={cn("mb-4 rounded-lg border px-4 py-3 text-sm", styles[type])}>
      <span className="mr-2 font-semibold">{labels[type]}:</span>
      {children}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="mb-4 overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-800/60">
            {headers.map((h) => (
              <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={cn("border-b border-slate-800/50 last:border-0", i % 2 === 1 && "bg-slate-800/20")}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 text-slate-300">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[12px] text-primary">
      {children}
    </code>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="mb-4 overflow-x-auto rounded-lg bg-slate-800 px-4 py-3 font-mono text-xs text-slate-300">
      {children}
    </pre>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [activeId, setActiveId] = useState<SectionId>("logging-in");
  const contentRef = useRef<HTMLDivElement>(null);

  // Highlight active section in TOC based on scroll position
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id as SectionId);
          }
        }
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );

    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  function scrollTo(id: SectionId) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex h-full gap-6">
      {/* ── TOC Sidebar ───────────────────────────────────────────────────── */}
      <aside className="hidden w-52 shrink-0 xl:block">
        <div className="sticky top-0">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            On this page
          </p>
          <nav className="space-y-0.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => scrollTo(id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  activeId === id
                    ? "bg-primary/15 font-medium text-primary"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div ref={contentRef} className="min-w-0 flex-1 pb-24">
        {/* Page header */}
        <div className="mb-8 rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-800/60 px-8 py-8">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              User Guide
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white">WhatsApp Team Inbox</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Complete guide for agents and team members using the inbox daily.
          </p>
        </div>

        {/* ─── 1. Logging In ────────────────────────────────────────────── */}
        <H2 id="logging-in">Logging In</H2>
        <OL>
          <li>Open the app URL in your browser.</li>
          <li>Enter your email and password.</li>
          <li>You land on the <strong>Inbox</strong> by default.</li>
        </OL>
        <Callout type="tip">
          First time? Ask your admin to invite you via <strong>Settings → Members → Invite</strong>.
        </Callout>

        {/* ─── 2. Connecting WhatsApp ───────────────────────────────────── */}
        <H2 id="connecting-wa">Connecting WhatsApp</H2>
        <Callout type="info">
          Only admins need to do this — once per WhatsApp number.
        </Callout>
        <OL>
          <li>Go to <strong>Settings → WhatsApp Config</strong>.</li>
          <li>Click <strong>Connect WhatsApp</strong>.</li>
          <li>A QR code appears on screen.</li>
          <li>
            On your phone: <strong>WhatsApp → Linked Devices → Link a Device</strong> → scan the QR.
          </li>
          <li>Status changes to <strong>Connected ✓</strong>.</li>
        </OL>
        <Callout type="warning">
          Use a dedicated business number — not your personal number. Keep the phone online at all times. The Baileys linked-device model requires the source phone to have internet.
        </Callout>
        <P>If the QR expires, click <strong>Regenerate QR</strong>. If you see <strong>Disconnected</strong>, click <strong>Reconnect</strong> — a new QR appears.</P>

        {/* ─── 3. The Inbox ─────────────────────────────────────────────── */}
        <H2 id="inbox">The Inbox</H2>
        <Pre>{`┌──────────────────┬──────────────────────┬──────────────────┐
│ Conversation     │   Message Thread     │  Contact Sidebar │
│ List             │                      │                  │
└──────────────────┴──────────────────────┴──────────────────┘`}</Pre>

        <H3>Conversation List controls</H3>
        <Table
          headers={["Control", "What it does"]}
          rows={[
            ["Search bar", "Filter by contact name, phone, or last message text"],
            ["Status dropdown", "Show All / Open / Pending / Closed conversations"],
            ["Groups button", "Toggle — show only WhatsApp group threads"],
            ["Orange unread badge", "Number of unread messages from customer"],
            ["Status dot", "Green = Open · Yellow = Pending · Grey = Closed"],
          ]}
        />

        <H3>Changing conversation status</H3>
        <P>
          Inside any conversation, use the <strong>Status dropdown</strong> in the top bar.
        </P>
        <UL>
          <li><strong>Open</strong> — Active, needs attention</li>
          <li><strong>Pending</strong> — Waiting on customer reply</li>
          <li><strong>Closed</strong> — Resolved</li>
        </UL>

        <H3>Assigning conversations</H3>
        <P>
          Click the <strong>Assign</strong> (person icon) button in the thread header → select a team member.
        </P>

        {/* ─── 4. Reading & Replying ────────────────────────────────────── */}
        <H2 id="messaging">Reading &amp; Replying to Messages</H2>

        <H3>Sending a text reply</H3>
        <OL>
          <li>Click a conversation in the list.</li>
          <li>Type your message in the composer at the bottom.</li>
          <li>Press <Code>Enter</Code> to send, or <Code>Shift + Enter</Code> for a new line.</li>
        </OL>

        <H3>Replying to a specific message</H3>
        <P>
          Hover any bubble → click the <strong>↩ Reply</strong> icon. The composer shows
          a quote. Your reply is visually linked to that message.
        </P>

        <H3>Sending media</H3>
        <P>
          Click the <strong>paperclip / media</strong> button → pick a file (image, video, audio,
          document) → add optional caption → send.
        </P>

        <H3>Message status icons</H3>
        <Table
          headers={["Icon", "Meaning"]}
          rows={[
            ["🕐 Clock", "Sending"],
            ["✓ Single grey check", "Sent to WhatsApp servers"],
            ["✓✓ Double grey checks", "Delivered to recipient's phone"],
            ["✓✓ Double blue checks", "Read by recipient"],
            ["✗ Red X", "Failed — hover for reason"],
          ]}
        />

        <H3>Reactions</H3>
        <P>
          Hover a message → click the <strong>emoji</strong> icon to react. Customer
          reactions appear below their bubble automatically.
        </P>

        {/* ─── 5. Groups ────────────────────────────────────────────────── */}
        <H2 id="groups">Group Conversations</H2>
        <P>
          WhatsApp group chats appear in the inbox automatically when the first message
          arrives from a group the number is in.
        </P>

        <H3>How groups look different</H3>
        <UL>
          <li>People icon instead of a contact avatar — with a blue tint.</li>
          <li>Each bubble shows the <strong>sender&apos;s name</strong> above it in small text.</li>
          <li>Last-message preview shows <Code>SenderName: message text</Code>.</li>
        </UL>

        <H3>Filtering groups</H3>
        <P>
          Click the <strong>Groups</strong> button in the conversation list header — it turns
          blue when active, showing only group threads.
        </P>

        <H3>Replying in a group</H3>
        <P>
          Type in the composer — your message goes to the entire group. To message a
          group member privately, open their 1-to-1 conversation instead.
        </P>

        {/* ─── 6. Quick Replies ─────────────────────────────────────────── */}
        <H2 id="quick-replies">Quick Replies</H2>
        <P>
          Canned text snippets your team creates. Insert them with a <Code>/shortcut</Code> in
          the composer to answer common questions instantly.
        </P>

        <H3>Using quick replies in a conversation</H3>
        <OL>
          <li>In the composer, type <Code>/</Code> (forward slash).</li>
          <li>A popup shows matching quick replies — type more letters to filter.</li>
          <li>Use <Code>↑ / ↓</Code> to navigate, <Code>Tab</Code> or <Code>Enter</Code> to insert.</li>
          <li>The full message text is inserted — edit if needed — then <Code>Enter</Code> to send.</li>
        </OL>
        <Callout type="tip">
          Click the <strong>⚡ Zap icon</strong> on the left of the composer to browse all quick replies without typing.
        </Callout>

        <H3>Creating quick replies</H3>
        <OL>
          <li>Go to <strong>Settings → Quick Replies</strong>.</li>
          <li>Click <strong>New</strong>.</li>
          <li>Enter a <strong>Shortcut</strong> (e.g. <Code>hello</Code>) — becomes <Code>/hello</Code> in the composer.</li>
          <li>Enter the full <strong>Message</strong> text (up to 1,024 characters).</li>
          <li>Click <strong>Create</strong>.</li>
        </OL>

        <H3>Recommended shortcuts</H3>
        <Table
          headers={["Shortcut", "Use for"]}
          rows={[
            ["/hi", "Opening greeting"],
            ["/hours", "Business hours reply"],
            ["/thanks", "Thank-you message"],
            ["/price", "Pricing information"],
            ["/wait", "Please hold / we'll be right with you"],
          ]}
        />

        {/* ─── 7. Broadcasts ────────────────────────────────────────────── */}
        <H2 id="broadcasts">Broadcasts</H2>
        <P>Send the same message to many contacts at once.</P>
        <Callout type="info">
          Admin and Agent roles only — Viewers cannot broadcast.
        </Callout>
        <OL>
          <li>Go to <strong>Broadcasts</strong> in the sidebar.</li>
          <li>Click <strong>New Broadcast</strong>.</li>
          <li>Select contacts or upload a CSV of phone numbers.</li>
          <li>Write your message.</li>
          <li>Click <strong>Send</strong>.</li>
        </OL>
        <Callout type="warning">
          Contacts who have opted out are automatically skipped. They appear as <Code>failed: opted out</Code> in the result report. You cannot override this.
        </Callout>
        <P>
          Broadcasts are also subject to the daily rate limits below — the system
          enforces this automatically.
        </P>

        {/* ─── 8. Contacts ──────────────────────────────────────────────── */}
        <H2 id="contacts">Contacts</H2>

        <H3>Viewing a contact</H3>
        <P>
          Click any conversation → the <strong>right sidebar</strong> shows: name, phone, email,
          company, tags, custom fields, notes, and conversation history.
        </P>

        <H3>Creating / editing</H3>
        <UL>
          <li><strong>Auto-created</strong> — when someone messages you first; WA display name is used.</li>
          <li><strong>Manual</strong> — Contacts page → <strong>New Contact</strong>.</li>
          <li><strong>Edit</strong> — open a contact → <strong>Edit</strong> button in the sidebar.</li>
        </UL>

        <H3>Opt-in status</H3>
        <Table
          headers={["Status", "Meaning"]}
          rows={[
            ["✅ Opted in", "Can receive outbound messages and broadcasts"],
            ["❌ Opted out", "All outbound messages are blocked automatically"],
          ]}
        />
        <P>
          Opt-in is granted automatically when a contact messages you first
          (inbound = consent).
        </P>

        {/* ─── 9. Tags ──────────────────────────────────────────────────── */}
        <H2 id="tags">Tags</H2>

        <H3>Adding a tag to a contact</H3>
        <OL>
          <li>Open a conversation → contact sidebar.</li>
          <li>Click <strong>+ Tag</strong>.</li>
          <li>Pick an existing tag or create a new one.</li>
        </OL>

        <H3>Managing tags</H3>
        <P>
          <strong>Settings → Tags</strong> — create, rename, or delete tags (colour-coded).
        </P>

        <H3>Filtering by tag</H3>
        <P>
          On the <strong>Contacts</strong> page, use the tag filter dropdown to show only
          contacts with a specific tag.
        </P>

        {/* ─── 10. Team & Roles ─────────────────────────────────────────── */}
        <H2 id="team">Team &amp; Roles</H2>
        <Table
          headers={["Role", "Inbox", "Send", "Broadcast", "Settings"]}
          rows={[
            ["Owner", "✓", "✓", "✓", "✓ Full"],
            ["Admin", "✓", "✓", "✓", "✓ Full"],
            ["Agent", "✓", "✓", "✓", "Limited"],
            ["Viewer", "✓ Read-only", "✗", "✗", "✗"],
          ]}
        />

        <H3>Inviting team members</H3>
        <OL>
          <li><strong>Settings → Members → Invite Member</strong>.</li>
          <li>Enter their email and select a role.</li>
          <li>They receive an invitation email to set their password.</li>
        </OL>

        {/* ─── 11. Opt-Out / STOP ───────────────────────────────────────── */}
        <H2 id="optout">Opt-Out / STOP Handling</H2>
        <P>
          The system automatically detects opt-out replies in multiple languages:
        </P>
        <Table
          headers={["Language", "Triggers"]}
          rows={[
            ["English", "STOP · UNSUBSCRIBE · CANCEL · QUIT · END · OPT OUT · REMOVE"],
            ["Arabic", "نه · إلغاء · توقف · بند"],
            ["Hindi", "रुको"],
          ]}
        />
        <H3>What happens automatically</H3>
        <OL>
          <li>Opt-out is recorded immediately.</li>
          <li>The STOP message appears in the thread so the agent can see it.</li>
          <li>All future outbound messages to that contact are blocked.</li>
          <li>They are silently skipped in any broadcast.</li>
        </OL>
        <Callout type="tip">
          To re-enable a contact manually: open their contact record → toggle Opted In back on (Admin only).
        </Callout>

        {/* ─── 12. Rate Limits ──────────────────────────────────────────── */}
        <H2 id="rate-limits">Rate Limits &amp; Safe Messaging</H2>
        <P>
          To protect your WhatsApp number from being banned, the system enforces
          a warm-up schedule based on how long your number has been connected:
        </P>
        <Table
          headers={["Number age", "Daily outbound limit"]}
          rows={[
            ["Days 1–7", "10 messages / day"],
            ["Days 8–14", "50 messages / day"],
            ["Days 15–30", "200 messages / day"],
            ["Days 31+", "500 messages / day"],
          ]}
        />
        <H3>What happens when you hit the limit</H3>
        <P>
          Outbound messages return a <Code>429 — Rate Limited</Code> error. The message is
          NOT sent. Try again the next day.
        </P>
        <H3>Additional protections (automatic)</H3>
        <UL>
          <li>Random delay of 0.8–2.3 seconds between each message to look human.</li>
          <li>Duplicate detection — same message to same contact within 5 minutes is blocked.</li>
        </UL>
        <H3>Best practices to avoid bans</H3>
        <UL>
          <li>Never do sudden large volume spikes.</li>
          <li>Only message contacts who have messaged you first (opted in).</li>
          <li>Respect STOP requests — the system does this automatically.</li>
          <li>Use the number for real conversations, not just bulk blasting.</li>
        </UL>

        {/* ─── 13. Troubleshooting ──────────────────────────────────────── */}
        <H2 id="troubleshooting">Troubleshooting</H2>

        <H3>&ldquo;WhatsApp Disconnected&rdquo; banner in inbox</H3>
        <P>
          Your linked device session dropped. Go to <strong>Settings → WhatsApp Config →
          Reconnect</strong> and re-scan the QR code.
        </P>

        <H3>Messages not appearing in inbox</H3>
        <OL>
          <li>Check the connected status in Settings.</li>
          <li>Click the <strong>Refresh ↺</strong> button in the thread header.</li>
          <li>If still missing, ask your admin to verify the baileys-service process is running.</li>
        </OL>

        <H3>Message shows &ldquo;Failed&rdquo; status</H3>
        <P>Hover the red ✗ icon for the reason. Common causes:</P>
        <UL>
          <li>Recipient&apos;s phone is off or has no internet</li>
          <li>Number not registered on WhatsApp</li>
          <li>Daily rate limit reached — try tomorrow</li>
        </UL>

        <H3>Quick reply not appearing when I type <Code>/</Code></H3>
        <P>
          Check that quick replies exist in <strong>Settings → Quick Replies</strong>.
          Shortcuts must start with <Code>/</Code> — edit any that are missing it.
        </P>

        <H3>Contact shows as &ldquo;Opted Out&rdquo; but they want messages</H3>
        <P>
          An admin can manually re-enable opt-in on the contact record.
        </P>

        <H3>Group messages not appearing</H3>
        <P>
          Groups sync when the first message arrives. If you were added to a new group,
          someone in the group needs to send a message — it will then appear in the inbox.
        </P>

        {/* Footer */}
        <div className="mt-12 border-t border-slate-800 pt-6 text-center text-xs text-slate-600">
          WhatsApp Team Inbox — Baileys Edition
        </div>
      </div>
    </div>
  );
}

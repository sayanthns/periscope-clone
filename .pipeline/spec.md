# Spec — WhatsApp-Web-style inbox search (chats + contacts + messages)

## Goal

Make the inbox search box behave like WhatsApp Web. Today the search box (in
`conversation-list.tsx`) only filters the already-loaded `conversations` array
in memory (by name / phone / last-message text) plus a debounced message
full-text search (`messages.content_text ilike`). It does **not** query the
`contacts` table, so searching a person who has no open conversation (e.g.
"siva") returns nothing.

After this change, when the search box has a query the list renders **grouped
sections**, WhatsApp-Web style:

1. **Chats** — matching conversations (current in-memory behavior, unchanged).
2. **Contacts** — contacts from the `contacts` table whose name/phone match,
   **excluding** anyone already shown under Chats. (This is the new part — a DB
   query, because these contacts are not in the loaded `conversations` array.)
3. **Messages** — conversations matched only via message full-text (the existing
   FTS hits not already a name/phone/last-message chat match). Optional but
   cheap; the data already exists.

Clicking a contact under "Contacts" who has no conversation **creates/opens** a
conversation with them (reusing the existing server logic) and selects it.

Empty query → identical to today's behavior (single ungrouped list, no section
headers, no DB contacts query).

## Files To Modify

- `src/components/inbox/conversation-list.tsx` — **primary file.** Add the
  debounced contacts query, grouped-section rendering, a contact-row
  sub-component, and the create-on-click handler.
- `src/app/api/whatsapp/new-conversation/route.ts` — **modify, small.** Add an
  optional "create/open only, do not send a message" mode (see Step 4). Today
  the route *requires* `text` and always sends a first message via Baileys.
  WhatsApp Web opens an empty chat on contact click without sending anything, so
  we need a no-send path. (Alternative considered in Open Questions.)

No new migration, no type changes required (`Contact` type already covers the
columns read). No change to `inbox/page.tsx` — the new conversation surfaces via
the existing realtime `conversations` INSERT handler + `onSelect`.

## Functions / Components / Queries Touched

In `conversation-list.tsx`:

- **`search` state** (line 65) — unchanged trigger, now drives a third effect.
- **New effect: debounced contacts query** — mirrors the message-FTS effect
  (lines 79-102): same 300ms debounce, same `q.length < 3` guard, same cancel
  flag. Sets new `contactMatches` state (`Contact[]`).
- **`filtered` useMemo** (line 290) — kept as the "Chats" source of truth;
  derive the Contacts and (optional) Messages subsets from it.
- **`ConversationItem`** (line 707) — reused as-is for Chats and Messages.
- **New `ContactResultItem`** sub-component — contact with no conversation
  (avatar/initial + name + masked phone), styled to match `ConversationItem`.
- **New `handleSelectContact`** callback — POST to `new-conversation`
  (create-only), then `onSelect` the returned conversation.
- Render block (lines 669-694) gains conditional section headers when
  `search.trim()` is non-empty.

Server: `new-conversation` POST gains an optional no-send branch.

## Implementation Steps (ordered, each independently verifiable)

### Step 1 — Debounced contacts DB query
Add alongside the message-FTS effect. New state:
`const [contactMatches, setContactMatches] = useState<Contact[]>([]);`
(import `Contact` from `@/types`).

Effect (same shape as the FTS effect at lines 79-102):

```
useEffect(() => {
  const q = search.trim();
  if (q.length < 3) { setContactMatches([]); return; }
  let cancelled = false;
  const timer = setTimeout(async () => {
    const supabase = createClient();
    const term = `%${q}%`;
    const { data } = await supabase
      .from("contacts")
      .select("id, name, phone, avatar_url, is_group, group_jid")
      .eq("is_group", false)                       // exclude group "contacts"
      .or(`name.ilike.${term},phone.ilike.${term}`)
      .order("name")
      .limit(20);
    if (cancelled) return;
    setContactMatches((data ?? []) as Contact[]);
  }, 300);
  return () => { cancelled = true; clearTimeout(timer); };
}, [search]);
```

Notes:
- **No explicit `account_id` filter** — RLS policy `contacts_select` =
  `is_account_member(account_id)` (migration 017) scopes the result to the
  caller's account, exactly like the existing `messages` FTS query and the
  contacts page query (`contacts/page.tsx` lines 95-104) rely on RLS.
- The `.or(name.ilike,phone.ilike)` pattern is copied from `contacts/page.tsx`
  line 103 — matches existing data-access style.
- `is_group = false` keeps WhatsApp groups out of the Contacts section.
- **Verify:** type a name with no open chat → network tab shows the contacts
  query firing once after 300ms; response contains the contact.

### Step 2 — Derive the three groups in/after `filtered`
Keep `filtered` (line 290) as the Chats source of truth. Then compute, only when
`search.trim()` is non-empty:

- **chatContactIds** = `new Set(filtered.map(c => c.contact_id))` — contacts
  already represented by a chat (de-dup key is `contact_id`, not name).
- **contactsOnly** = `contactMatches.filter(ct => !chatContactIds.has(ct.id))`
  — the Contacts section.
- **Messages section** (optional): conversations in `filtered` that matched
  *only* via `msgMatchIds` and not via name/phone/last-message. If the split is
  fiddly, ship Chats + Contacts first — the FTS hits already appear inside Chats
  today, so nothing regresses. (Minimal path: Chats + Contacts; Messages
  optional.)

**Verify:** confirm `contactsOnly` excludes anyone whose id is a `contact_id` in
`filtered`.

### Step 3 — Grouped section rendering
In the ScrollArea body (lines 669-694):

- `search.trim()` empty → render exactly as today (single list, no headers). No
  behavior change for the default inbox.
- Non-empty → render up to three sections, each preceded by a small
  WhatsApp-Web-style header (uppercase, muted, e.g.
  `text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-3 py-1.5`):
  - "Chats" — `filtered` through `ConversationItem` (current code).
  - "Contacts" — `contactsOnly` through the new `ContactResultItem`.
  - "Messages" (optional) — message-only hits through `ConversationItem`.
- Empty-state: only show "No conversations found" when **all** visible sections
  are empty (broaden line 674's `filtered.length === 0` to also require
  `contactsOnly.length === 0`). Render only non-empty sections.

**Verify:** a query matching both an open chat and a contactless contact shows
two headers with the right rows under each.

### Step 4 — `new-conversation` no-send mode (server)
WhatsApp Web opens an empty chat on contact click — no message sent. The route
(lines 56-64) hard-requires `text` and always sends via Baileys (lines 138-184).
Add an opt-in no-send branch:

- Accept `body.create_only === true` (or treat absent `text` as create-only).
  When set:
  - Keep auth, rate-limit, account resolution, config resolution (config still
    needed to stamp `phone_number_id` on a new conversation).
  - Run existing find-or-create contact (lines 77-102) and find-or-create
    conversation (lines 104-136).
  - **Skip** the Baileys send (138-152) and the message insert (154-184).
  - Return `{ success: true, conversation_id }`.
- Leave the send-with-text path untouched (the "New conversation" dialog still
  uses it).

**Verify:** POST `{ phone, create_only: true }` returns a `conversation_id` and
inserts no message row.

### Step 5 — `handleSelectContact` (client) + wire `ContactResultItem`
New callback in `conversation-list.tsx`:

```
const handleSelectContact = useCallback(async (contact: Contact) => {
  const res = await fetch("/api/whatsapp/new-conversation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: contact.phone.replace(/\D/g, ""),
      create_only: true,
      ...(numberFilter ? { phone_number_id: numberFilter } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.conversation_id) { /* error toast */ return; }
  const supabase = createClient();
  const { data: conv } = await supabase
    .from("conversations")
    .select("*, contact:contacts(*)")
    .eq("id", data.conversation_id)
    .maybeSingle();
  if (conv) { setSearch(""); onSelect(conv as Conversation); }
}, [onSelect, numberFilter]);
```

- Clearing `search` after select collapses the grouped view back to the normal
  list; the new conv is now present via the realtime INSERT the parent handles
  (or the next refetch) plus the joined row we pass directly.
- `onSelect(conv)` reuses the parent's `handleSelectConversation` — same path as
  clicking any chat, so URL deep-link + unread reset work for free.

`ContactResultItem` markup: copy `ConversationItem`'s avatar + name layout
(lines 740-771), drop last-message / unread / status; show masked phone as the
secondary line via `useMaskedPhone()` (`src/hooks/use-masked-phone.ts`).

**Verify:** click a contactless contact → a chat opens (empty thread), URL =
`/inbox?c=<id>`, no message sent, and the new chat appears in the normal list
once search clears.

## Edge Cases

- **RLS / account scoping (critical):** the contacts query MUST rely on the
  `contacts_select` RLS policy (`is_account_member(account_id)`) for tenancy —
  do **not** add a manual `account_id` filter (the existing FTS + contacts-page
  queries already trust RLS). Prevents cross-account contact leakage.
- **Contact already has a conversation → don't double-list.** Excluded via
  `chatContactIds` (Step 2), keyed on `Conversation.contact_id`.
- **Group contacts.** `is_group = false` in the query → groups appear only as
  Chats, never in Contacts (can't DM a group JID via this flow).
- **Multi-number selection when creating a chat.** A new conversation needs a
  `phone_number_id`. Mirror the existing dialog: if the inbox `numberFilter` is
  set, pass it; else let the server's
  `resolveConfigForConversation(supabase, accountId, null)` pick (prefers a
  connected number, then any) — same resolution the dialog send path uses. Zero
  configured numbers → the route's existing "WhatsApp not configured" error →
  surface it.
- **Empty query resets to normal list.** Guard all new logic behind
  `search.trim()` non-empty; the contacts effect early-returns on `q.length < 3`,
  matching the FTS threshold so headers don't flash for 1-2 char queries.
- **Debounce.** Contacts query uses the same 300ms + cancel-flag debounce as the
  FTS effect; do not introduce different timing.
- **Masked numbers setting.** Use `useMaskedPhone()` for the phone on
  `ContactResultItem` so masked-account agents/viewers see `+9199•••••210`,
  consistent with the rest of the inbox.
- **Performance / limit.** Cap the contacts query at `.limit(20)`. RLS bounds it
  to one account; the 20-row limit + `idx_contacts_account` keep `ilike '%q%'`
  cheap and consistent with the existing 300-row message FTS query.
- **Phone-only matches.** Stored phone is `+<digits>`; a bare-digit query still
  substring-matches via `phone.ilike`.
- **Create race / idempotency.** `new-conversation` already find-or-creates
  (lines 104-116), so clicking a contact who just got a conversation returns the
  existing one — no duplicate.
- **Self-heal on select.** If the realtime INSERT hasn't landed when we
  `onSelect`, the parent's `hydrateConversation` (inbox/page.tsx lines 80-122)
  backfills; we also pass a fully-joined conv so the thread opens immediately.

## Test Plan

- **Build on server** (per repo norms; this Next.js fork has custom conventions
  — see `AGENTS.md`, the build is the real gate): run typecheck/lint/build to
  confirm no type errors from the new `Contact` import, new state, and route
  change.
- **Visual / manual (primary):**
  1. Empty search → list identical to today (no headers). Regression check.
  2. Search a name with an open chat → under **Chats**.
  3. Search a name (≥3 chars) with NO open chat but an existing contact (e.g.
     "siva") → under **Contacts**; click → chat opens/creates, thread empty,
     URL = `/inbox?c=<id>`, no message sent.
  4. Search a word only in message bodies → still surfaces the chat (Messages
     section if implemented, else under Chats as today).
  5. A contact with a chat appears under Chats only, never duplicated.
  6. Masked-numbers account (non-admin) → contact phone masked.
  7. Multi-number: set the number filter, click a contactless contact → created
     conversation carries that `phone_number_id`.
- **Unit-testable logic:** extract the de-dup/grouping into a pure helper
  `groupSearchResults(filteredConvs, contactMatches)` → `{ chats, contactsOnly }`
  and test: (a) excludes contacts already in chats by `contact_id`, (b) preserves
  order, (c) empty inputs. DB queries + React effects are verified visually (as
  the existing FTS search is).

## Open Questions

1. **No-send vs send-on-open.** WhatsApp Web opens an *empty* chat on contact
   click. This spec adds a `create_only` mode to `new-conversation`. Alternative:
   keep the route send-only and instead open the existing "New conversation"
   dialog pre-filled with the contact's number (forces typing a first message).
   **Recommend the no-send `create_only` mode** for true parity — confirm it's
   acceptable that it creates a conversation row with no messages (the list
   already renders that as "No messages yet").
2. **Opt-in on chat-open.** A manually-added contact may have `opted_in = false`.
   Opening a conversation sends nothing (no consent issue); the first agent
   message later still goes through normal send. Confirm no policy requires
   blocking chat-open for non-opted-in contacts.
3. **Messages section scope.** Distinct "Messages" header, or fold FTS hits into
   "Chats" (status quo)? Recommend Chats + Contacts first; Messages section is
   optional polish. Confirm priority.
4. **`create_only` rate limiting.** The route rate-limits under
   `RATE_LIMITS.send`. A create-only call sends nothing — lighter limit or keep
   it? Minor; default to keeping the existing limit unless annoying.

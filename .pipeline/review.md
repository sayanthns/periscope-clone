# Review — WhatsApp-Web-style inbox search (Chats + Contacts)

Reviewer: adversarial quality gate. Two files, uncommitted working tree.
Scope: `src/components/inbox/conversation-list.tsx`,
`src/app/api/whatsapp/new-conversation/route.ts`.

## Gate 1 — Security / tenancy (CRITICAL) → PASS

Contacts query has no manual `account_id` filter (conversation-list.tsx:118-123)
and relies on RLS. Verified the policy chain is real and enforced:

- `supabase/migrations/001_initial_schema.sql:51` — `ALTER TABLE contacts ENABLE
  ROW LEVEL SECURITY` (RLS is actually ON, not just a dangling policy).
- `supabase/migrations/017_account_sharing.sql:336` — `CREATE POLICY
  contacts_select ON contacts FOR SELECT USING (is_account_member(account_id))`.
- `017_account_sharing.sql:176,255` — `contacts.account_id` added + set `NOT
  NULL`, so every row is account-bound; no null-account escape hatch.
- `is_account_member` defined `017:136`, SECURITY DEFINER, granted to
  `authenticated`. Same policy the existing message-FTS query and contacts page
  already trust. No cross-account leak.

`.or(name.ilike.${term},phone.ilike.${term})` with raw user `q`
(conversation-list.tsx:121): PostgREST filter-injection surface is real (comma /
`)` / `id.eq.` in `q` reshape the filter tree), BUT every resulting row is still
gated by `contacts_select` RLS → worst case is the caller sees *their own*
account's contacts under a malformed filter. No data crosses accounts, no write
path. Identical pattern already ships at `contacts/page.tsx:103`. Not a new vuln,
not a blocker.

## Gate 2 — create_only route → PASS

`route.ts`: order is auth (22-28) → rate-limit `RATE_LIMITS.send` (31-34) →
account resolution (36-48) → body parse → `phone.replace(/\D/g,'')` +
`phone.length < 10` guard (57-62) BEFORE any row creation. `createOnly` only
relaxes the `text` requirement (`if (!text && !createOnly)`, line 65); all other
guards intact. Contact + conversation creation are account-scoped
(`.eq('account_id', accountId)` at 90, 110; insert stamps `account_id` 84, 126).
Early return at 141-143 skips Baileys send + message insert. find-or-create is
idempotent → no duplicate-row abuse. No cross-account create path. Abuse ceiling
is bounded by the existing send rate limit.

## Gate 3 — Correctness (de-dup) → PASS

De-dup key is `contact_id`. Loaded conversations DO carry it: inbox/page.tsx:87
selects `"*, contact:contacts(*)"`, and `Conversation.contact_id` is a typed
column (types/index.ts:347). `contactsOnly` builds `chatContactIds` from
`filtered.map(c => c.contact_id)` (conversation-list.tsx:393-395) and excludes
matched contacts already present → a contact with a chat lists under Chats only.
`handleSelectContact` (398-426) re-fetches the joined conv, clears search, calls
parent `onSelect`; the just-created conv surfaces via the existing realtime
INSERT / refetch plus the fully-joined row passed directly, so the thread opens
immediately even before realtime lands.

## Gate 4 — React → PASS

Contacts effect (107-129) mirrors the proven FTS effect exactly: `cancelled`
flag + `clearTimeout`, `q.length < 3` early return, `[search]` dep — correct.
`contactsOnly` memo deps `[search, filtered, contactMatches]` complete (398).
`handleSelectContact` deps `[onSelect, numberFilter]` complete.
`useMaskedPhone()` called unconditionally at top of `ContactResultItem`
(957) — hooks rules satisfied; returns `{ maskPhone }`, destructure matches
hook signature (use-masked-phone.ts:62).

## Gate 5 — UX regressions → PASS (one minor nit)

- Empty search: `search.trim()` false → `contactsOnly` returns `[]` early (394),
  no contacts query fires (<3 guard), no headers render (all header blocks gated
  on `search.trim() && contactsOnly.length > 0`). Default list unchanged.
- Headers only when grouping: "Chats"/"Contacts" headers both require
  `contactsOnly.length > 0`; a chats-only result stays header-less. Correct.
- Empty-state broadened to require BOTH `filtered.length === 0 &&
  contactsOnly.length === 0` (744). Correct.
- Message-FTS behavior intact: `filtered`/`msgMatchIds` untouched (368).

NIT (non-blocking) — conversation-list.tsx:393-395 vs :347-348: when a
`numberFilter` is active, a contact who already has a chat on a *different*
number is filtered out of `filtered`, so its id is absent from `chatContactIds`
and it can surface under "Contacts". Clicking it re-opens the existing
conversation (route find-or-create is idempotent, 105-116) — no dup row, but the
contact may transiently show under Contacts while its chat is hidden by the
number filter. Cosmetic.

## Gate 6 — Perf → PASS

≥3-char guard (113) + 300ms debounce (115) + `.limit(20)` (124) + `.order(name)`
backed by `idx_contacts_account` (017:274). RLS bounds to one account. No
keystroke storm; matches the existing FTS query's cost profile.

## Build

Pipeline reports server `npm run build` PASS. Selected columns
(`id,user_id,phone,name,email,company,avatar_url,is_group,group_jid,created_at,updated_at`)
all exist on `Contact` (types/index.ts:89-104) — confirmed.

## Summary

All six gates pass. Tenancy genuinely enforced (RLS enabled + account-scoped
select policy). The `.or` injection surface is RLS-contained and pre-existing.
Route keeps full auth/rate-limit/account/phone guards before any row creation.
De-dup sound (`contact_id` present in the loaded join). React effects, memo deps,
hook usage correct. One cosmetic double-list edge under an active number filter —
not worth blocking.

VERDICT: SHIP

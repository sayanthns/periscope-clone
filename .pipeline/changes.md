# Changes — WhatsApp-Web-style search (Chats + Contacts)

## Files changed
1. **src/app/api/whatsapp/new-conversation/route.ts**
   - Added `create_only` body flag. When true: keep auth/rate-limit/account +
     config resolution, run find-or-create contact + conversation, then return
     `{ success, conversation_id }` BEFORE the Baileys send + message insert.
   - Relaxed the `text` requirement: `if (!text && !createOnly)`. Send path with
     text is untouched (the New-conversation dialog still works).

2. **src/components/inbox/conversation-list.tsx**
   - Imports: `Contact` type + `useMaskedPhone`.
   - New debounced (300ms, ≥3 chars) effect querying the `contacts` table
     (`is_group=false`, `name/phone ilike`, `limit 20`, `order name`). No manual
     `account_id` filter — relies on the `contacts_select` RLS policy, same as
     the existing message-FTS query. → `contactMatches` state.
   - `contactsOnly` useMemo: `contactMatches` minus anyone already a chat
     (de-dup by `conversation.contact_id`); empty unless search is non-empty.
   - `handleSelectContact`: POST `new-conversation` `{ phone, create_only:true,
     phone_number_id?: numberFilter }`, re-fetch the conv joined with its
     contact, clear search, call parent `onSelect` (reuses URL deep-link +
     unread reset).
   - Render: when search active AND there are contact hits, show "Chats" and
     "Contacts" section headers (WhatsApp-Web grouping); a chats-only result
     stays header-less (no behaviour change for the default/empty-search list).
     Empty-state now requires BOTH `filtered` and `contactsOnly` empty.
   - New `ContactResultItem` component (avatar/initial + name + masked phone),
     mirrors `ConversationItem` layout.

## Decisions (per gate)
- create_only no-send mode (true WA-Web parity — opens an empty chat).
- No opted-in block on open (nothing is sent; first send is separately gated).
- Chats + Contacts sections now; deferred a distinct "Messages" section (message
  FTS still folds into Chats as before — no regression).
- create_only kept under the existing `RATE_LIMITS.send` class.

## Spec deviations
- None. Messages section intentionally deferred (was flagged optional).

## Notes for Reviewer
- Confirm `Contact` select columns match the type; `useMaskedPhone` returns
  `{ maskPhone }` (destructured).
- RLS scoping on the contacts query (no manual account filter) — verify no
  cross-account leak and that it matches the existing FTS/contacts-page pattern.
- De-dup key is `contact_id` — verify a contact with a chat never double-lists.
- Build is server-only (next/font + Turbopack fail locally) — server build is
  the gate.

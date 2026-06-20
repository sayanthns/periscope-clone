# Test results — WhatsApp-Web search (Chats + Contacts)

## Harness reality
No visual/snapshot harness; the project's vitest covers unrelated logic. The
real automated gate is the server production build (type-check + compile) —
local `next build` fails on next/font + Turbopack.

## Build (server) — PASS
`rm -rf .next && npm run build`: **compiled successfully**, no type errors from
the new `Contact` import / `useMaskedPhone` destructure / `contactMatches` state
/ `ContactResultItem` / the route `create_only` branch. `pm2 restart` back online.

## Visual / manual (pending human)
1. Empty search → list identical to before (no headers). Regression check.
2. Search a contact with no chat (≥3 chars, e.g. "siva") → appears under
   **Contacts**; click → chat opens (empty thread), URL `/inbox?c=<id>`, no
   message sent.
3. Search a name with an open chat → under **Chats**; never double-listed.
4. Masked-numbers (non-admin) → contact phone masked in the row.
5. Multi-number: with a number filter active, created chat carries that
   `phone_number_id`.

## Verdict
Automated gate (build/type/compile): **PASS**. Visual correctness: pending human.

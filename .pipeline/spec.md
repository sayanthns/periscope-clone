# Spec — WhatsApp look & feel (theme change)

## Goal

Re-skin the wacrm app so it reads as WhatsApp Web / WhatsApp Desktop instead of
the current purple "Violet" theme: WhatsApp green/teal accents, the WhatsApp chat
wallpaper behind the message thread, outgoing bubbles in WhatsApp green
(light `#d9fdd3` / dark `#005c4b`), incoming bubbles white/grey, the calmer
WhatsApp surface palette, and the familiar little bubble tail + tick colors. This
is a **visual/theme change only** — no data, behavior, routing, or component-API
changes. The app already has a clean theming mechanism (a `data-theme` attribute on
`<html>` driving CSS-variable blocks in `globals.css`, plus a `light` theme that
proves you can re-skin every hardcoded `slate-*` utility by remapping
`--color-slate-*`). We exploit that exact mechanism: add a **new `whatsapp` theme**
that becomes the default, so the bulk of the change is centralized in `globals.css`
with only a handful of targeted edits for things tokens cannot express (bubble
geometry/tail, chat wallpaper, tick color).

---

## Files To Modify

Central (does ~90% of the work):
- `src/app/globals.css` — add a `html[data-theme="whatsapp"]` block (WhatsApp palette: semantic tokens + the `--color-slate-*` / `--color-white` remap, same technique as the existing `light` theme). Add two new chat-surface tokens (`--chat-bubble-out`, `--chat-bubble-in`) and a `--chat-wallpaper` token.
- `src/lib/themes.ts` — register the `whatsapp` theme in `THEME_IDS` + `THEMES`, and set `DEFAULT_THEME = "whatsapp"`.

Chat-surface component edits (things the slate-remap can't reach):
- `src/components/inbox/message-bubble.tsx` — outgoing/incoming bubble colors switch from `bg-primary` / `bg-slate-800` to the WhatsApp bubble tokens; timestamp/tick contrast inside green bubbles; "read" tick color (currently `text-blue-400` — keep WhatsApp blue, fine as-is); bubble tail already present via `rounded-br-md` / `rounded-bl-md`.
- `src/components/inbox/message-thread.tsx` — `DOODLE_BG_CLASSES` constant: swap `bg-slate-950` for the WhatsApp wallpaper (tokened background); the otherwise-unused `public/inbox-doodle.svg` becomes the tiled wallpaper. Header tint stays a solid surface on top.

Light-mode parity (assets, optional second wallpaper variant):
- `public/inbox-doodle.svg` — recolor stroke to WhatsApp wallpaper tone (currently slate-500 @ 22% on slate-950). Wire it up (it is presently authored but **not referenced anywhere**).

Layout color metadata (cosmetic, not required for correctness):
- `src/app/layout.tsx` — `viewport.themeColor` (`#020617` → WhatsApp dark `#111b21`) and the `<Toaster>` inline `style` background/border (currently hardcoded slate RGB) so toasts match the new surface.

No other files need edits: everything else (sidebar, header, dashboard, pipelines,
broadcasts, settings, contacts) renders through `bg-primary` / `text-primary` /
`slate-*`, all of which are re-pointed centrally by the new theme block.

---

## Functions / Components / Tokens Touched

Tokens (in `globals.css`, new `whatsapp` block):
- Semantic: `--primary`, `--primary-foreground`, `--primary-hover`, `--primary-soft`, `--primary-soft-2`, `--ring`, `--sidebar-primary*`, `--background`, `--foreground`, `--card`, `--popover`, `--secondary`, `--muted*`, `--accent*`, `--border`, `--input`, `--sidebar*`, `--chart-1`.
- Palette remap (the lever for hardcoded utilities): `--color-slate-950 … --color-slate-50`, `--color-white`.
- New chat tokens: `--chat-bubble-out`, `--chat-bubble-out-foreground`, `--chat-bubble-in`, `--chat-bubble-in-foreground`, `--chat-wallpaper`. Surface these through `@theme inline` (e.g. `--color-chat-bubble-out: var(--chat-bubble-out)`) so utilities like `bg-chat-bubble-out` exist.

Catalog (in `themes.ts`):
- `THEME_IDS` (add `"whatsapp"`), `THEMES` (add entry with green swatch), `DEFAULT_THEME` (→ `"whatsapp"`). No change to `ThemeProvider` / boot script — they read these constants.

Components:
- `MessageBubble` (`message-bubble.tsx`): bubble background classes, in-bubble text/time/tick contrast.
- `MessageThread` (`message-thread.tsx`): `DOODLE_BG_CLASSES`.
- (Untouched logic; class-string edits only.)

---

## Implementation Steps

Each step is independently verifiable in the browser.

### 1. Add the `whatsapp` theme block in `globals.css`
Mirror the `light` theme's shape exactly (it is the proven "remap the slate ramp"
template). WhatsApp **light** is recommended as the default surface (rationale + the
dark alternative are in Open Questions). Hex anchors (convert to `oklch(...)` to match
the file's convention, or use hex directly — Tailwind v4 accepts either in a CSS var):

| Role | WhatsApp value (light surface) |
|---|---|
| Accent / `--primary` (header, send button, active states, links) | **`#00a884`** (WhatsApp teal-green) |
| `--primary-hover` | `#008f72` |
| Outgoing bubble `--chat-bubble-out` | **`#d9fdd3`** |
| Outgoing bubble text | `#111b21` |
| Incoming bubble `--chat-bubble-in` | **`#ffffff`** |
| Incoming bubble text | `#111b21` |
| Chat wallpaper `--chat-wallpaper` | **`#efeae2`** (WhatsApp beige) behind the tiled doodle |
| Page / panel background (`--color-slate-900`/`950` remap) | `#ffffff` / `#f0f2f5` (WhatsApp panel grey) |
| Cards / inputs (`--color-slate-800`) | `#f0f2f5` |
| Borders / hover (`--color-slate-700`/`600`) | `#e9edef` / `#d1d7db` |
| Primary text (`--color-white` remap, `--foreground`) | `#111b21` |
| Muted/secondary text (`--color-slate-400`/`500`) | `#667781` / `#54656f` |
| Links | `#027eb5` (WhatsApp link blue) — applies if/where links are styled; mostly N/A in chat |
| Unread badge | `bg-primary text-primary-foreground` already → renders green automatically; verify `#25d366`-ish reads well, optionally pin badge to `#25d366` |
| Delivered/sent tick | grey `#8696a0` (already `text-slate-400` → remapped) |
| Read tick (blue) | `#53bdeb` (currently `text-blue-400`) — acceptable; optionally pin exact WA blue |

Set the dark-theme variant values in Open Questions if a dark default is chosen instead.

**Verify:** temporarily set `localStorage.wacrm.theme = "whatsapp"` (the storage key
is `STORAGE_KEY` = `"wacrm.theme"`), reload — app should render green/grey, no purple
in chrome.

### 2. Register the theme + flip the default in `themes.ts`
- Append `"whatsapp"` to `THEME_IDS`.
- Add a `THEMES` entry: `{ id: "whatsapp", name: "WhatsApp", tagline: "...", swatch: "#00a884" }`.
- Set `DEFAULT_THEME = "whatsapp"`.

**Verify:** clear `localStorage`, hard reload — first paint is WhatsApp (boot script
in `layout.tsx` reads `DEFAULT_THEME`, so no purple flash). Settings → Appearance shows
the new swatch and selecting it persists.

### 3. Outgoing/incoming bubble colors (`message-bubble.tsx`)
In the bubble `className` (around the `isNote ? … : isAgent ? "bg-primary …" : "bg-slate-800 …"`
ternary): change the agent branch from `bg-primary text-primary-foreground` to
`bg-chat-bubble-out text-chat-bubble-out-foreground` and the customer branch from
`bg-slate-800 text-slate-100` to `bg-chat-bubble-in text-chat-bubble-in-foreground`.
Fix the timestamp: it currently uses `text-white/60`, which is invisible on a light
green bubble — change to a token-driven muted color (e.g. `text-black/45` for both
sides, or `text-chat-bubble-out-foreground/55`). The tail is already there
(`rounded-br-md` / `rounded-bl-md`) and reads as WhatsApp once colors change.

**Verify:** open any thread — outgoing bubbles light-green, incoming white, time &
ticks legible inside both.

### 4. Chat wallpaper (`message-thread.tsx` + `inbox-doodle.svg`)
Change `DOODLE_BG_CLASSES` from `"bg-slate-950"` to a wallpaper class:
`"bg-chat-wallpaper"` plus the tiled doodle, e.g.
`bg-[image:var(--chat-wallpaper-image)] bg-repeat` layered over `bg-chat-wallpaper`,
or a single utility that sets `background-color: var(--chat-wallpaper)` with the
doodle SVG as `background-image`. Recolor `public/inbox-doodle.svg` strokes to a
WhatsApp wallpaper tone (low-opacity `#54656f`/beige) so it shows on the beige
background. Keep the header on its own solid surface (already `bg-slate-900` →
remapped to panel grey).

**Verify:** the thread area shows the beige WhatsApp wallpaper with faint doodles;
empty-state and active-thread share the same background (they already both use
`DOODLE_BG_CLASSES`).

### 5. Cosmetic metadata (`layout.tsx`)
Update `viewport.themeColor` to the WhatsApp surface color and the `<Toaster>`
inline `style` background/border to token-aligned values (or `var(--card)` /
`var(--border)`). `colorScheme: "dark"` should become `"light"` if light is the
default (or keep `"dark"` for a dark default).

**Verify:** mobile browser chrome bar matches; toasts match the new palette.

### 6. (If keeping it as the only look) leave the other 5 themes in place
They remain selectable and unaffected. No deletion required — see Open Questions on
whether to retain or hide them.

---

## Edge Cases

- **Dark-mode parity.** This app's "dark mode" is not a `prefers-color-scheme`
  toggle — it is the set of 5 dark `data-theme` blocks vs the one `light` block.
  There is **no OS-driven dark switch and no `.dark` class in active use** (the
  `@custom-variant dark` exists but components use explicit `data-theme` instead).
  So "dark mode" = "does the user pick a dark theme." Decision needed (Open
  Questions): ship WhatsApp **light** only, or also add a WhatsApp **dark** theme
  (bubbles `#005c4b` out / `#202c33` in, wallpaper `#0b141a`, panels `#111b21`,
  accent `#00a884`, text `#e9edef`). Either way the bubble/wallpaper component edits
  must reference **tokens**, not literals, so a dark WhatsApp variant just drops in.
- **Color contrast / WCAG.** Greens are accents, not text backgrounds for body copy,
  so the main risk is small text: timestamps and ticks **inside** the light-green
  `#d9fdd3` bubble. `text-white/60` (current) fails badly on light green — Step 3
  switches it to a dark muted tone (`#111b21` @ ~45–55%) which passes for the
  decorative timestamp size. Verify the green accent `#00a884` on white meets ≥3:1
  for UI components / large text (it does, ~3.0–3.3:1); for green-on-white **body
  text** prefer the darker `#008069`. Unread badge text is `--primary-foreground`
  (white) on green — keep badge green saturated (`#25d366` reads white text fine).
- **Hardcoded purple left behind.** A grep for `purple` finds 7 spots, all *category*
  colors, NOT the app accent: `template-manager.tsx` & `step1-choose-template.tsx`
  ("Marketing" template badge = purple), `pipeline-analytics.tsx` (a metric icon),
  `automations/trigger-meta.ts`, `broadcast-status.ts`, `pipelines/page.tsx` seed
  ("Negotiation" stage), and `app/icon.tsx` (favicon bg `#7c3aed`). These are
  semantic category swatches, **out of scope** for a chat-look change — flag, don't
  touch — except `app/icon.tsx` favicon, which is the app icon and arguably should
  go green (Open Questions). The real accent is `--primary`, fully handled by Step 1.
- **Focus / hover / active states.** All keyed off `--primary` / `primary-soft` /
  `slate-800` hovers → auto-correct via Step 1. Spot-check: sidebar active pill
  (`bg-primary/10 text-primary`), conversation-list selected row (`border-l-2
  border-primary bg-slate-800/70`), composer focus ring (`focus:border-primary/50`),
  dropdown selected items (`text-primary`).
- **Selected-conversation highlight.** `conversation-list.tsx` uses
  `border-l-2 border-primary bg-slate-800/70` — becomes green left-rail + grey hover,
  matches WhatsApp's selected-chat treatment. Confirm the grey is visible on the new
  light panel (slate-800 remap).
- **Send button.** `message-composer.tsx` `GatedButton` uses `bg-primary
  hover:bg-primary/90` → turns green automatically. The note-mode send stays amber
  (intentional, leave it). The voice-record send is `bg-red-600` (intentional).
- **Status / SLA / label badges that rely on the palette.** `STATUS_COLORS` in
  `conversation-list.tsx` maps `open → bg-primary` (green now — correct, "open" =
  active), `pending → bg-amber-500`, `closed → bg-slate-500` (greys via remap). SLA
  badges (`sla-badge.tsx`) and label chips use explicit amber/red/green or per-label
  hex `style={{}}` — unaffected and should stay (red/amber breach semantics must
  survive a green theme). Verify red/amber still pop against the new grey surfaces.
- **Note + recording affordances** (amber / red) are deliberately non-primary; they
  must NOT turn green. Confirm they're untouched.
- **First-paint flash.** Boot script applies `DEFAULT_THEME` before hydration; once
  `DEFAULT_THEME = "whatsapp"` there is no purple flash. Returning users with a
  saved `wacrm.theme` keep their pick — that's expected (Open Questions: force-migrate?).

---

## Test Plan

This is a CSS/theme change with **no unit-test harness for visuals** (vitest exists
but only covers `rate-limit` / `broadcast-status` logic — run `npm test` to confirm
nothing logic-side regressed, and `npm run build` + `npm run typecheck` to prove the
new tokens/classes compile). Primary verification is **visual, page by page**:

Setup: clear `localStorage`, `npm run dev`, hard reload (confirms WhatsApp is the
no-flash default).

Page-by-page checklist:
1. **Inbox / chat thread** (the headline): wallpaper is WhatsApp beige with faint
   doodles; outgoing bubbles light-green with tail bottom-right; incoming bubbles
   white with tail bottom-left; timestamp + ticks legible in both; read-tick blue;
   header on solid panel; send button green; composer focus ring green; note-mode
   amber and voice-record red still distinct.
2. **Conversation list**: selected chat = green left rail + grey row; unread badge
   green; pinned/muted icons green/grey; SLA + label chips keep their colors;
   filters' active state green.
3. **Sidebar + top header**: logo tile green, active nav pill green-tinted,
   avatar fallback green-tinted, "live" ping dot green.
4. **Dashboard**: metric cards / charts — confirm `chart-1` (was purple) is now
   green and nothing looks broken; other chart hues unchanged.
5. **Pipelines**: stage colors unchanged (intentional); deal cards fine; the purple
   "Negotiation" seed + purple metric icon remain (documented out-of-scope).
6. **Broadcasts / Templates**: "Marketing" purple category badge remains
   (out-of-scope); buttons green.
7. **Settings → Appearance**: WhatsApp swatch present & selectable; switching to
   Violet/Emerald/etc. still works and reverts cleanly (proves no theme was broken).
8. **Contacts / Automations / Flows**: smoke-check no purple chrome remains; primary
   buttons green.
9. **Toasts + mobile theme-color**: toast bg matches palette; phone status bar color
   matches.
10. **Accessibility pass**: zoom to bubble timestamps and ticks — confirm legible on
    green; run a contrast check on `#00a884` text vs white if any green text-on-white
    body copy exists.

Pass criteria: no purple in app chrome (only the documented category swatches),
chat reads unmistakably as WhatsApp, all 6 prior themes still switch, build + tests
green.

---

## Open Questions

1. **Light vs dark as the WhatsApp default.** WhatsApp Desktop ships dark by default
   for many users, but the app today is overwhelmingly dark-themed and the screenshots
   show a dark UI; a WhatsApp **light** default is the cleaner, more recognizable
   "WhatsApp Web" look, while a WhatsApp **dark** default is a smaller visual jump
   from the current dark app. **Which should be the default?** (I can ship both as two
   theme entries — `whatsapp` + `whatsapp-dark` — at small extra cost, since the
   component edits are token-driven either way.) *Recommendation: ship WhatsApp light
   as default + add WhatsApp dark as a second selectable theme.* — **Need a decision
   before Step 1 finalizes the palette.**
2. **Literal WhatsApp wallpaper image vs tasteful solid.** WhatsApp's actual doodle
   wallpaper is a copyrighted asset. The repo already has a *clean-room*
   `inbox-doodle.svg` (lucide icons, original art) that evokes it without copying —
   recommend recoloring + using that, not the real WhatsApp PNG. Acceptable, or do
   you want a plain beige/dark solid with no doodle? *Recommendation: recolor the
   existing clean-room SVG.*
3. **Keep the other 5 themes or hide them?** Lowest-risk is to keep Violet/Emerald/
   Cobalt/Amber/Rose/Light selectable and just add WhatsApp as default. Do you want
   them removed from the picker (pure WhatsApp product) or retained as alternates?
   *Recommendation: retain — zero downside, and "WhatsApp" is just one more entry.*
4. **Force-migrate returning users?** Users with a saved `wacrm.theme` (e.g. `violet`)
   will keep purple after this ships. Leave their choice, or one-time force everyone
   to `whatsapp` (e.g. bump the storage key)? *Recommendation: leave existing picks;
   only the default changes.*
5. **Brand / trademark.** Making a third-party CRM look like WhatsApp and using the
   WhatsApp name in the theme picker has trademark implications (WhatsApp/Meta marks).
   The accent hexes and "WhatsApp-style" layout are widely cloned, but confirm
   product/legal is comfortable labeling a theme "WhatsApp" and mimicking the look
   for a shipped product. *Flagging only — not a blocker for the code, but a yes/no
   is wanted before naming the theme literally "WhatsApp" in the UI.*
6. **Favicon (`app/icon.tsx`).** Should the app favicon background (`#7c3aed` purple)
   change to WhatsApp green too, for consistency? It's one line and visually part of
   the "look," but it's the *product* icon, not chat chrome. *Recommendation: change
   to green for consistency.*

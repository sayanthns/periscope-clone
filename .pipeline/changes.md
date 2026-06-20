# Changes — WhatsApp ("Green") look & feel

Implemented the spec exactly: a new default **green** theme (WhatsApp light) +
a selectable **green-dark** variant, driven through the existing token system.
Neutral naming per decision (UI says "Green" / "Green Dark", not "WhatsApp").

## Files changed

1. **src/app/globals.css**
   - `@theme inline`: added 5 chat-surface color mappings → exposes
     `bg-chat-bubble-out`, `bg-chat-bubble-in`, `bg-chat-wallpaper` utilities
     (+ `-foreground` text variants).
   - `:root`/violet block: added chat-token **defaults** that reproduce the
     current look (`--chat-bubble-out: var(--primary)`, in = `slate-800`,
     wallpaper = `slate-950`). All non-green themes inherit these → **zero
     visual change** for violet/emerald/cobalt/amber/rose/light.
   - Added `html[data-theme="green"]` (WhatsApp light: accent `#00a884`,
     out-bubble `#d9fdd3`, in-bubble `#fff`, wallpaper `#efeae2`, full slate
     remap to white/grey panels + dark text — mirrors the proven `light`
     technique).
   - Added `html[data-theme="green-dark"]` (WhatsApp dark: surfaces
     `#0b141a`/`#111b21`/`#202c33`, out-bubble `#005c4b`, in-bubble `#202c33`,
     same `#00a884` accent).

2. **src/lib/themes.ts**
   - `THEME_IDS`: prepended `"green"`, `"green-dark"`.
   - `DEFAULT_THEME = "green"`.
   - `THEMES`: two new entries at the front (swatch `#00a884`). Other 5 themes
     retained and selectable. No force-migration — returning users keep their
     saved pick.

3. **src/components/inbox/message-bubble.tsx**
   - Outgoing bubble: `bg-primary text-primary-foreground` →
     `bg-chat-bubble-out text-chat-bubble-out-foreground`.
   - Incoming bubble: `bg-slate-800 text-slate-100` →
     `bg-chat-bubble-in text-chat-bubble-in-foreground`.
   - Timestamp: `text-white/60` (invisible on light-green) →
     `text-current opacity-55` (legible in every theme + note/voice variants).
   - Ticks left as `text-slate-400` / `text-blue-400` (remap-adaptive; WhatsApp
     grey/blue already correct).

4. **src/components/inbox/message-thread.tsx**
   - `DOODLE_BG_CLASSES`: `bg-slate-950` →
     `bg-chat-wallpaper bg-[url('/inbox-doodle.svg')] bg-repeat` (color token +
     tiled doodle). Used by both empty-state and active thread.

5. **public/inbox-doodle.svg**
   - Stroke `#64748b @ 0.22` → `#54656f @ 0.09` so the one tile reads faintly on
     both the beige light wallpaper and the dark wallpaper. Now actually wired
     up (was authored-but-unused).

6. **src/app/layout.tsx**
   - `viewport.themeColor` `#020617` → `#008069`; `colorScheme` `dark` → `light`.
   - `<Toaster>` hardcoded slate RGB → `var(--card)`/`var(--border)`/
     `var(--card-foreground)`; dropped `theme="dark"` so toasts follow the theme.

7. **src/app/icon.tsx**
   - Favicon background `#7c3aed` (purple) → `#00a884` (green).

## Key decisions
- **Token indirection over per-component edits**: the bubble/wallpaper changes
  reference tokens, so green-dark (and any future theme) drop in with no further
  component edits. Defaults in `:root` guarantee existing themes are byte-for-byte
  unchanged in appearance.
- **Hex used directly** in the green blocks (Tailwind v4 accepts hex in CSS
  vars); `--primary-soft*` use `rgb(... / a)` for the alpha tints.

## Spec deviations
- None functional. Naming is neutral ("Green"/"Green Dark") and a **green-dark**
  variant was added — both per the human gate decisions, consistent with the
  spec's Open Questions recommendations.

## Out of scope (left untouched, as spec flagged)
- Category swatches still purple by design: Marketing template badge, Negotiation
  pipeline stage seed, a pipeline metric icon, automation/broadcast meta colors.
  These are semantic category colors, not the app accent.

## Notes for Reviewer
- Verify `bg-chat-*` utilities actually generate (the `@theme inline` mappings).
- Check contrast: timestamp `text-current/55` + ticks on `#d9fdd3`; accent
  `#00a884` on white for any green-on-white body text.
- Confirm non-green themes are visually unchanged (the `:root` default chat
  tokens must resolve to the old `bg-primary`/`slate-800`/`slate-950`).
- Build is server-only (next/font + Turbopack fail locally) — pass/fail is the
  server `npm run build`.

# Periskope Clone — Agent User Guide

> **WhatsApp Team Inbox** — Powered by Baileys  
> For agents and team members who use the inbox daily.

---

## Table of Contents

1. [Logging In](#1-logging-in)
2. [Connecting WhatsApp](#2-connecting-whatsapp)
3. [The Inbox](#3-the-inbox)
4. [Reading & Replying to Messages](#4-reading--replying-to-messages)
5. [Group Conversations](#5-group-conversations)
6. [Quick Replies](#6-quick-replies)
7. [Broadcasts](#7-broadcasts)
8. [Contacts](#8-contacts)
9. [Tags](#9-tags)
10. [Team & Roles](#10-team--roles)
11. [Opt-Out / STOP Handling](#11-opt-out--stop-handling)
12. [Rate Limits & Safe Messaging](#12-rate-limits--safe-messaging)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Logging In

1. Open the app URL in your browser.
2. Enter your email and password.
3. You land on the **Inbox** by default.

> **First time?** Ask your admin to invite you via **Settings → Members → Invite**.

---

## 2. Connecting WhatsApp

> Only admins need to do this once per WhatsApp number.

1. Go to **Settings → WhatsApp Config**.
2. Click **Connect WhatsApp**.
3. A QR code appears on screen.
4. On your phone: **WhatsApp → Linked Devices → Link a Device** → scan the QR.
5. Status changes to **Connected ✓**.

**Important:**
- Use a dedicated business number — not your personal number.
- Keep the phone with an internet connection (the linked device model requires it).
- If the QR expires, click **Regenerate QR**.
- If you see **Disconnected**, click **Reconnect** — it will show a new QR.

---

## 3. The Inbox

The inbox has three panels:

```
┌─────────────────┬────────────────────────┬──────────────────┐
│ Conversation    │   Message Thread       │  Contact Info    │
│ List            │                        │  Sidebar         │
└─────────────────┴────────────────────────┴──────────────────┘
```

### Conversation List (left panel)

| Control | What it does |
|---|---|
| **Search bar** | Filter by contact name, phone, or last message text |
| **Status dropdown** | Show All / Open / Pending / Closed conversations |
| **Groups button** | Toggle to show only WhatsApp group threads |
| **Unread badge** | Orange number = unread messages from customer |
| **Status dot** | Green = Open, Yellow = Pending, Grey = Closed |

### Changing Conversation Status

Inside a conversation, use the **Status** dropdown in the top bar:

- **Open** — Active, needs attention
- **Pending** — Waiting on customer reply
- **Closed** — Resolved

### Assigning Conversations

Click the **Assign** button (person icon) in the thread header → select a team member.

---

## 4. Reading & Replying to Messages

### Sending a Text Reply

1. Click a conversation.
2. Type your message in the composer at the bottom.
3. Press **Enter** to send (or **Shift+Enter** for a new line).

### Replying to a Specific Message

- Hover over any message → click the **↩ Reply** icon.
- The composer shows a quote of that message.
- Your reply is linked to it and displayed with the quote.

### Sending Media

- Click the **paperclip / media** button in the composer.
- Pick an image, video, audio, or document file.
- Add an optional caption → send.

### Message Status Icons

| Icon | Meaning |
|---|---|
| 🕐 Clock | Sending |
| ✓ Single check | Sent to WhatsApp servers |
| ✓✓ Grey double | Delivered to recipient's phone |
| ✓✓ Blue double | Read by recipient |
| ✗ Red X | Failed — hover for reason |

### Reactions

- Hover a message → click the **emoji** icon to react.
- Customers' reactions appear below their message bubble.

---

## 5. Group Conversations

WhatsApp group chats appear in the inbox automatically when a group message arrives.

**How groups look different:**
- Group icon (people icon) instead of a contact avatar.
- Each message bubble shows the **sender's name** above it in small text.
- Last message preview in the list shows `SenderName: message text`.

**Filtering groups:**
- Click the **Groups** button in the conversation list header (turns blue when active).
- Shows only group threads.

**Limitations:**
- You can **read** group messages in the inbox.
- To **reply** in the group, type in the composer — message goes to the entire group.
- You cannot send to individual group members from the group thread (open their 1:1 conversation instead).

---

## 6. Quick Replies

Quick replies are canned text snippets your team creates. Use them to answer common questions instantly.

### Using Quick Replies in a Conversation

1. In the composer, type **`/`** (forward slash).
2. A popup shows matching quick replies filtered as you type.
3. Use **↑ / ↓ arrow keys** to navigate, **Tab** or **Enter** to insert.
4. The full message text is inserted — edit before sending if needed.
5. Press **Enter** to send.

Or click the **⚡ Zap icon** on the left of the composer to browse all quick replies.

### Creating Quick Replies

1. Go to **Settings → Quick Replies**.
2. Click **New**.
3. Enter a **Shortcut** (e.g. `hello`) — it becomes `/hello` in the composer.
4. Enter the **Message** text (up to 1,024 characters).
5. Click **Create**.

### Editing / Deleting

In **Settings → Quick Replies**, use the pencil (edit) or trash (delete) icons on each row.

**Tip:** Use shortcuts that are short and memorable:
- `/hi` — greeting
- `/hours` — business hours
- `/thanks` — thank-you message
- `/price` — pricing info

---

## 7. Broadcasts

Send the same message to many contacts at once.

> **Who can broadcast:** Admin and Agent roles only (not Viewer).

### Sending a Broadcast

1. Go to **Broadcasts** in the sidebar.
2. Click **New Broadcast**.
3. Select contacts or upload a CSV of phone numbers.
4. Write your message.
5. Click **Send**.

### Opt-Out Safety

Contacts who have opted out are **automatically skipped** — you'll see them marked `failed: opted out` in the result report.

### Rate Limits

Broadcasts are throttled based on how long your number has been active (see [Rate Limits](#12-rate-limits--safe-messaging)). The system enforces this automatically — you cannot override it.

---

## 8. Contacts

### Viewing a Contact

Click any conversation → the **right sidebar** shows:
- Name, phone, email, company
- Tags
- Custom fields
- Notes history
- Conversation history

### Creating / Editing a Contact

- **Auto-created:** When someone messages you for the first time, their contact is created automatically with their WhatsApp display name.
- **Manual:** Go to **Contacts** page → **New Contact**.
- **Edit:** Click a contact → **Edit** button in the sidebar.

### Opt-In Status

Each contact has an opt-in flag:
- ✅ **Opted in** — Can receive outbound messages and broadcasts.
- ❌ **Opted out** — All outbound messages are blocked.

Opt-in is granted automatically when a contact messages you first (inbound = consent).

---

## 9. Tags

Tags let you categorize contacts.

### Adding a Tag to a Contact

1. Open a conversation → contact sidebar.
2. Click **+ Tag**.
3. Pick an existing tag or create a new one.

### Managing Tags

Go to **Settings → Tags** to create, rename, or delete tags (colour-coded).

### Using Tags to Filter

On the **Contacts** page, use the tag filter dropdown to show only contacts with a specific tag.

---

## 10. Team & Roles

| Role | Inbox | Send | Broadcast | Settings |
|---|---|---|---|---|
| **Admin** | ✓ | ✓ | ✓ | ✓ Full access |
| **Agent** | ✓ | ✓ | ✓ | ✓ Limited |
| **Viewer** | ✓ Read-only | ✗ | ✗ | ✗ |

### Inviting Team Members

1. **Settings → Members → Invite Member**.
2. Enter their email and select a role.
3. They receive an invitation email to set their password.

---

## 11. Opt-Out / STOP Handling

The system automatically detects opt-out replies in multiple languages:

| Language | Triggers |
|---|---|
| English | STOP, UNSUBSCRIBE, CANCEL, QUIT, END, OPT OUT, REMOVE |
| Arabic | نه، إلغاء، توقف، بند |
| Hindi | रुको |

**When a contact sends any of these:**
1. Their opt-out is recorded immediately.
2. Their message appears in the thread so your agent can see it.
3. All future outbound messages to them are automatically blocked.
4. They are skipped in broadcasts.

**To re-enable a contact manually:**
- Open their contact record → toggle Opted In back on (Admin only).

---

## 12. Rate Limits & Safe Messaging

To protect your WhatsApp number from being banned, the system enforces a warm-up schedule based on how long your number has been connected:

| Age of number connection | Daily outbound limit |
|---|---|
| Days 1–7 | 10 messages/day |
| Days 8–14 | 50 messages/day |
| Days 15–30 | 200 messages/day |
| Days 31+ | 500 messages/day |

**What happens when you hit the limit:**
- Outbound messages return a **429 — Rate Limited** error.
- The message is NOT sent.
- Try again the next day.

**Additional protections:**
- Random delay (0.8–2.3 seconds) between each message to look human.
- Duplicate detection — same message to same contact within 5 minutes is blocked.

**Best practices to avoid bans:**
- Never do sudden large volume spikes.
- Only message contacts who have messaged you first (opted in).
- Respect STOP requests immediately (the system does this automatically).
- Use the number for real conversations, not just broadcasts.

---

## 13. Troubleshooting

### "WhatsApp Disconnected" banner in inbox

Your linked device session dropped. Go to **Settings → WhatsApp Config → Reconnect** and re-scan the QR code.

### Messages not appearing in inbox

1. Check the connected status in Settings.
2. Click the **Refresh** button (↺) in the conversation thread header.
3. If still missing, check with your admin that the baileys-service process is running.

### Message shows "Failed" status

Hover the red ✗ icon for the reason. Common causes:
- Phone is off or has no internet
- Number not registered on WhatsApp
- Rate limit hit (try tomorrow)

### Quick reply not appearing when I type `/`

- Make sure quick replies exist in **Settings → Quick Replies**.
- The shortcut must start with `/` — if you saved it without a slash, edit it.

### Contact shows as "Opted Out" but they want to receive messages

An admin can manually re-enable opt-in on the contact's record.

### Group messages not appearing

Groups only sync when a message arrives. If you were added to a new group, send a test message to that group — it will appear in the inbox.

---

*Last updated: Phase 6 — Baileys-based WhatsApp Team Inbox*

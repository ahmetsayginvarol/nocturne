# Nocturne — Eclipse Restaurant Floor Management

**Ship:** Sun Princess · Princess Cruises  
**Restaurant:** Eclipse (Deck 7)  
**App type:** iPad web app (single-page, no framework)

---

## Overview

Nocturne is a real-time floor management tool for Eclipse restaurant. Multiple tablets run the same app simultaneously; all state is synced through Firebase Realtime Database so every device sees the same floor at all times.

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | Main app — all logic, UI, and styles in one file |
| `report.html` | Analytics/reporting module (shift summaries, covers, Chef's Table, etc.) |
| `monitor.html` | Read-only monitor view (display screen / host stand) |
| `role.html` | Role/station assignment screen |
| `waiter.html` | Waiter-facing simplified view |
| `worker.js` | Service worker for offline caching |
| `logo.mp4` | Animated logo shown on splash screen |
| `logo.jpg` / `logo.png` | Static logo assets |
| `map.jpg` / `map_dark.jpg` | Floor plan background images |
| `pcl_logo.jpg` | Princess Cruises logo |

---

## Firebase Structure

**Database root:** `eclipse/deck7/`

| Path | Description |
|------|-------------|
| `floor/tables/{id}` | Live table states (occupied, blocked, covers, staterooms, etc.) |
| `floor/splits` | Split-table overrides |
| `floor/positions` | Custom drag-repositioned table coordinates |
| `softBlocks/{groupId}` | Hold-for-later reservation groups |
| `broadcasts` | Cross-device toast messages and alerts |
| `resets` | Table-reset events |
| `seatings` | Seating events |
| `presence/{deviceId}` | Active device registry (for @mentions) |
| `sessionLog` | Per-session activity log |
| `archive/{date}` | End-of-service snapshots |
| `chefsTable` | Chef's Table reservation list |
| `meta/lastFullReset` | Timestamp of last full floor reset |
| `meta/prevReservations` | Soft-block groups saved at end-of-service for next day reminder |

---

## Table States

Each table object in `state.tables[id]` can hold:

```
occupied      boolean   — table is currently seated
blocked       boolean   — hard-blocked (unavailable)
seating       number    — turn number (1st seating, 2nd, etc.)
covers        number    — guest count
seatedAt      timestamp
seatedBy      deviceId
staterooms    string[]  — guest stateroom numbers
sharing       boolean   — sharing mode (multiple parties at same table)
holdGroupId   string    — if part of a soft-block reservation group
blockedBy     deviceId
blockedAt     timestamp
blockReason   string
```

---

## Reservation / Hold-For-Later System (Soft Blocks)

Reservations are created as **soft-block groups** stored in Firebase under `softBlocks/{groupId}`. Each group contains:
- `tableIds` — which tables are reserved
- `targetTime` — Unix timestamp of the reservation time
- `note` — label (e.g. guest name or event)
- `createdBy` — `DEVICE_ID` of the creating tablet
- `resetDone` — per-table map of `{tableId: true}` once hard-blocked or seated

### Tick thresholds (`_softBlockWarningTick`, runs every 30s)

| Time until reservation | Action |
|------------------------|--------|
| ≤ 45 min | Visual soft-block on markers; toast + broadcast alert (owner device only) |
| ≤ 10 min | **Auto hard-block** all available (non-occupied) tables in the group. Any active device can execute the write — `resetDone` flags in Firebase prevent duplicate ops. Toasts/broadcasts sent by owner device only. |
| ≤ 0 min (overdue) | Overdue modal shown (owner device) |
| ≤ −20 min | Cancel-and-release modal shown (owner device) |

**Key design:** Hard-block writes (`≤ 10 min`) run on **any** active tablet, not just the creator. This ensures blocks fire even if the creating tablet goes offline. Deduplication is via `resetDone` flags synced through Firebase.

---

## Previous-Reservation Reminder

At end of service, `_savePrevServiceReservations()` is called inside `doResetAll()`. It saves all active soft-block groups to `meta/prevReservations`.

The next day, `_prevReservationCheck()` polls every 60s. Between **4:45 PM and 5:10 PM** it checks whether yesterday's reservations were saved and prompts the creator to re-mark the same tables.

The reminder fires once per device per calendar day (tracked in `localStorage` key `eclipse_prev_res_check`).

---

## Chef's Table Module

Produces a ZIP download containing per-guest PDFs:
- **Invitation letter** — 1″–7.5″ wide, 0.5″–10″ tall; date left-aligned two lines above stateroom; folio charge line included; body 11pt, title 15pt
- **Fold cards** — text area 5″–7.25″; 9pt font; includes formal attire line + folio charge
- **Envelopes** — 9.5″ × 4.13″ landscape; stateroom (18pt bold) at ~1.25″, 1.0″; name 3 lines below; Helvetica

---

## Splash Screen

On app load, `logo.mp4` plays as the splash logo. Features:
- CSS box-shadow star field (70 stars, GPU-animated brightness)
- Dual glow rings (radial gradient + rotating ring)
- Pentatonic melody via Web Audio API (primed on first user gesture to satisfy browser autoplay policy)
- Dot wave intro: table dots animate in with staggered `hue-rotate` for rainbow cycling
- Stars persist after splash dismissal and fade out slowly after the dot wave completes (~1.5s fade)

---

## Key Global State

```javascript
state.tables      // { [tableId]: tableStateObject }
state.softBlocks  // { [groupId]: softBlockGroup }
state.splits      // { [parentId]: splitConfig }
state.positions   // { [tableId]: {x, y} }
```

All state is rebuilt from Firebase on connect and kept in sync via real-time listeners.

---

## Commit / Push Notes

- Branch for active development: `claude/elegant-mccarthy-ef127m`
- Production branch: `main`
- Git user must be set to `noreply@anthropic.com` / `Claude` for verified commits
- Push to main: `git push origin <branch>:main --force-with-lease`

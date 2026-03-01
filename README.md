# CampusSpot

**A Real-Time Coordination Engine for Shared Campus Resources**

🔗 **Live Demo:** https://campus-spot-five.vercel.app/

---

Booking a basketball court sounds simple. It isn't — not when three people try to claim the same slot at the same time, no-shows leave courts locked for an hour, and your availability screen is already 30 seconds stale.

CampusSpot is not a booking form with a calendar. It's a coordination engine. It enforces time-bound ownership of scarce resources under real concurrency, applies role-based booking policies, automates lifecycle cleanup, and keeps every connected client in sync — in real time, without polling.

---

## The Problem

On a mid-sized campus, shared facilities — libraries, basketball courts, cricket grounds, auditoriums — break down under real usage:

- Students act on outdated availability data
- Two users attempt to claim the same slot simultaneously
- Facilities appear occupied because of no-shows
- Clubs need different booking privileges than individuals
- Time boundaries are loosely enforced or ignored entirely
- Future reservations get conflated with live occupancy

The root issue isn't a missing feature. It's that most booking tools are CRUD apps pretending to be coordination systems. They don't enforce anything — they just record intent.

CampusSpot enforces it.

---

## How It Works

At its core, CampusSpot is a state machine. Bookings aren't created and deleted — they move through enforced transitions:

```
scheduled → checked_in → completed
scheduled → released          (no-show or cancellation)
```

Every booking is a time-bound ownership claim. The database — not the frontend, not the API layer — is the source of truth. Conflicts are caught inside transactions with row-level locks, not by checking a cached value and hoping nobody else did the same thing 50ms ago.

**Key behaviors:**

- All booking times snap to strict 30-minute boundaries — no 4:12 PM slots, ever
- Pooled resources (library) and unit-based resources (individual courts) are handled by a single schema
- No-shows are automatically released 15 minutes after the booking start time
- Every state change broadcasts to all connected clients via WebSocket — no refresh needed
- Double submissions are blocked at the database level with conditional unique indexes

---

## Architecture

```
Controller → Service → Database
```

- **Frontend:** React + Vite + Tailwind CSS
- **Backend:** Node.js + Express
- **Database:** PostgreSQL (ACID transactions, row-level locking, partial indexes)
- **Real-Time:** Socket.io (event-driven, no polling)
- **Lifecycle Worker:** node-cron (no-show cleanup, session expiry)

The layering is deliberate. Controllers parse HTTP. Services own business logic and transaction boundaries. The database enforces correctness. The socket layer propagates state. The cron worker handles time-based cleanup that can't be triggered by user action.

---

## Database Design

This is where the coordination guarantees actually live. The schema isn't passive storage — it enforces correctness, lifecycle control, and performance boundaries.

### Core Tables

Three tables carry the entire model:

```
facilities        → what exists and what the rules are
facility_units    → the individual bookable sub-units
bookings          → time-bound ownership claims
```

---

### facilities

```sql
CREATE TABLE facilities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT,

  total_capacity INTEGER DEFAULT 1,
  is_pooled BOOLEAN DEFAULT FALSE,

  min_duration_minutes INTEGER DEFAULT 30,
  max_duration_minutes INTEGER DEFAULT 120,
  open_time TIME DEFAULT '07:00:00',
  close_time TIME DEFAULT '23:00:00',

  timezone VARCHAR(50) DEFAULT 'UTC',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

A facility defines a resource category — Main Library, Basketball Courts, Cricket Ground, Auditorium. Crucially, this table encodes _policy_, not bookings. Duration limits, operating hours, capacity — all centralized here at the data layer, not scattered across frontend validation.

**Two coordination modes via `is_pooled`:**

_Pooled_ (e.g. Library — `is_pooled = true`, `total_capacity = 100`):
No unit selection. Availability is simply `total_capacity − active bookings`.

_Unit-Based_ (e.g. Basketball Courts — `is_pooled = false`, `total_capacity = 3`):
Delegates to `facility_units`. Each court is a lockable row.

This keeps pooled resources simple while still allowing granular locking for unit-based ones.

---

### facility_units

```sql
CREATE TABLE facility_units (
  id SERIAL PRIMARY KEY,
  facility_id INTEGER REFERENCES facilities(id) ON DELETE CASCADE,
  unit_name VARCHAR(50) NOT NULL,
  is_operational BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

Represents individual sub-units — Court A, Court B, Court C. One facility maps to many units, one unit to many bookings over time. `ON DELETE CASCADE` keeps referential integrity clean if a facility is removed.

---

### bookings

```sql
CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  facility_id INTEGER REFERENCES facilities(id) NOT NULL,
  unit_id INTEGER REFERENCES facility_units(id),       -- NULL for pooled resources

  booked_by VARCHAR(100) NOT NULL,
  user_type VARCHAR(20) CHECK (user_type IN ('individual', 'club')) DEFAULT 'individual',
  club_name VARCHAR(100),

  booking_type VARCHAR(20) CHECK (booking_type IN ('time_based', 'full_day')) DEFAULT 'time_based',

  starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ends_at TIMESTAMP WITH TIME ZONE NOT NULL,

  status VARCHAR(20) DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'checked_in', 'completed', 'released')),

  idempotency_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

Each row is a claim. A few decisions worth calling out:

**`unit_id` is nullable** — for pooled facilities, there's no unit to reference. The same schema handles both models cleanly without branching into separate tables.

**Explicit `status` field instead of deletion** — rows are never deleted. They transition. This preserves history, enables partial indexing on active-only state, enables lifecycle automation, and avoids race conditions that can occur when two transactions try to delete the same row.

**`full_day` booking type** — restricted to club users. Overrides time slots for the entire date.

**`idempotency_key`** — prevents duplicate submissions. Double-clicking Reserve won't create two active bookings. The uniqueness is enforced at the database level (see indexes below), not just in application code.

---

### Indexing

Partial indexes are the key to keeping conflict detection fast as data grows — historical bookings are excluded entirely.

```sql
-- Overlap checks for a specific user
CREATE INDEX idx_user_active_slots
ON bookings (booked_by, starts_at, ends_at)
WHERE status IN ('scheduled', 'checked_in');

-- Facility-level conflict detection and schedule queries
CREATE INDEX idx_active_bookings_facility
ON bookings (facility_id, starts_at, ends_at)
WHERE status IN ('scheduled', 'checked_in');

-- No-show cleanup without scanning full history
CREATE INDEX idx_cleanup_engine_optimized
ON bookings (starts_at, status, ends_at);

-- Idempotency: unique only among active bookings
CREATE UNIQUE INDEX unique_active_idempotency
ON bookings(idempotency_key)
WHERE status IN ('scheduled', 'checked_in');

-- Fast upcoming session queries for the dashboard
CREATE INDEX idx_booking_ends_at_ordering
ON bookings (facility_id, ends_at)
WHERE status IN ('scheduled', 'checked_in');
```

---

### Concurrency Control

Every booking runs inside a transaction with row-level locking:

```sql
BEGIN
SELECT ... FOR UPDATE   -- locks the relevant unit row
-- check for overlapping active bookings
-- validate role, booking window, duration
INSERT INTO bookings ...
COMMIT
```

If two users try to claim Court A at 4:00 PM simultaneously, the first transaction locks the row. The second waits. When the first commits, the second runs its overlap check — finds a conflict — and returns a 409. Double booking is not a race condition to handle gracefully; it's mathematically prevented.

---

## Time & Capacity Model

**30-minute slot enforcement**

All start times must land on a 30-minute boundary. `4:00 PM` is valid. `4:12 PM` is not. At `3:45 PM`, the earliest bookable slot is `4:00 PM`, not `3:50`.

This makes overlap detection deterministic — no fuzzy boundary cases, no partial-slot conflicts.

**Live occupancy vs. future reservations**

These are kept strictly separate. A booking scheduled for `5:00 PM` does not count toward current occupancy at `4:00 PM`.

```
3 Basketball Courts — at 3:58 PM:
→ 0 / 3 occupied (no active sessions)

At exactly 4:00 PM (two courts booked):
→ 2 / 3 occupied
```

Capacity shown to users always reflects what's happening right now, not what's coming up.

---

## Booking Flow (End-to-End)

**Example: Booking Court A at 4:00 PM**

1. User selects `4:00 PM` — frontend enforces 30-minute boundary alignment
2. Frontend validates duration against facility min/max, checks operating hours
3. `POST /api/reserve` is called
4. Backend opens a transaction, locks the unit row, checks for overlaps, validates role and booking window, inserts the booking, commits
5. `assets:updated` is emitted via WebSocket
6. Every connected client refreshes availability instantly

At `4:00 PM`, the session becomes active. At `4:15 PM`, if the user hasn't checked in, the booking is automatically released and the court becomes available again.

---

## API Reference

| Method | Endpoint                       | Description                                         |
| ------ | ------------------------------ | --------------------------------------------------- |
| `GET`  | `/api/assets`                  | All facilities with live capacity and occupancy     |
| `GET`  | `/api/facilities/:id/units`    | Operational units for a facility                    |
| `GET`  | `/api/facilities/:id/schedule` | 30-minute slot grid per unit                        |
| `POST` | `/api/reserve`                 | Create a booking (transactional, idempotent)        |
| `POST` | `/api/check-in`                | Transition: `scheduled → checked_in`                |
| `POST` | `/api/check-out`               | Transition: `checked_in → completed`                |
| `POST` | `/api/cancel`                  | Transition: `scheduled → released` (pre-start only) |
| `GET`  | `/api/bookings/user/:name`     | Active and upcoming bookings for a user             |
| `GET`  | `/api/system/health`           | Service status and last cleanup timestamp           |
| `POST` | `/api/system/seed`             | Reset and populate demo data                        |

---

## Frontend Components

| Component            | Role                                                          |
| -------------------- | ------------------------------------------------------------- |
| `OnboardingFlow.jsx` | Identity capture — Individual or Club                         |
| `FacilityCard.jsx`   | Live capacity bar, occupancy, sync state                      |
| `ScheduleModal.jsx`  | 30-minute slot grid per unit                                  |
| `PolicyModal.jsx`    | Booking form — unit selection, full-day toggle, validation    |
| `BookingList.jsx`    | User dashboard — active bookings, check-in, check-out, cancel |
| `StatusPill.jsx`     | Standardized status display                                   |
| `useLiveUpdates`     | WebSocket hook listening for `assets:updated`                 |

---

## Lifecycle Automation

A cron job runs every minute and handles two things:

- **No-show release** — any `scheduled` booking whose start time passed more than 15 minutes ago is transitioned to `released`
- **Session expiry** — any `checked_in` booking past its `ends_at` is transitioned to `completed`

These transitions free capacity immediately and are reflected in real time across all connected clients.

---

## Local Setup

**1. Clone and install dependencies** for both `backend/` and `frontend/`.

**2. Backend `.env`**

```env
PORT=5000
NODE_ENV=development
DATABASE_URL=your_postgres_connection_string
FRONTEND_URL=http://localhost:3000
```

**3. Frontend `.env`**

```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

**4. Seed the database**

```bash
POST http://localhost:5000/api/system/seed
```

**Production seed:**

```powershell
Invoke-WebRequest -Uri "https://campusspot-0dxf.onrender.com/api/system/seed" -Method POST
```

---

## Testing Scenarios

These aren't just smoke tests — each one targets a specific coordination guarantee. Run them in order if you want to understand how the system actually behaves under the rules it enforces.

---

**1. Real-Time Sync (Parallel Browser Test)**

Open the app in a normal window and an incognito window simultaneously — two separate users. Make a booking in one. Watch the other update without a refresh. This is the WebSocket layer doing its job. Any state change — booking, check-in, check-out, release — propagates to every connected client instantly.

---

**2. Concurrency — Same Unit, Same Time**

In both windows, try to book the same court (e.g. Court A) at the same time. One request will win the row lock and succeed. The other will wait, run its overlap check after the first commits, and receive a `409 Conflict`. Both windows will reflect the updated state in real time. This is the core guarantee — double booking is impossible by design, not by luck.

---

**3. Capacity Separation — Live vs. Scheduled**

Book Court A and Court B for 4:00 PM (two separate users, two separate windows). Before 4:00 PM, the capacity display should still show `0 / 3 occupied` — scheduled bookings do not count as live occupancy. At exactly 4:00 PM, it should jump to `2 / 3 occupied`. This distinction is intentional: what's _reserved_ is not the same as what's _in use_.

---

**4. Time Boundary Enforcement**

At 3:45 PM, open the booking modal for any unit-based facility. The slot `3:50 PM` should not be selectable. Only `4:00 PM` and `4:30 PM` should appear as valid next options. All times snap to 30-minute boundaries — the system doesn't let you book a slot that's already partially elapsed.

---

**5. Duration Limits**

Try booking a session shorter than 30 minutes or longer than 120 minutes. Both should be rejected at the frontend before the request is even sent. The constraints come from the `facilities` table (`min_duration_minutes`, `max_duration_minutes`), not hardcoded UI rules.

---

**6. Booking Window — How Far Ahead Can You Book?**

The advance booking window differs by role:

- **Individual users** can book up to **7 days ahead** for time-based slots
- **Club users** can book full-day slots up to **30 days ahead**, but with a condition — the full-day booking must be made **before midnight (12:00 AM) of the target date**. Trying to book a full-day slot for today after midnight should be rejected.

Try both from the respective user types and verify the date picker enforces the correct range.

---

**7. Schedule View — Unit-Level Visibility**

Basketball Courts, Cricket Ground, and Auditorium all have a **Schedule** button on their facility card. Clicking it opens a 7-day slot grid per unit — Court A, Court B, Court C for basketball; similar for cricket and auditorium. This gives a bird's-eye view of what's booked, what's free, and when, across all individual units of that facility. Libraries don't have this — they're pooled resources with no concept of individual units.

---

**8. Auditorium — Club-Only Access**

The Auditorium is restricted to club bookings only.
If you are logged in as an individual user, the Auditorium will not appear in the list of available facilities. Only users with a club role can see and book it.
This is a role-based access rule enforced at the backend — it is not merely hidden in the UI.

---

**9. No Early Check-In (My Booking)**

Try checking in to a booking before its start time. The check-in button should be inactive or the request should be rejected. Check-in only becomes available at the exact scheduled start time.

---

**10. No-Show Auto-Release**

Make a booking and don't check in. After 15 minutes past the start time, the cron worker will transition the booking from `scheduled` to `released`. The slot will free up, capacity will update, and connected clients will reflect the change — all automatically, with no user action required.

---

**11. Early Check-Out (My Booking)**

Check in to an active session and then check out before the scheduled end time. The unit should become available immediately — capacity updates in real time and the slot opens up for new bookings. You don't have to wait for the session's `ends_at` to pass.

---

**12. Cancellation (My Booking)**

If you have a scheduled booking that has not yet started, you can cancel it from My Bookings. Once cancelled, the booking status changes to released, and the unit becomes available immediately.
Capacity updates in real time, and the time slot opens up for other users to reserve.
You do not need to wait for the starts_at time — cancellation frees the resource instantly.

---

**13. Idempotency — Double Submit**

On the booking form, click Reserve twice rapidly (or disable the button logic temporarily and submit twice). Only one active booking should be created. The `idempotency_key` unique index ensures the second insert fails silently at the database level — not caught by application logic, prevented by the schema itself.

---

## Design Decisions & Trade-offs

**What's in scope:** strict coordination integrity under real concurrency, correct lifecycle automation, real-time state synchronization.

**What's intentionally out of scope for now:**

- OAuth / real identity — identity is self-declared (simplified for demo)
- Horizontal scaling — Socket.io runs on a single instance; a Redis adapter would be needed for multi-node
- Rate limiting
- Audit logs and admin analytics
- Multi-timezone support

The system assumes PostgreSQL ACID guarantees and a single WebSocket server instance. These are reasonable constraints for campus-scale deployments and keep the architecture straightforward.

---

> CampusSpot formalizes shared resource coordination under concurrent access — deterministically, transparently, and reliably.

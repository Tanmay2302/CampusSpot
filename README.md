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
Controller → Service → Repository → Database
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

These are worth running to see the coordination guarantees in action:

**Concurrency** — Open two browser windows (normal + incognito). Attempt to book the same court at the same time. One succeeds; the other gets a 409. Both windows update in real time.

**Capacity separation** — Book Court A and Court B simultaneously for 4:00 PM. At exactly 4:00, occupancy jumps from 0/3 to 2/3. Verify that the reservations before 4:00 don't affect the displayed count.

**Time boundaries** — At 3:45 PM, confirm that 3:50 PM is not bookable. Only 4:00 and 4:30 should be selectable.

**No-show cleanup** — Make a booking, don't check in. Confirm the slot is released and capacity restored after 15 minutes.

**Idempotency** — Double-click Reserve rapidly. Confirm only one booking is created.

**Full-day bookings** — Log in as a Club user. Verify the full-day option appears and blocks out the date for other bookings.

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

<!-- # CampusSpot

**A Real-Time Coordination Engine for Shared Campus Resources**

**Live Application**
https://campus-spot-five.vercel.app/

---

## 1. Problem Statement

On a mid-sized college campus, shared facilities such as libraries, basketball courts, cricket grounds, and auditoriums depend on multiple people coordinating access in real time.

In practice, coordination breaks down because:

- Students act on outdated availability
- Two users attempt to book the same unit simultaneously
- Facilities appear occupied due to no-shows
- Clubs require different booking privileges
- Time boundaries are not strictly enforced
- Future reservations are confused with live occupancy

The problem is not booking.

It is enforcing time-bound ownership of scarce resources under concurrency, policy constraints, and real-time visibility requirements.

---

## 2. Solution

CampusSpot is a deterministic coordination system that:

- Enforces atomic booking transactions
- Normalizes time into strict 30-minute slots
- Prevents overlapping bookings
- Supports pooled and unit-based facilities
- Applies role-based booking privileges
- Automatically releases no-shows
- Synchronizes live availability across connected users
- Avoided race conditions dues to transactions

This system behaves as a state machine with enforced transitions, not a CRUD reservation form.

---

## 3. System Design Principles

### 3.1 Database as Source of Truth

All conflict detection and concurrency control are enforced through PostgreSQL transactions and row-level locking (FOR UPDATE).

### 3.2 Deterministic State Transitions

Bookings move strictly:

```
scheduled → checked_in → completed
```

or

```
scheduled → released
```

No arbitrary mutation. No silent overwrites.

### 3.3 Time Normalization

All bookings snap to 30-minute boundaries to ensure deterministic overlap detection.

### 3.4 Active-State Indexing

Only active bookings (scheduled, checked_in) are indexed for performance and scalability.

### 3.5 Event-Driven Synchronization

Availability updates propagate via WebSocket broadcasts.
No polling.

---

## 4. High-Level Architecture

- **Frontend:** React + Vite
- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **Real-Time Layer:** Socket.io
- **Lifecycle Worker:** node-cron

**Pattern:**

```
Controller → Service → Repository → Database
```

- Controllers parse HTTP
- Services enforce policies and transactions
- Database enforces integrity
- Socket layer synchronizes global state
- Cron automates lifecycle transitions

---

## 5. End-to-End Booking Flow

**Example: Booking Court A at 4:00 PM**

1. User selects 4:00 PM (must align to 30-minute boundary)
2. Frontend validates duration and operating hours
3. `POST /api/reserve` is called
4. Backend:
   - `BEGIN` transaction
   - Lock relevant rows
   - Check overlap via indexed queries
   - Validate role and booking window
   - Insert booking
   - `COMMIT` transaction
5. Emit `assets:updated`
6. All connected clients refresh.

At exactly 4:00 PM:

- Occupancy becomes active
- Capacity updates live

---

## 6. Technology Stack

### Frontend

- React
- Vite
- Tailwind CSS
- Axios
- Socket.io-client

### Backend

- Node.js
- Express
- PostgreSQL
- node-cron
- Socket.io

### Persistence

- Raw SQL schema
- Partial indexes for active-state optimization

---

## 7. Database Schema & Data Modeling Strategy

CampusSpot's coordination guarantees are rooted in its schema design.

The database is not passive storage.
It enforces correctness, lifecycle control, and performance boundaries.

**Core tables:**

- `facilities`
- `facility_units`
- `bookings`

These represent:

- Static resource definitions
- Operational sub-units
- Dynamic time-bound ownership claims

### 7.1 facilities Table

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

**Purpose**

Defines a bookable resource category.

Examples:

- Main Library
- Basketball Courts
- Cricket Ground
- Auditorium

This table encodes policy and capacity rules, not bookings.

**Modeling Decisions**

**A. total_capacity + is_pooled**

Two coordination modes:

_Pooled Resource_

- Example: Library
- `is_pooled = true`
- `total_capacity = 100`
- No unit selection
- Availability = total_capacity − active bookings

_Unit-Based Resource_

- Example: Basketball Courts
- `is_pooled = false`
- `total_capacity = 3`
- Uses facility_units

This avoids overcomplicating pooled resources while still allowing granular unit locking.

**B. Policy at Data Layer**

Fields like:

- `min_duration_minutes`
- `max_duration_minutes`
- `open_time`
- `close_time`
- `timezone`

Are not UI-level decisions.
They centralize business constraints in data.

### 7.2 facility_units Table

```sql
CREATE TABLE facility_units (
  id SERIAL PRIMARY KEY,
  facility_id INTEGER REFERENCES facilities(id) ON DELETE CASCADE,
  unit_name VARCHAR(50) NOT NULL,
  is_operational BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

Represents operational sub-units for non-pooled facilities.

Example:

Basketball Courts:

- Court A
- Court B
- Court C

One facility → Many units
One unit → Many bookings

`ON DELETE CASCADE` preserves relational integrity.

**Why unit_id is Nullable in bookings**

For pooled resources:

- `unit_id = NULL`
- Capacity computed globally

For unit-based:

- `unit_id` required
- Specific row locked in transaction

One schema supports both models cleanly.

### 7.3 bookings Table

```sql
CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  facility_id INTEGER REFERENCES facilities(id) NOT NULL,
  unit_id INTEGER REFERENCES facility_units(id),

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

Each row is a time-bound ownership claim.

**Important Modeling Decisions**

_Explicit Status Field_

Instead of deleting rows, we transition state.

This:

- Preserves history
- Enables lifecycle automation
- Enables partial indexing
- Prevents race-condition deletion issues

_booking_type_

- `time_based`
- `full_day`

Full-day bookings are restricted to club users and override time slots for that date.

_idempotency_key_

Prevents duplicate submissions.
Double-clicking reserve will not create duplicate active bookings.

---

## 8. Indexing Strategy

**Active User Overlap**

```sql
CREATE INDEX idx_user_active_slots
ON bookings (booked_by, starts_at, ends_at)
WHERE status IN ('scheduled', 'checked_in');
```

History is excluded.
Overlap checks stay fast even with large data growth.

**Facility Conflict Detection**

```sql
CREATE INDEX idx_active_bookings_facility
ON bookings (facility_id, starts_at, ends_at)
WHERE status IN ('scheduled', 'checked_in');
```

Used for:

- Same-unit overlap detection
- Facility-wide conflicts
- Schedule generation

**Cleanup Optimization**

```sql
CREATE INDEX idx_cleanup_engine_optimized
ON bookings (starts_at, status, ends_at);
```

Supports no-show cleanup without scanning full history.

**Unique Active Idempotency**

```sql
CREATE UNIQUE INDEX unique_active_idempotency
ON bookings(idempotency_key)
WHERE status IN ('scheduled', 'checked_in');
```

Active uniqueness only.
Historical rows may reuse keys.

**Dashboard Optimization**

```sql
CREATE INDEX idx_booking_ends_at_ordering
ON bookings (facility_id, ends_at)
WHERE status IN ('scheduled', 'checked_in');
```

Supports fast upcoming session queries.

---

## 9. Transaction Strategy

Every booking runs inside a transaction.

```sql
BEGIN
SELECT ... FOR UPDATE
Validate overlap
Insert booking
COMMIT
```

If two users attempt same unit at 4:00 PM:

- First locks row
- Second waits
- After commit, second fails overlap check

Double booking is mathematically impossible.

---

## 10. Time & Capacity Model

**30-Minute Enforcement**

Valid:

- 4:00 PM – 4:30 PM
- 4:30 PM – 5:00 PM

Invalid:

- 4:12 PM – 4:47 PM

At 3:45 PM:

- Can book 4:00 or 4:30
- Cannot book 3:50

**Capacity Logic**

_Pooled Example_

```
Library
Availability = total_capacity − active sessions
```

_Unit-Based Example_

```
3 Basketball Courts

User A → Court A at 4:00
User B → Court B at 4:00

Before 4:00
0 / 3 occupied

At exactly 4:00
2 / 3 occupied
```

Future reservations do NOT count toward live occupancy.

---

## 11. API Endpoints

**`GET /api/assets`**

Returns:

- All facilities
- Live capacity
- Current occupants
- User active booking indicator

Backend computes live occupancy.

**`GET /api/facilities/:id/units`**

Returns operational units.

**`GET /api/facilities/:id/schedule`**

Returns 30-minute grid per unit.

**`POST /api/reserve`**

Creates booking with:

- Time snapping
- Duration validation
- Role enforcement
- Transactional overlap detection
- WebSocket broadcast

**`POST /api/check-in`**

Transition: `scheduled → checked_in`
Only at start time.

**`POST /api/check-out`**

Transition: `checked_in → completed`

**`POST /api/cancel`**

Transition: `scheduled → released`
Only before start time.

**`GET /api/bookings/user/:name`**

Returns active and upcoming bookings.

**`GET /api/system/health`**

Service status + last cleanup timestamp.

**`POST /api/system/seed`**

Resets and populates demo facilities.

---

## 12. Frontend Architecture

**OnboardingFlow.jsx**

Captures identity (Individual / Club).

**FacilityCard.jsx**

Displays:

- Capacity bar
- Live occupancy
- Sync indicators

**ScheduleModal.jsx**

Renders 30-minute grid per unit.

**PolicyModal.jsx**

Handles:

- Booking form
- Unit selection
- Full-day toggle
- Validation

**BookingList.jsx**

Dashboard with:

- Active bookings
- Check-in
- Check-out
- Cancel

**StatusPill.jsx**

Standardizes UI states.

**useLiveUpdates Hook**

Listens for `assets:updated`.

---

## 13. Lifecycle Automation

Every minute:

- Release no-shows after 15 minutes
- Mark expired sessions completed

Example:

```
Booking at 4:00
4:00 → check-in enabled
4:15 → auto-release if not checked in
```

Early check-out frees capacity instantly.

---

## 14. Testing Guide

**Parallel Browser Test**

Open normal + incognito.
Observe real-time sync.

**Same Time, Different Unit**

Court A and Court B at 4:00 PM.
Capacity:

```
0/3 → 2/3 exactly at 4:00 PM.
```

**Same Unit Conflict**

Second user receives 409.

**Time Boundary Test**

At 3:45 PM:

- Can book 4:00 or 4:30.
- Cannot book 3:50.

**Min/Max Duration**

- 30 min minimum.
- 120 min maximum.

**Booking Window**

- Individual: 7 days.
- Club full-day: 30 days.

**No Early Check-In**

Only at start time.

**No-Show**

Released after 15 minutes.

**Early Check-Out**

Frees resource instantly.

**View Schedule**

Unit-level visibility for:

- Basketball
- Cricket
- Auditorium

---

## 15. Assumptions

- Simplified identity selection
- Single timezone
- PostgreSQL ACID guarantees
- Single WebSocket instance
- Moderate campus scale

---

## 16. Trade-offs

Not implemented:

- OAuth
- Horizontal scaling (Redis adapter)
- Rate limiting
- Audit logs
- Admin analytics

Focus: strict coordination integrity.

---

## 17. Local Setup

**Backend `.env`**

```
PORT=5000
NODE_ENV=development
DATABASE_URL=your_postgres_connection_string
FRONTEND_URL=http://localhost:3000
```

**Frontend `.env`**

```
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

**Seed locally:**

```
POST http://localhost:5000/api/system/seed
```

---

## 18. Production Seeding

```powershell
Invoke-WebRequest -Uri "https://campusspot-0dxf.onrender.com/api/system/seed" -Method POST
```

---

## Final Note

CampusSpot is not a CRUD booking app.

It is a live coordination engine that:

- Enforces temporal ownership
- Prevents race conditions
- Separates future reservations from live occupancy
- Automates lifecycle correction
- Synchronizes state across users in real time

It formalizes shared resource coordination under concurrent access — deterministically, transparently, and reliably. -->

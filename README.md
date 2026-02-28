# CampusSpot

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

It formalizes shared resource coordination under concurrent access — deterministically, transparently, and reliably.

DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS facility_units;
DROP TABLE IF EXISTS facilities;

-- Facilities
CREATE TABLE facilities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    
    -- Capacity Management
    total_capacity INTEGER DEFAULT 1,
    is_pooled BOOLEAN DEFAULT FALSE,
    
    -- Policy Rules
    min_duration_minutes INTEGER DEFAULT 30,
    max_duration_minutes INTEGER DEFAULT 120,
    open_time TIME DEFAULT '07:00:00',
    close_time TIME DEFAULT '23:00:00',
    
    -- Used for operating hour validation
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Facility units (for non-pooled resources)
CREATE TABLE facility_units (
    id SERIAL PRIMARY KEY,
    facility_id INTEGER REFERENCES facilities(id) ON DELETE CASCADE,
    unit_name VARCHAR(50) NOT NULL,
    is_operational BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bookings
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

-- Indexes

-- Speeds up overlapping booking checks per user
CREATE INDEX idx_user_active_slots 
ON bookings (booked_by, starts_at, ends_at) 
WHERE status IN ('scheduled', 'checked_in');

-- Supports facility-level availability checks
CREATE INDEX idx_active_bookings_facility 
ON bookings (facility_id, starts_at, ends_at) 
WHERE status IN ('scheduled', 'checked_in');

-- Used by cleanup job for expired bookings
CREATE INDEX idx_cleanup_engine_optimized 
ON bookings (starts_at, status, ends_at);

-- Prevents duplicate active bookings via idempotency key
CREATE UNIQUE INDEX unique_active_idempotency
ON bookings(idempotency_key)
WHERE status IN ('scheduled', 'checked_in');

-- Supports upcoming bookings query for dashboard 
CREATE INDEX idx_booking_ends_at_ordering 
ON bookings (facility_id, ends_at) 
WHERE status IN ('scheduled', 'checked_in');
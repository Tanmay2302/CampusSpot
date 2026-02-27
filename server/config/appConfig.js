export const BOOKING_POLICY = {
  // Slot alignment interval
  SLOT_SIZE_MINUTES: 30,

  // Grace period for check-in after scheduled start time
  NO_SHOW_GRACE_MINUTES: 15,

  // Maximum advance booking window
  MAX_BOOKING_HORIZON_DAYS: 7,

  // Minimum booking duration
  MIN_SESSION_MINUTES: 30,
};

export const FACILITY_STATUS = {
  AVAILABLE: "available",
  IN_USE: "in_use",
};

export const BOOKING_STATUS = {
  SCHEDULED: "scheduled", // Awaiting check-in
  CHECKED_IN: "checked_in", // Currently active
  COMPLETED: "completed", // Finished session or early check-out
  RELEASED: "released", // Cancelled or no-show
};

export const SCHEDULER_CONFIG = {
  // Cleanup job frequency

  CLEANUP_CRON_INTERVAL: "* * * * *", // Every minutes

  // Advisory lock key (prevents duplicate cleanup workers)
  CLEANUP_LOCK_ID: 1001,
};

export const USER_TYPES = {
  INDIVIDUAL: "individual",
  CLUB: "club",
};

export const VALID_CLUBS = ["Roobooru", "E-Cell", "Vision", "Tooryanad"];

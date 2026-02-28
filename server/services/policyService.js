import { BOOKING_POLICY } from "../config/appConfig.js";

// Convert "HH:MM[:SS]" to minutes since midnight
const timeStringToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + (minutes || 0);
};

// Format 24h time string into 12h display format.
const formatTime = (timeStr) => {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":");
  const hours = parseInt(h, 10);
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${m} ${suffix}`;
};

export const policyService = {
  snapToSlot(dateStr) {
    const date = new Date(dateStr);
    const minutes = date.getMinutes();
    const snappedMinutes = Math.round(minutes / 30) * 30;
    date.setMinutes(snappedMinutes);
    date.setSeconds(0);
    date.setMilliseconds(0);
    return date;
  },

  validateBookingRequest(facility, startsAt, endsAt, userType) {
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    const now = new Date();

    // Disallow bookings in the past
    if (start < now) {
      throw {
        status: 400,
        message: "Invalid time. You cannot book a slot in the past.",
      };
    }

    // Enforce maximum advance booking window
    const horizonDays =
      userType === "club"
        ? BOOKING_POLICY.CLUB_BOOKING_HORIZON_DAYS
        : BOOKING_POLICY.MAX_BOOKING_HORIZON_DAYS;

    const horizonLimit = new Date();
    horizonLimit.setDate(now.getDate() + (horizonDays || 7));

    if (start > horizonLimit) {
      throw {
        status: 403,
        message: `Advance booking limit exceeded. Max lead time for ${
          userType === "club" ? "clubs" : "individuals"
        } is ${horizonDays} days.`,
      };
    }

    if (end <= start) {
      throw {
        status: 400,
        message: "The end time must be after the start time.",
      };
    }

    // Calculate booking duration
    const durationMinutes = (end - start) / (1000 * 60);

    const isFullDay = durationMinutes >= 480;

    // Ensure booking falls within facility operating hours
    if (facility.open_time && facility.close_time) {
      const openMins = timeStringToMinutes(facility.open_time);
      const closeMins = timeStringToMinutes(facility.close_time);

      const startMins = start.getHours() * 60 + start.getMinutes();
      const endMins = end.getHours() * 60 + end.getMinutes();

      if (!isFullDay && (startMins < openMins || endMins > closeMins)) {
        throw {
          status: 400,
          message: `The facility is closed at your selected time. Operating hours: ${formatTime(
            facility.open_time,
          )} - ${formatTime(facility.close_time)}.`,
        };
      }
    }

    // Full-day bookings have separate rules and are reserved for clubs with timing for full day is 8AM - 9PM
    if (isFullDay) {
      if (userType !== "club") {
        throw {
          status: 403,
          message:
            "Full-day bookings are reserved for registered campus clubs.",
        };
      }
      return { bookingType: "full_day" };
    }

    if (durationMinutes < facility.min_duration_minutes) {
      throw {
        status: 400,
        message: `Your booking is too short. Minimum duration for ${facility.name} is ${facility.min_duration_minutes} minutes.`,
      };
    }

    if (durationMinutes > facility.max_duration_minutes) {
      throw {
        status: 400,
        message: `Your booking is too long. Maximum duration for ${facility.name} is ${
          facility.max_duration_minutes / 60
        } hours.`,
      };
    }

    return { bookingType: "time_based" };
  },

  // Create deterministic key to prevent duplicate submissions
  generateIdempotencyKey(userName, startsAt) {
    const timeCode = new Date(startsAt).getTime();
    return `${userName}_${timeCode}`;
  },

  // Round time up to the next 30-minute boundary
  snapToNextBoundary(date) {
    const snapped = new Date(date);
    const minutes = snapped.getMinutes();
    snapped.setMinutes(Math.ceil((minutes + 1) / 30) * 30);
    snapped.setSeconds(0);
    snapped.setMilliseconds(0);
    return snapped;
  },
};

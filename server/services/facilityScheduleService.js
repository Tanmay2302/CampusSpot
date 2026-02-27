import { pool } from "../db/connection.js";
import { BOOKING_STATUS } from "../config/appConfig.js";

export const facilityScheduleService = {
  /**
   * Returns the structured schedule for a facility on a given date.
   * Units with no bookings are still included.
   */
  async getScheduleForDate(facilityId, date) {
    const baseDate = new Date(date);

    if (isNaN(baseDate.getTime())) {
      throw new Error("Invalid date supplied to schedule service.");
    }

    // Normalize to full-day window
    const startOfDay = new Date(baseDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(baseDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Fetch bookings overlapping this day
    const bookingsQuery = `
      SELECT 
        b.id,
        b.unit_id,
        b.booked_by,
        b.user_type,
        b.club_name,
        b.starts_at,
        b.ends_at,
        b.status,
        b.booking_type,
        u.unit_name
      FROM bookings b
      LEFT JOIN facility_units u ON b.unit_id = u.id
      WHERE b.facility_id = $1
      AND b.status IN ($2, $3)
      AND b.starts_at < $5
      AND b.ends_at > $4
      ORDER BY b.starts_at ASC;
    `;

    const { rows: bookings } = await pool.query(bookingsQuery, [
      facilityId,
      BOOKING_STATUS.SCHEDULED,
      BOOKING_STATUS.CHECKED_IN,
      startOfDay,
      endOfDay,
    ]);

    // Fetch all operational units for structural completeness
    const unitsQuery = `
      SELECT id, unit_name
      FROM facility_units
      WHERE facility_id = $1
      AND is_operational = true
      ORDER BY unit_name ASC;
    `;

    const { rows: units } = await pool.query(unitsQuery, [facilityId]);

    // Group bookings by unit once (avoids repeated filtering)
    const bookingMap = new Map();

    for (const booking of bookings) {
      if (!bookingMap.has(booking.unit_id)) {
        bookingMap.set(booking.unit_id, []);
      }
      bookingMap.get(booking.unit_id).push(booking);
    }

    const schedule = units.map((unit) => ({
      unitId: unit.id,
      unitName: unit.unit_name,
      bookings: bookingMap.get(unit.id) || [],
    }));

    return {
      date: startOfDay.toISOString().split("T")[0],
      units: schedule,
    };
  },
};

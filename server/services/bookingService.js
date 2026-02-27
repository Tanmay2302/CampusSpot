import { pool, runInTransaction } from "../db/connection.js";
import {
  BOOKING_STATUS,
  BOOKING_POLICY,
  VALID_CLUBS,
  USER_TYPES,
} from "../config/appConfig.js";
import { policyService } from "./policyService.js";

export const bookingService = {
  async createBooking(bookingDetails) {
    const {
      facilityId,
      unitId,
      userName,
      userType,
      clubName,
      startsAt,
      endsAt,
    } = bookingDetails;

    const snappedStart = policyService.snapToSlot(startsAt);
    const snappedEnd = policyService.snapToSlot(endsAt);

    const safetyKey = policyService.generateIdempotencyKey(
      userName,
      snappedStart,
    );

    // Run entire booking flow inside a transaction to avoid race conditions

    return await runInTransaction(async (tx) => {
      const facilityQuery = await tx.query(
        // Lock facility row so capacity checks stay consistent during booking

        "SELECT * FROM facilities WHERE id = $1 FOR UPDATE",
        [facilityId],
      );

      const facility = facilityQuery.rows[0];
      if (!facility)
        throw { status: 404, message: "Target facility not found." };

      const { bookingType } = policyService.validateBookingRequest(
        facility,
        snappedStart,
        snappedEnd,
        userType,
      );

      // If this is NOT a full-day booking, ensure no full-day booking exists for that date
      if (bookingType !== "full_day") {
        const startOfDay = new Date(snappedStart);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(startOfDay);
        endOfDay.setHours(23, 59, 59, 999);

        const fullDayConflictQuery = `
  SELECT id
  FROM bookings
  WHERE facility_id = $1
  AND booking_type = 'full_day'
  AND status IN ($2, $3)
  AND starts_at < $5
  AND ends_at > $4
  LIMIT 1
`;

        const fullDayConflict = await tx.query(fullDayConflictQuery, [
          facilityId,
          BOOKING_STATUS.SCHEDULED,
          BOOKING_STATUS.CHECKED_IN,
          startOfDay,
          endOfDay,
        ]);

        if (fullDayConflict.rows.length > 0) {
          throw {
            status: 409,
            message:
              "This facility is reserved for the entire day. No individual slots are available.",
          };
        }
      }

      // Special handling: full-day bookings block the resource for the entire date
      if (bookingType === "full_day") {
        if (userType !== USER_TYPES.CLUB) {
          throw {
            status: 403,
            message:
              "Only registered clubs can reserve a facility for the entire day.",
          };
        }

        const startOfDay = new Date(snappedStart);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(startOfDay);
        endOfDay.setHours(23, 59, 59, 999);

        let conflictQuery;
        let queryParams;

        if (facility.is_pooled) {
          conflictQuery = `
      SELECT booking_type, club_name, starts_at
      FROM bookings
      WHERE facility_id = $1
      AND status IN ($2, $3)
      AND starts_at < $5
      AND ends_at > $4
      LIMIT 1
    `;
          queryParams = [
            facilityId,
            BOOKING_STATUS.SCHEDULED,
            BOOKING_STATUS.CHECKED_IN,
            startOfDay,
            endOfDay,
          ];
        } else {
          conflictQuery = `
      SELECT booking_type, club_name, starts_at
      FROM bookings
      WHERE unit_id = $1
      AND status IN ($2, $3)
      AND starts_at < $5
      AND ends_at > $4
      LIMIT 1
    `;
          queryParams = [
            unitId,
            BOOKING_STATUS.SCHEDULED,
            BOOKING_STATUS.CHECKED_IN,
            startOfDay,
            endOfDay,
          ];
        }

        const existingDayBookings = await tx.query(conflictQuery, queryParams);

        if (existingDayBookings.rows.length > 0) {
          const conflict = existingDayBookings.rows[0];

          if (conflict.booking_type === "full_day") {
            throw {
              status: 409,
              message: `This resource is already reserved for the entire day (${new Date(
                conflict.starts_at,
              ).toLocaleDateString("en-IN")}) by ${conflict.club_name}.`,
            };
          }

          throw {
            status: 409,
            message:
              "There are existing bookings on this day. You cannot reserve it for the entire day.",
          };
        }
      }

      if (userType === USER_TYPES.CLUB) {
        if (!clubName || !VALID_CLUBS.includes(clubName)) {
          throw {
            status: 400,
            message: `Invalid club: ${clubName || "None"}. Please select a registered campus club.`,
          };
        }
      }

      // Prevent user from having overlapping active bookings
      const userOverlapQuery = await tx.query(
        `SELECT id FROM bookings
         WHERE booked_by = $1
         AND status IN ($2, $3)
         AND starts_at < $5 AND ends_at > $4
         LIMIT 1`,
        [
          userName,
          BOOKING_STATUS.SCHEDULED,
          BOOKING_STATUS.CHECKED_IN,
          snappedStart,
          snappedEnd,
        ],
      );

      if (userOverlapQuery.rows.length > 0) {
        throw {
          status: 409,
          message:
            "You already have a reserved or active session during this window.",
        };
      }

      // For pooled facilities, check if total active bookings exceed capacity
      if (facility.is_pooled) {
        const usageQuery = await tx.query(
          `SELECT COUNT(*) as active_slots FROM bookings
           WHERE facility_id = $1
           AND status IN ($2, $3)
           AND starts_at < $5 AND ends_at > $4`,
          [
            facilityId,
            BOOKING_STATUS.SCHEDULED,
            BOOKING_STATUS.CHECKED_IN,
            snappedStart,
            snappedEnd,
          ],
        );

        const activeCount = parseInt(usageQuery.rows[0].active_slots, 10);
        if (activeCount >= facility.total_capacity) {
          throw {
            status: 409,
            message: "No available space for this time slot.",
          };
        }
      } else {
        if (!unitId)
          throw { status: 400, message: "A specific unit ID is required." };

        const unitIntegrityQuery = await tx.query(
          "SELECT id FROM facility_units WHERE id = $1 AND facility_id = $2 FOR UPDATE",
          [unitId, facilityId],
        );

        if (unitIntegrityQuery.rows.length === 0) {
          throw {
            status: 400,
            message:
              "Resource mismatch: The selected unit does not belong to this facility.",
          };
        }

        // For unit-based facilities, ensure the selected unit is not already booked
        const overlapQuery = await tx.query(
          `SELECT booked_by, club_name, user_type, starts_at, ends_at
   FROM bookings
   WHERE unit_id = $1
   AND status IN ($2, $3)
   AND starts_at < $5 AND ends_at > $4
   LIMIT 1`,
          [
            unitId,
            BOOKING_STATUS.SCHEDULED,
            BOOKING_STATUS.CHECKED_IN,
            snappedStart,
            snappedEnd,
          ],
        );

        if (overlapQuery.rows.length > 0) {
          const conflict = overlapQuery.rows[0];
          const isAuditorium = facility.category === "Event Space";

          const message =
            isAuditorium && conflict.user_type === "club"
              ? `The auditorium is already booked by ${conflict.club_name}.`
              : `This unit is already booked by ${conflict.booked_by}.`;

          throw {
            status: 409,
            message,
            conflictDetails: {
              bookedBy: conflict.booked_by,
              clubName: conflict.club_name,
              userType: conflict.user_type,
              startsAt: conflict.starts_at,
              endsAt: conflict.ends_at,
            },
          };
        }
      }

      try {
        // All validations passed then create the booking
        const insertionQuery = await tx.query(
          `INSERT INTO bookings
           (facility_id, unit_id, booked_by, user_type, club_name, booking_type, starts_at, ends_at, status, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            facilityId,
            unitId || null,
            userName,
            userType,
            clubName || null,
            bookingType,
            snappedStart,
            snappedEnd,
            BOOKING_STATUS.SCHEDULED,
            safetyKey,
          ],
        );
        return insertionQuery.rows[0];
      } catch (err) {
        if (err.code === "23505") {
          throw { status: 409, message: "Duplicate booking attempt detected." };
        }
        throw err;
      }
    });
  },

  async cancelBooking({ bookingId, userName }) {
    // Use transaction to safely update booking status

    return await runInTransaction(async (tx) => {
      const bookingRes = await tx.query(
        "SELECT facility_id, booked_by, status FROM bookings WHERE id = $1 FOR UPDATE",
        [bookingId],
      );

      const booking = bookingRes.rows[0];
      if (!booking) throw { status: 404, message: "Booking not found." };

      if (booking.booked_by !== userName) {
        throw { status: 403, message: "Unauthorized cancellation." };
      }

      if (booking.status !== BOOKING_STATUS.SCHEDULED) {
        throw {
          status: 400,
          message: "Only scheduled bookings can be cancelled.",
        };
      }

      const update = await tx.query(
        "UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *",
        [BOOKING_STATUS.RELEASED, bookingId],
      );

      return update.rows[0];
    });
  },

  async getBookingsByUser(userName) {
    const query = `
      SELECT
        b.id,
        b.status,
        b.starts_at,
        b.ends_at,
        b.booking_type,
        b.user_type,
        b.club_name,
        f.name as facility_name,
        f.category,
        u.unit_name
      FROM bookings b
      INNER JOIN facilities f ON b.facility_id = f.id
      LEFT JOIN facility_units u ON b.unit_id = u.id
      WHERE b.booked_by = $1
      AND b.status IN ($2, $3)
      AND b.ends_at > NOW()
      ORDER BY b.starts_at ASC;
    `;

    const values = [
      userName,
      BOOKING_STATUS.SCHEDULED,
      BOOKING_STATUS.CHECKED_IN,
    ];

    const { rows } = await pool.query(query, values);
    return rows;
  },

  async checkIn({ bookingId, userName }) {
    return await runInTransaction(async (tx) => {
      // Lock facility to prevent concurrent state changes during check-in

      const bookingData = await tx.query(
        "SELECT facility_id, starts_at, booked_by, status FROM bookings WHERE id = $1",
        [bookingId],
      );

      const booking = bookingData.rows[0];
      if (!booking) throw { status: 404, message: "Booking record not found." };

      await tx.query("SELECT id FROM facilities WHERE id = $1 FOR UPDATE", [
        booking.facility_id,
      ]);

      const lockedBookingRes = await tx.query(
        "SELECT * FROM bookings WHERE id = $1 FOR UPDATE",
        [bookingId],
      );

      const lockedBooking = lockedBookingRes.rows[0];

      if (lockedBooking.booked_by !== userName) {
        throw { status: 403, message: "Identity mismatch: Access denied." };
      }

      if (lockedBooking.status !== BOOKING_STATUS.SCHEDULED) {
        throw {
          status: 400,
          message: `Check-in invalid. Current status is ${lockedBooking.status}.`,
        };
      }

      const currentTime = new Date();
      const startTime = new Date(lockedBooking.starts_at);

      // Disallow early check-in
      if (currentTime < startTime) {
        throw {
          status: 403,
          message:
            "Too early. Check-in only becomes available at the start of your booked slot.",
        };
      }

      const checkInDeadline = new Date(
        startTime.getTime() + BOOKING_POLICY.NO_SHOW_GRACE_MINUTES * 60000,
      );

      // Expire booking if check-in window has passed
      if (currentTime > checkInDeadline) {
        throw {
          status: 403,
          message: "Check-in window expired. This slot has been released.",
        };
      }

      const updateQuery = await tx.query(
        `UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *`,
        [BOOKING_STATUS.CHECKED_IN, bookingId],
      );

      return updateQuery.rows[0];
    });
  },

  async checkOut({ bookingId, userName }) {
    return await runInTransaction(async (tx) => {
      // Lock facility to safely release capacity

      const initialFetch = await tx.query(
        "SELECT facility_id, booked_by, status FROM bookings WHERE id = $1",
        [bookingId],
      );

      const booking = initialFetch.rows[0];
      if (!booking) throw { status: 404, message: "Booking record not found." };

      await tx.query("SELECT id FROM facilities WHERE id = $1 FOR UPDATE", [
        booking.facility_id,
      ]);

      const lockedBookingRes = await tx.query(
        "SELECT * FROM bookings WHERE id = $1 FOR UPDATE",
        [bookingId],
      );

      const lockedBooking = lockedBookingRes.rows[0];

      if (lockedBooking.booked_by !== userName) {
        throw { status: 403, message: "Identity mismatch: Access denied." };
      }

      if (lockedBooking.status !== BOOKING_STATUS.CHECKED_IN) {
        throw {
          status: 400,
          message: `Check-out invalid. Current status is ${lockedBooking.status}.`,
        };
      }

      // Align checkout time to next slot boundary for consistency
      const alignedEndTime = policyService.snapToNextBoundary(new Date());

      const finalQuery = await tx.query(
        `UPDATE bookings SET status = $1, ends_at = $2 WHERE id = $3 RETURNING *`,
        [BOOKING_STATUS.COMPLETED, alignedEndTime, bookingId],
      );

      return finalQuery.rows[0];
    });
  },
};

import { bookingService } from "../services/bookingService.js";
import { broadcastAssetsUpdate } from "../sockets/socket.js";

export const bookingController = {
  /**
   * POST /api/reserve
   * Creates a booking.
   */

  async reserveAsset(req, res) {
    try {
      const {
        facilityId,
        unitId,
        userName,
        userType,
        clubName,
        startsAt,
        endsAt,
      } = req.body;

      if (!facilityId || !userName || !startsAt || !endsAt) {
        return res.status(400).json({
          error:
            "Incomplete reservation data. facilityId, userName, startsAt, and endsAt are required.",
        });
      }

      if (userType === "club" && !clubName) {
        return res.status(400).json({
          error: "Club name is mandatory for club-type reservations.",
        });
      }

      const reservation = await bookingService.createBooking({
        facilityId,
        unitId,
        userName,
        userType: userType || "individual",
        clubName,
        startsAt,
        endsAt,
      });

      // Notify clients to refresh availability
      broadcastAssetsUpdate();

      return res.status(201).json(reservation);
    } catch (error) {
      if (error.status === 409) {
        return res.status(409).json({
          message: error.message,
          conflictDetails: error.conflictDetails || null,
        });
      }

      return res.status(error.status || 500).json({
        error:
          error.message || "An unexpected error occurred during reservation.",
      });
    }
  },

  /**
   * GET /api/bookings/user/:userName
   * Returns upcoming bookings for a user.
   */
  async getUserBookings(req, res) {
    const { userName } = req.params;

    try {
      if (!userName) {
        return res
          .status(400)
          .json({ error: "userName parameter is required." });
      }

      const bookings = await bookingService.getBookingsByUser(userName);
      return res.status(200).json(bookings);
    } catch (error) {
      console.error("Fetch User Bookings Error:", error);
      return res.status(500).json({
        error: "Failed to retrieve your sessions. Please try again later.",
      });
    }
  },

  /**
   * POST /api/check-in
   * Marks a booking as checked in.
   */
  async checkIn(req, res) {
    try {
      const { bookingId, userName } = req.body;

      if (!bookingId || !userName) {
        return res
          .status(400)
          .json({ error: "bookingId and userName are required." });
      }

      const updatedReservation = await bookingService.checkIn({
        bookingId,
        userName,
      });
      broadcastAssetsUpdate();
      return res.status(200).json(updatedReservation);
    } catch (error) {
      return res.status(error.status || 500).json({
        error: error.message || "Check-in operation failed.",
      });
    }
  },

  /**
   * POST /api/check-out
   * Marks a booking as completed.
   */
  async checkOut(req, res) {
    try {
      const { bookingId, userName } = req.body;

      if (!bookingId || !userName) {
        return res
          .status(400)
          .json({ error: "bookingId and userName are required." });
      }

      const updatedReservation = await bookingService.checkOut({
        bookingId,
        userName,
      });
      broadcastAssetsUpdate();
      return res.status(200).json(updatedReservation);
    } catch (error) {
      return res.status(error.status || 500).json({
        error: error.message || "Check-out operation failed.",
      });
    }
  },

  /**
   * POST /api/cancel
   * Cancels a scheduled booking.
   */
  async cancel(req, res) {
    try {
      const { bookingId, userName } = req.body;

      if (!bookingId || !userName) {
        return res.status(400).json({
          error: "bookingId and userName are required.",
        });
      }

      const updated = await bookingService.cancelBooking({
        bookingId,
        userName,
      });

      broadcastAssetsUpdate();

      return res.status(200).json(updated);
    } catch (error) {
      return res.status(error.status || 500).json({
        error: error.message || "Cancellation failed.",
      });
    }
  },
};

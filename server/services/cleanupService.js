import { pool, runInTransaction } from "../db/connection.js";
import {
  BOOKING_STATUS,
  SCHEDULER_CONFIG,
  BOOKING_POLICY,
} from "../config/appConfig.js";
import { broadcastAssetsUpdate } from "../sockets/socket.js";

export const cleanupService = {
  /**
   * Runs periodic cleanup tasks to maintain data integrity and enforce booking policies
   * Uses a DB advisory lock so only one instance executes it at a time
   */
  async runCleanupCycle() {
    const connection = await pool.connect();
    let stateChanged = false;

    try {
      // Try to acquire advisory lock to prevent multiple workers running cleanup
      const lockAttempt = await connection.query(
        "SELECT pg_try_advisory_lock($1)",
        [SCHEDULER_CONFIG.CLEANUP_LOCK_ID],
      );

      // Exit if another instance already holds the lock
      if (!lockAttempt.rows[0].pg_try_advisory_lock) return;

      const releasedCount = await this.processNoShows();
      const completedCount = await this.completeFinishedBookings();

      if (releasedCount > 0 || completedCount > 0) {
        stateChanged = true;
      }

      // Detect bookings that just became active to trigger UI refresh
      const justStarted = await connection.query(
        `
      SELECT 1
      FROM bookings
      WHERE status = $1
      AND starts_at <= NOW()
      AND starts_at > NOW() - INTERVAL '1 minute'
      LIMIT 1
      `,
        [BOOKING_STATUS.SCHEDULED],
      );

      if (justStarted.rows.length > 0) {
        stateChanged = true;
      }

      // Release advisory lock immediately to allow other instances to run their cycles without waiting for the broadcast
      await connection.query("SELECT pg_advisory_unlock($1)", [
        SCHEDULER_CONFIG.CLEANUP_LOCK_ID,
      ]);

      // Notify clients only if something changed
      if (stateChanged) {
        broadcastAssetsUpdate();
      }
    } catch (err) {
      console.error("CRITICAL: Maintenance Cycle Failure", err);
    } finally {
      connection.release();
    }
  },

  /**
   * Releases bookings where users missed the check-in window
   * Locking facility first, then booking, to avoid deadlocks
   */
  async processNoShows() {
    const graceWindow = BOOKING_POLICY.NO_SHOW_GRACE_MINUTES;

    // Find scheduled bookings that passed the grace period
    const staleReservations = await pool.query(
      `SELECT id, facility_id FROM bookings
       WHERE status = $1
       AND starts_at < NOW() - INTERVAL '${graceWindow} minutes'`,
      [BOOKING_STATUS.SCHEDULED],
    );

    let processedCount = 0;
    for (const record of staleReservations.rows) {
      const wasUpdated = await runInTransaction(async (tx) => {
        // Locking facility first

        await tx.query("SELECT id FROM facilities WHERE id = $1 FOR UPDATE", [
          record.facility_id,
        ]);

        // Then locking booking row
        const lockCheck = await tx.query(
          "SELECT id FROM bookings WHERE id = $1 AND status = $2 FOR UPDATE",
          [record.id, BOOKING_STATUS.SCHEDULED],
        );

        if (lockCheck.rows.length === 0) return false;

        await tx.query(`UPDATE bookings SET status = $1 WHERE id = $2`, [
          BOOKING_STATUS.RELEASED,
          record.id,
        ]);
        return true;
      });

      if (wasUpdated) processedCount++;
    }
    return processedCount;
  },

  /**
   * Marks checked-in bookings as completed once their end time passes
   * Locks facility first, then booking
   */

  async completeFinishedBookings() {
    // Find active sessions that have reached their end time

    const activeSessions = await pool.query(
      `SELECT id, facility_id FROM bookings
       WHERE status = $1
       AND ends_at <= NOW()`,
      [BOOKING_STATUS.CHECKED_IN],
    );

    let processedCount = 0;
    for (const session of activeSessions.rows) {
      const wasUpdated = await runInTransaction(async (tx) => {
        // Lock facility first
        await tx.query("SELECT id FROM facilities WHERE id = $1 FOR UPDATE", [
          session.facility_id,
        ]);

        // Then lock booking row
        const lockCheck = await tx.query(
          "SELECT id FROM bookings WHERE id = $1 AND status = $2 FOR UPDATE",
          [session.id, BOOKING_STATUS.CHECKED_IN],
        );

        if (lockCheck.rows.length === 0) return false;

        await tx.query(`UPDATE bookings SET status = $1 WHERE id = $2`, [
          BOOKING_STATUS.COMPLETED,
          session.id,
        ]);
        return true;
      });

      if (wasUpdated) processedCount++;
    }
    return processedCount;
  },
};

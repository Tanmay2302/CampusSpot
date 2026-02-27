import { pool } from "../db/connection.js";
import { assetService } from "../services/assetService.js";

let lastCleanupRun = null;

export const systemController = {
  // Updates last cleanup run timestamp

  setLastCleanupTimestamp(timestamp) {
    lastCleanupRun = timestamp;
  },

  /**
   * GET /api/system/health
   * Returns basic service health info
   */
  async getHealthStatus(req, res) {
    try {
      await pool.query("SELECT 1");

      return res.status(200).json({
        status: "ok",
        database: "connected",
        lastCleanupRunAt: lastCleanupRun,
        serverTime: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Health Check Failed:", error);
      return res.status(503).json({
        status: "error",
        database: "disconnected",
        error: error.message,
      });
    }
  },

  /**
   * POST /api/system/seed
   * Resets and seeds demo data.
   */
  async resetDemoData(req, res) {
    try {
      await assetService.seedDemoData();
      return res.status(200).json({
        message: "Demo data reset successfully with updated campus policies.",
      });
    } catch (error) {
      console.error("Seeding Error:", error);
      return res.status(500).json({
        error: "Failed to seed demo data. Check server logs for details.",
      });
    }
  },
};

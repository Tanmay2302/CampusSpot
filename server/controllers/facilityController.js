import { assetService } from "../services/assetService.js";
import { facilityScheduleService } from "../services/facilityScheduleService.js";
import { BOOKING_POLICY } from "../config/appConfig.js";

export const facilityController = {
  async getFacilityUnits(req, res) {
    try {
      const { facilityId } = req.params;

      if (!facilityId) {
        return res.status(400).json({
          error: "facilityId parameter is required.",
        });
      }

      const units = await assetService.getFacilityUnits(facilityId);
      return res.status(200).json(units);
    } catch (error) {
      console.error("Fetch Units Error:", error);
      return res.status(500).json({
        error: "Failed to load resource units.",
      });
    }
  },

  async getFacilitySchedule(req, res) {
    try {
      const { facilityId } = req.params;
      const { date } = req.query;

      if (!facilityId || !date) {
        return res.status(400).json({
          error: "facilityId and date query parameter are required.",
        });
      }

      const requestedDate = new Date(date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const maxDate = new Date(today);
      maxDate.setDate(
        today.getDate() + (BOOKING_POLICY.MAX_BOOKING_HORIZON_DAYS - 1),
      );

      if (requestedDate < today || requestedDate > maxDate) {
        return res.status(403).json({
          error: `Date must be within the next ${BOOKING_POLICY.MAX_BOOKING_HORIZON_DAYS} days.`,
        });
      }

      const schedule = await facilityScheduleService.getScheduleForDate(
        facilityId,
        requestedDate,
      );

      return res.status(200).json(schedule);
    } catch (error) {
      console.error("Fetch Schedule Error:", error);
      return res.status(500).json({
        error: "Failed to load facility schedule.",
      });
    }
  },
};

import express from "express";
import { facilityController } from "../controllers/facilityController.js";

const router = express.Router();

router.get(
  "/facilities/:facilityId/units",
  facilityController.getFacilityUnits,
);

router.get(
  "/facilities/:facilityId/schedule",
  facilityController.getFacilitySchedule,
);

export default router;

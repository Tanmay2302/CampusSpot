import express from "express";
import { assetController } from "../controllers/assetController.js";

const router = express.Router();

router.get("/assets", assetController.getAssets);

// Fetch operational units for a facility
// router.get("/facilities/:facilityId/units", async (req, res) => {
//   try {
//     const { facilityId } = req.params;
//     const { assetService } = await import("../services/assetService.js");
//     const units = await assetService.getFacilityUnits(facilityId);
//     return res.status(200).json(units);
//   } catch (error) {
//     console.error("Fetch Units Error:", error);
//     return res.status(500).json({ error: "Failed to load resource units." });
//   }
// });

export default router;

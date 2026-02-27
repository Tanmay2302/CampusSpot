import express from "express";
import { bookingController } from "../controllers/bookingController.js";

const router = express.Router();

router.post("/reserve", bookingController.reserveAsset);
router.post("/check-in", bookingController.checkIn);
router.post("/check-out", bookingController.checkOut);
router.post("/cancel", bookingController.cancel);
router.get("/bookings/user/:userName", bookingController.getUserBookings);

export default router;

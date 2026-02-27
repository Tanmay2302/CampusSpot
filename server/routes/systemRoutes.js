import { Router } from "express";
import { systemController } from "../controllers/systemController.js";

const router = Router();

router.get("/health", systemController.getHealthStatus);

router.post("/seed", systemController.resetDemoData);

export default router;

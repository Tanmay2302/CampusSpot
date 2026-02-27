// app.js
import express from "express";
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import cors from "cors";
import cron from "node-cron";
import dotenv from "dotenv";

import assetRoutes from "./routes/assetRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import systemRoutes from "./routes/systemRoutes.js";
import facilityRoutes from "./routes/facilityRoutes.js";

import { initializeSocket } from "./sockets/socket.js";
import { cleanupService } from "./services/cleanupService.js";
import { systemController } from "./controllers/systemController.js";
import { SCHEDULER_CONFIG } from "./config/appConfig.js";

dotenv.config();

const serverApp = express();
const mainServer = createServer(serverApp);

const allowedOrigins = [
  "http://localhost:5173",
  process.env.FRONTEND_URL,
].filter(Boolean);

const socketHub = new SocketServer(mainServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

serverApp.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS not allowed"));
      }
    },
    credentials: true,
  }),
);

serverApp.use(express.json());

initializeSocket(socketHub);

serverApp.use("/api", assetRoutes);
serverApp.use("/api", bookingRoutes);
serverApp.use("/api/system", systemRoutes);
serverApp.use("/api", facilityRoutes);

// Runs periodic cleanup tasks (no-shows, expired sessions) and broadcasts updates if state changes
const runMaintenanceCycle = async () => {
  await cleanupService.runCleanupCycle();
  systemController.setLastCleanupTimestamp(new Date().toISOString());
};

// Schedule background cleanup based on configured cron interval
cron.schedule(SCHEDULER_CONFIG.CLEANUP_CRON_INTERVAL, runMaintenanceCycle);

const activePort = process.env.PORT || 5000;

mainServer.listen(activePort, () => {
  console.log(`CampusSpot is live on port ${activePort}`);
});

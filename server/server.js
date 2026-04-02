import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";

import Routes from "./routes/route.js";
import { initializeDatabase } from "./initDatabase.js";
import {
  ensureDatabaseConnection,
  formatDatabaseConnectionError,
} from "./db.js";

dotenv.config();

const app = express();
app.use(cookieParser());

app.set("trust proxy", true);

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3001;
const UPLOADS_ROOT = process.env.UPLOADS_ROOT || "uploads";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

app.use("/uploads", express.static(path.resolve(UPLOADS_ROOT)));

app.get("/", (_req, res) => {
  res.status(200).send("Welcome to root URL of Server");
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Backend is running fine",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", Routes);

app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Server error" });
});

const reqTimeoutMs = Math.max(
  60_000,
  Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 30 * 60 * 1000)
);
const headersTimeoutMs = Math.max(
  reqTimeoutMs + 1_000,
  Number(process.env.HTTP_HEADERS_TIMEOUT_MS || reqTimeoutMs + 1_000)
);
const keepAliveTimeoutMs = Math.max(
  5_000,
  Number(process.env.HTTP_KEEPALIVE_TIMEOUT_MS || 65_000)
);

function applyServerTimeouts(server) {
  server.requestTimeout = reqTimeoutMs;
  server.headersTimeout = headersTimeoutMs;
  server.keepAliveTimeout = keepAliveTimeoutMs;
}

async function startServer() {
  try {
    await ensureDatabaseConnection();
    console.log("Database connection established");

    await initializeDatabase();
    console.log("Database initialized successfully");

    const server = app.listen(PORT, () => {
      console.log(`Server is running at http://localhost:${PORT}`);
    });

    applyServerTimeouts(server);
  } catch (error) {
    console.error(formatDatabaseConnectionError(error));
    process.exit(1);
  }
}

startServer();

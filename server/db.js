import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getDatabaseConfig() {
  return {
    host: getRequiredEnv("DB_HOST"),
    port: Number(process.env.DB_PORT || 3306),
    user: getRequiredEnv("DB_USER"),
    password: process.env.DB_PASS || "",
    database: getRequiredEnv("DB_NAME"),
  };
}

function createPool(config) {
  return mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
}

function escapeIdentifier(value) {
  return `\`${String(value).replace(/`/g, "``")}\``;
}

export const pool = createPool(getDatabaseConfig());

export async function ensureDatabaseConnection() {
  const config = getDatabaseConfig();
  const adminPool = createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
  });

  try {
    await adminPool.query(
      `CREATE DATABASE IF NOT EXISTS ${escapeIdentifier(
        config.database
      )} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await pool.query("SELECT 1");
  } finally {
    await adminPool.end();
  }
}

export function formatDatabaseConnectionError(error) {
  const config = getDatabaseConfig();

  if (error?.code === "ECONNREFUSED") {
    return [
      `Database connection failed: MySQL is not reachable at ${config.host}:${config.port}.`,
      "Start the MySQL service, or update DB_HOST/DB_PORT in server/.env to point to the running instance.",
    ].join(" ");
  }

  if (error?.code === "ER_ACCESS_DENIED_ERROR") {
    return [
      `Database connection failed: access denied for MySQL user \"${config.user}\".`,
      "Check DB_USER and DB_PASS in server/.env.",
    ].join(" ");
  }

  if (error?.code === "ER_BAD_DB_ERROR") {
    return [
      `Database connection failed: database \"${config.database}\" does not exist and could not be created automatically.`,
      "Verify the MySQL user has permission to create databases or create it manually.",
    ].join(" ");
  }

  return `Database connection failed: ${error?.message || String(error)}`;
}

import { pool } from "./db.js";
const [rows] = await pool.query("DESCRIBE users");
console.log(rows.map(r => r.Field).join(", "));
process.exit(0);

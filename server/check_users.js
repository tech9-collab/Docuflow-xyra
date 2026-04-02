import { pool } from "./db.js";
const [rows] = await pool.query("SELECT id, name, email FROM users");
console.log(JSON.stringify(rows));
process.exit(0);

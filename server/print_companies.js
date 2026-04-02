import { pool } from "./db.js";
const [rows] = await pool.query("SELECT * FROM companies");
rows.forEach(r => console.log(r.id + ": " + r.name + " (user: " + r.user_id + ")"));
process.exit(0);

import { pool } from "./db.js";
const [rows] = await pool.query("SELECT id, name, email FROM users");
rows.forEach(r => console.log(r.id + ": " + r.email));
process.exit(0);

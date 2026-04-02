import { pool } from "./db.js";
const [rows] = await pool.query("DESCRIBE users");
console.log(JSON.stringify(rows, null, 2));
process.exit(0);

import { pool } from "./db.js";
const [rows] = await pool.query("SELECT * FROM roles WHERE id = 1");
console.log(JSON.stringify(rows));
process.exit(0);

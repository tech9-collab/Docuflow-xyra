import { pool } from "./db.js";
const [rows] = await pool.query("SELECT * FROM companies");
console.log(JSON.stringify(rows));
process.exit(0);

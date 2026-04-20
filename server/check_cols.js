import { pool } from "./db.js";
async function check() {
    const [cols] = await pool.query("SHOW COLUMNS FROM users;");
    console.log(JSON.stringify(cols, null, 2));
    process.exit(0);
}
check();

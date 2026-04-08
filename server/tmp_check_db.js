import { pool } from "./db.js";

async function check() {
    try {
        const [rows] = await pool.query("SELECT id, customer_name, vat_registered_date, first_vat_filing_period, vat_reporting_period, vat_return_due_date FROM customers WHERE customer_name LIKE '%TRAVEL MEDIA%'");
        console.log(JSON.stringify(rows, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
check();

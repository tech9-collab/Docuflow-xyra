// controllers/vatFilingPeriodsController.js
import { pool } from "../db.js";

/**
 * GET /api/vat-filing/customers/:customerId/periods
 */
export async function listCustomerPeriods(req, res) {
  try {
    const { customerId } = req.params;
    const isAdmin = req.user.type === 'admin' || req.user.role === 'super_admin';

    let sql, params;
    if (isAdmin) {
      sql = `
      SELECT id, customer_id, period_from, period_to, due_date, submit_date, status,
             created_at, updated_at
      FROM vat_filing_periods
      WHERE customer_id = ?
      ORDER BY period_from DESC
      `;
      params = [customerId];
    } else {
      sql = `
      SELECT id, customer_id, period_from, period_to, due_date, submit_date, status,
             created_at, updated_at
      FROM vat_filing_periods
      WHERE user_id = ? AND customer_id = ?
      ORDER BY period_from DESC
      `;
      params = [req.user.id, customerId];
    }

    const [rows] = await pool.query(sql, params);
    res.json({ periods: rows });
  } catch (err) {
    console.error("listCustomerPeriods error:", err);
    res.status(500).json({ message: "Failed to load filing periods" });
  }
}

/**
 * POST /api/vat-filing/customers/:customerId/periods
 * body: { periodFrom, periodTo, dueDate, submitDate, status }
 */
export async function createPeriod(req, res) {
  try {
    const { customerId } = req.params;
    const isAdmin = req.user.type === 'admin' || req.user.role === 'super_admin';
    const effectiveUserId = isAdmin ? null : req.user.id;
    const {
      periodFrom,
      periodTo,
      dueDate,
      submitDate,
      status = "not_started",
    } = req.body;

    if (!periodFrom || !periodTo) {
      return res
        .status(400)
        .json({ message: "periodFrom and periodTo are required" });
    }

    const [result] = await pool.query(
      `
      INSERT INTO vat_filing_periods
      (user_id, customer_id, period_from, period_to, due_date, submit_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        effectiveUserId,
        customerId,
        periodFrom,
        periodTo,
        dueDate || null,
        submitDate || null,
        status,
      ]
    );

    const [rows] = await pool.query(
      `SELECT * FROM vat_filing_periods WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json({ period: rows[0] });
  } catch (err) {
    console.error("createPeriod error:", err);
    res.status(500).json({ message: "Failed to create filing period" });
  }
}

/**
 * PUT /api/vat-filing/periods/:id
 * body: { periodFrom, periodTo, dueDate, submitDate, status }
 */
export async function updatePeriod(req, res) {
  try {
    const { id } = req.params;
    const isAdmin = req.user.type === 'admin' || req.user.role === 'super_admin';
    const {
      periodFrom,
      periodTo,
      dueDate,
      submitDate,
      status = "not_started",
    } = req.body;

    let sql, params;
    if (isAdmin) {
      sql = `
      UPDATE vat_filing_periods
      SET period_from = ?, period_to = ?, due_date = ?, submit_date = ?, status = ?
      WHERE id = ?
      `;
      params = [periodFrom || null, periodTo || null, dueDate || null, submitDate || null, status, id];
    } else {
      sql = `
      UPDATE vat_filing_periods
      SET period_from = ?, period_to = ?, due_date = ?, submit_date = ?, status = ?
      WHERE id = ? AND user_id = ?
      `;
      params = [periodFrom || null, periodTo || null, dueDate || null, submitDate || null, status, id, req.user.id];
    }

    const [result] = await pool.query(sql, params);

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Filing period not found" });
    }

    const [rows] = await pool.query(
      `SELECT * FROM vat_filing_periods WHERE id = ?`,
      [id]
    );

    res.json({ period: rows[0] });
  } catch (err) {
    console.error("updatePeriod error:", err);
    res.status(500).json({ message: "Failed to update filing period" });
  }
}

export async function deletePeriod(req, res) {
  try {
    const { id } = req.params;
    const isAdmin = req.user.type === 'admin' || req.user.role === 'super_admin';

    let sql, params;
    if (isAdmin) {
      sql = `DELETE FROM vat_filing_periods WHERE id = ?`;
      params = [id];
    } else {
      sql = `DELETE FROM vat_filing_periods WHERE id = ? AND user_id = ?`;
      params = [id, req.user.id];
    }

    const [result] = await pool.query(sql, params);

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Filing period not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("deletePeriod error:", err);
    res.status(500).json({ message: "Failed to delete filing period" });
  }
}

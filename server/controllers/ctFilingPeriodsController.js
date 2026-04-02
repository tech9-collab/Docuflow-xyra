// controllers/ctFilingPeriodsController.js
import { pool } from "../db.js";

/**
 * GET /api/ct-filing/customers/:customerId/periods
 */
export async function listCustomerPeriods(req, res) {
  try {
    const userId = req.user.id;
    const { customerId } = req.params;

    const [rows] = await pool.query(
      `
      SELECT
        id,
        customer_id,
        period_from,
        period_to,
        due_date,
        submit_date,
        status,
        created_at,
        updated_at
      FROM ct_filing_periods
      WHERE user_id = ? AND customer_id = ?
      ORDER BY period_from DESC
      `,
      [userId, customerId]
    );

    res.json({ periods: rows });
  } catch (err) {
    console.error("CT listCustomerPeriods error:", err);
    res.status(500).json({ message: "Failed to load CT filing periods" });
  }
}

/**
 * POST /api/ct-filing/customers/:customerId/periods
 * body: { periodFrom, periodTo, dueDate, submitDate, status }
 */
export async function createPeriod(req, res) {
  try {
    const userId = req.user.id;
    const { customerId } = req.params;
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
      INSERT INTO ct_filing_periods
        (user_id, customer_id, period_from, period_to, due_date, submit_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        userId,
        customerId,
        periodFrom,
        periodTo,
        dueDate || null,
        submitDate || null,
        status,
      ]
    );

    const [rows] = await pool.query(
      `SELECT * FROM ct_filing_periods WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json({ period: rows[0] });
  } catch (err) {
    console.error("CT createPeriod error:", err);
    res.status(500).json({ message: "Failed to create CT filing period" });
  }
}

/**
 * PUT /api/ct-filing/periods/:id
 * body: { periodFrom, periodTo, dueDate, submitDate, status }
 */
export async function updatePeriod(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      periodFrom,
      periodTo,
      dueDate,
      submitDate,
      status = "not_started",
    } = req.body;

    const [result] = await pool.query(
      `
      UPDATE ct_filing_periods
      SET period_from = ?,
          period_to   = ?,
          due_date    = ?,
          submit_date = ?,
          status      = ?
      WHERE id = ? AND user_id = ?
      `,
      [
        periodFrom || null,
        periodTo || null,
        dueDate || null,
        submitDate || null,
        status,
        id,
        userId,
      ]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "CT filing period not found" });
    }

    const [rows] = await pool.query(
      `SELECT * FROM ct_filing_periods WHERE id = ?`,
      [id]
    );

    res.json({ period: rows[0] });
  } catch (err) {
    console.error("CT updatePeriod error:", err);
    res.status(500).json({ message: "Failed to update CT filing period" });
  }
}


export async function deletePeriod(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id; // from requireAuth

    const [result] = await pool.query(
      "DELETE FROM ct_filing_periods WHERE id = ? AND user_id = ?",
      [id, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "CT filing period not found" });
    }

    return res.json({ message: "CT filing period deleted" });
  } catch (err) {
    console.error("CT deletePeriod error:", err);
    return res
      .status(500)
      .json({ message: "Failed to delete CT filing period" });
  }
}
// controllers/customerController.js
import { pool } from "../db.js";
import {
  copyToLocal,
  buildInvoiceLocalPath, // or create a dedicated buildCustomerLocalPath if you prefer
} from "../lib/localStorage.js";
import { getUserDepartmentId } from "../initDatabase.js";

export async function listCustomers(req, res) {
  try {
    const { company_id: requesterCompanyId, role: userRole } = req.user;
    const isSuperAdmin = userRole === 'super_admin';

    let sql = `SELECT * FROM customers`;
    const params = [];

    if (!isSuperAdmin) {
      if (!requesterCompanyId) return res.json({ customers: [] });
      sql += ` WHERE company_id = ?`;
      params.push(requesterCompanyId);
    }

    sql += ` ORDER BY created_at DESC`;
    const [rows] = await pool.query(sql, params);
    res.json({ customers: rows });
  } catch (err) {
    console.error("listCustomers error:", err);
    res.status(500).json({ message: "Failed to load customers" });
  }
}

export async function getCustomer(req, res) {
  try {
    const { company_id: requesterCompanyId, role: userRole } = req.user;
    const isSuperAdmin = userRole === 'super_admin';
    const { id } = req.params;

    let sql = `SELECT * FROM customers WHERE id = ?`;
    const params = [id];

    if (!isSuperAdmin) {
      if (!requesterCompanyId) return res.status(403).json({ message: "Access denied" });
      sql += ` AND company_id = ?`;
      params.push(requesterCompanyId);
    }

    const [rows] = await pool.query(sql, params);
    if (!rows.length) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const customer = rows[0];
    const [shareholders] = await pool.query(
      `SELECT * FROM customer_shareholders WHERE customer_id = ? ORDER BY id ASC`,
      [id]
    );
    const [documents] = await pool.query(
      `SELECT * FROM customer_documents WHERE customer_id = ? ORDER BY uploaded_at DESC`,
      [id]
    );

    res.json({ customer, shareholders, documents });
  } catch (err) {
    console.error("getCustomer error:", err);
    res.status(500).json({ message: "Failed to fetch customer" });
  }
}

export async function createCustomer(req, res) {
  const conn = await pool.getConnection();
  try {
    const { id: userId, company_id: requesterCompanyId, role: userRole, type: userType } = req.user;
    const isSuperAdmin = userRole === 'super_admin';
    // Admin users (type='admin') are in the companies table, not users — pass null for user_id
    const effectiveUserId = userType === 'admin' ? null : userId;
    const departmentId = userType === 'admin' ? null : await getUserDepartmentId(userId);
    const body = req.body;

    const targetCompanyId = isSuperAdmin ? (body.companyId || null) : requesterCompanyId;

    let {
      customerName, address, email, mobile, country, entityType, entitySubType,
      dateOfIncorporation, tradeLicenseAuthority, tradeLicenseNumber,
      licenseIssueDate, licenseExpiryDate, businessActivity, authorisedSignatories,
      shareCapital, ftaCredentials, ftaPassword, functionalCurrency,
      vatTaxTreatment, vatTrn, vatRegisteredDate, firstVatFilingPeriod,
      vatReturnDueDate, vatReportingPeriod, placeOfSupply, ctTaxTreatment,
      ctTrn, ctRegisteredDate, corporateTaxPeriod, firstCtPeriodStartDate,
      firstCtPeriodEndDate, firstCtReturnDueDate, shareholders = [], businessDocuments = []
    } = body;

    if (typeof shareholders === 'string') {
      try { shareholders = JSON.parse(shareholders); } catch (e) { console.warn("Invalid shareholders JSON", e); }
    }

    let vatCertPath = null, ctCertPath = null;
    if (Array.isArray(req.files)) {
      for (const file of req.files) {
        const rel = buildInvoiceLocalPath({ type: "uploads", originalName: file.originalname });
        await copyToLocal({ srcAbsPath: file.path, destRelPath: rel });
        if (file.fieldname === "vatInfoCertificate") vatCertPath = rel;
        else if (file.fieldname === "ctCertificateTax") ctCertPath = rel;
      }
    }

    await conn.beginTransaction();

    const [ins] = await conn.query(
      `INSERT INTO customers (
        user_id, department_id, company_id, customer_name, address, email, mobile, country,
        entity_type, entity_sub_type, date_of_incorporation, trade_license_authority,
        trade_license_number, license_issue_date, license_expiry_date, business_activity,
        is_freezone, freezone_name, authorised_signatories, share_capital, fta_credentials,
        fta_password, functional_currency, vat_tax_treatment, vat_info_certificate_path,
        vat_trn, vat_registered_date, first_vat_filing_period, vat_return_due_date,
        vat_reporting_period, place_of_supply, ct_tax_treatment, ct_trn, ct_registered_date,
        corporate_tax_period, first_ct_period_start_date, first_ct_period_end_date, first_ct_return_due_date
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        effectiveUserId, departmentId, targetCompanyId, customerName || "", address || "", email || "", mobile || "", country || "",
        entityType || "", entitySubType || "", dateOfIncorporation || null, tradeLicenseAuthority || "",
        tradeLicenseNumber || "", licenseIssueDate || null, licenseExpiryDate || null, businessActivity || "",
        body.isFreezone === "true" || body.isFreezone === "on" || body.isFreezone === true ? 1 : 0,
        body.freezoneName || "", authorisedSignatories || "", shareCapital || "", ftaCredentials || "",
        ftaPassword || "", functionalCurrency || "", vatTaxTreatment || "", vatCertPath,
        vatTrn || "", vatRegisteredDate || null, firstVatFilingPeriod || "", vatReturnDueDate || null,
        vatReportingPeriod || null, placeOfSupply || "", ctTaxTreatment || "", ctTrn || "",
        ctRegisteredDate || null, corporateTaxPeriod || "", firstCtPeriodStartDate || null,
        firstCtPeriodEndDate || null, firstCtReturnDueDate || null,
      ]
    );

    const customerId = ins.insertId;
    for (const sh of shareholders) {
      if (!sh || (!sh.name && !sh.ownerType)) continue;
      await conn.query(
        `INSERT INTO customer_shareholders (customer_id, owner_type, name, nationality, share_percentage) VALUES (?,?,?,?,?)`,
        [customerId, sh.ownerType || "", sh.name || "", sh.nationality || "", sh.sharePercentage || 0]
      );
    }

    await conn.commit();
    res.status(201).json({ message: "Customer created", customer_id: customerId });
  } catch (err) {
    await conn.rollback();
    console.error("createCustomer error:", err);
    console.error("Request Body:", req.body);
    res.status(500).json({ message: `Failed to create customer: ${err.message}` });
  } finally {
    conn.release();
  }
}

export async function updateCustomer(req, res) {
  const { id: customerId } = req.params;
  const { id: userId, company_id: requesterCompanyId, role: userRole } = req.user;
  const isSuperAdmin = userRole === 'super_admin';

  try {
    const {
      customerName, address, email, mobile, country, entityType, entitySubType,
      dateOfIncorporation, tradeLicenseAuthority, tradeLicenseNumber,
      licenseIssueDate, licenseExpiryDate, businessActivity, isFreezone,
      freezoneName, authorisedSignatories, shareCapital, ftaCredentials,
      ftaPassword, functionalCurrency, vatTaxTreatment, vatTrn, vatRegisteredDate,
      firstVatFilingPeriod, vatReturnDueDate, vatReportingPeriod, placeOfSupply,
      ctTaxTreatment, ctTrn, ctRegisteredDate, coporateTaxPeriod,
      firstCtPeriodStartDate, firstCtPeriodEndDate, firstCtReturnDueDate,
    } = req.body;

    let vatCertPath = null, ctCertPath = null;
    if (Array.isArray(req.files)) {
      for (const file of req.files) {
        const rel = buildInvoiceLocalPath({ type: "uploads", originalName: file.originalname });
        await copyToLocal({ srcAbsPath: file.path, destRelPath: rel });
        if (file.fieldname === "vatInfoCertificate") vatCertPath = rel;
        else if (file.fieldname === "ctCertificateTax") ctCertPath = rel;
      }
    }

    let sql = `UPDATE customers SET 
      customer_name = ?, address = ?, email = ?, mobile = ?, country = ?, entity_type = ?,
      entity_sub_type = ?, date_of_incorporation = NULLIF(?, ''), trade_license_authority = ?,
      trade_license_number = ?, license_issue_date = NULLIF(?, ''), license_expiry_date = NULLIF(?, ''),
      business_activity = ?, is_freezone = ?, freezone_name = ?, authorised_signatories = ?,
      vat_tax_treatment = ?, vat_info_certificate_path = COALESCE(?, vat_info_certificate_path),
      vat_trn = ?, vat_registered_date = NULLIF(?, ''),
      first_vat_filing_period = ?, vat_return_due_date = NULLIF(?, ''),
      vat_reporting_period = NULLIF(?, ''), place_of_supply = ?, ct_tax_treatment = ?,
      ct_trn = ?, ct_registered_date = NULLIF(?, ''), corporate_tax_period = ?,
      ct_certificate_tax_path = COALESCE(?, ct_certificate_tax_path),
      first_ct_period_start_date = NULLIF(?, ''), first_ct_period_end_date = NULLIF(?, ''),
      first_ct_return_due_date = NULLIF(?, ''), updated_at = NOW() 
      WHERE id = ?`;

    const params = [
      customerName, address, email, mobile, country, entityType, entitySubType,
      dateOfIncorporation, tradeLicenseAuthority, tradeLicenseNumber,
      licenseIssueDate, licenseExpiryDate, businessActivity,
      isFreezone === "true" || isFreezone === true ? 1 : 0,
      freezoneName, authorisedSignatories, shareCapital, ftaCredentials, ftaPassword,
      functionalCurrency, vatTaxTreatment, vatCertPath, vatTrn, vatRegisteredDate,
      firstVatFilingPeriod, vatReturnDueDate, vatReportingPeriod || null,
      placeOfSupply, ctTaxTreatment, ctTrn, ctRegisteredDate, corporateTaxPeriod,
      ctCertPath,
      firstCtPeriodStartDate, firstCtPeriodEndDate, firstCtReturnDueDate,
      id
    ];

    if (!isSuperAdmin) {
      if (!requesterCompanyId) return res.status(403).json({ message: "Access denied" });
      sql += ` AND company_id = ?`;
      params.push(requesterCompanyId);
    }

    const [result] = await pool.query(sql, params);
    if (result.affectedRows === 0) return res.status(404).json({ message: "Customer not found or access denied" });

    // Update certificate paths only if new files uploaded
    if (vatInfoCertificatePath) {
      await pool.query(`UPDATE customers SET vat_info_certificate_path = ? WHERE id = ?`, [vatInfoCertificatePath, customerId]);
    }
    if (ctCertificateTaxPath) {
      await pool.query(`UPDATE customers SET ct_certificate_tax_path = ? WHERE id = ?`, [ctCertificateTaxPath, customerId]);
    }

    // ---- 4) Shareholders: replace all with new JSON ----
    if (req.body.shareholders) {
      let shareholders = [];
      try { shareholders = JSON.parse(req.body.shareholders); } catch (e) { console.warn("Invalid shareholders JSON on update:", e); }
      await pool.query(`DELETE FROM customer_shareholders WHERE customer_id = ?`, [customerId]);
      for (const sh of shareholders) {
        if (!sh.name && !sh.ownerType) continue;
        await pool.query(
          `INSERT INTO customer_shareholders (customer_id, owner_type, name, nationality, share_percentage) VALUES (?, ?, ?, ?, ?)`,
          [customerId, sh.ownerType || null, sh.name || null, sh.nationality || null, sh.sharePercentage || null]
        );
      }
    }

    // ---- 5) Business documents: append any new uploaded files ----
    if (Array.isArray(req.files)) {
      for (const f of req.files) {
        if (f.fieldname.startsWith("businessDocuments[") && f.fieldname.endsWith("[file]")) {
          const docType = req.body[f.fieldname.replace("[file]", "[type]")] || "other";
          await pool.query(
            `INSERT INTO customer_documents (customer_id, doc_type, file_path, original_name, mime_type) VALUES (?, ?, ?, ?, ?)`,
            [customerId, docType, f.path, f.originalname, f.mimetype]
          );
        }
      }
    }

    return res.json({ message: "Customer updated successfully" });
  } catch (err) {
    console.error("updateCustomer error:", err);
    return res.status(500).json({ message: "Failed to update customer" });
  }
}

export async function deleteCustomer(req, res) {
  try {
    const { company_id: requesterCompanyId, role: userRole } = req.user;
    const isSuperAdmin = userRole === 'super_admin';
    const { id } = req.params;

    let sql = `DELETE FROM customers WHERE id = ?`;
    const params = [id];

    if (!isSuperAdmin) {
      if (!requesterCompanyId) return res.status(403).json({ message: "Access denied" });
      sql += ` AND company_id = ?`;
      params.push(requesterCompanyId);
    }

    const [r] = await pool.query(sql, params);
    if (!r.affectedRows) {
      return res.status(404).json({ message: "Customer not found or access denied" });
    }
    res.json({ message: "Customer deleted" });
  } catch (err) {
    console.error("deleteCustomer error:", err);
    res.status(500).json({ message: "Failed to delete customer" });
  }
}

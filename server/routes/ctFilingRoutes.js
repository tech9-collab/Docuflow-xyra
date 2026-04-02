import { Router } from "express";
import * as ctFilingController from "../controllers/ctFilingController.js";
import * as ctFilingPeriodsController from "../controllers/ctFilingPeriodsController.js";
import requireAuth from "../middleware/requireAuth.js";

const router = Router();

// Apply authentication middleware to all routes
router.use(requireAuth);

// ==== CT Filing Periods (same structure as VAT) ====

// list periods for one customer
router.get(
  "/customers/:customerId/periods",
  ctFilingPeriodsController.listCustomerPeriods
);

// create period for customer
router.post(
  "/customers/:customerId/periods",
  ctFilingPeriodsController.createPeriod
);

// update one CT period
router.put("/periods/:id", ctFilingPeriodsController.updatePeriod);

// delete one CT period
router.delete("/periods/:id", ctFilingPeriodsController.deletePeriod);

// ==== CT Filing Excel & Preview ====

// Generate combined Excel workbook
router.post(
  "/companies/:companyId/combined-excel",
  ctFilingController.generateCombinedExcel
);

// Get combined preview data
router.get(
  "/companies/:companyId/preview",
  ctFilingController.getCombinedPreview
);

export default router;

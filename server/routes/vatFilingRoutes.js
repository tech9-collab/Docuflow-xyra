import { Router } from "express";
import * as vatFilingController from "../controllers/vatFilingController.js";
import * as vatFilingPeriodsController from "../controllers/vatFilingPeriodsController.js";
import requireAuth from "../middleware/requireAuth.js";

const router = Router();

// Apply authentication middleware to all routes
router.use(requireAuth);

// list periods for one customer
router.get(
  "/customers/:customerId/periods",
  vatFilingPeriodsController.listCustomerPeriods
);

router.delete("/periods/:id", vatFilingPeriodsController.deletePeriod);

// create period for customer
router.post(
  "/customers/:customerId/periods",
  vatFilingPeriodsController.createPeriod
);

// update one period
router.put("/periods/:id", vatFilingPeriodsController.updatePeriod);

router.post(
  "/periods/:periodId/drafts",
  vatFilingController.saveDraftForPeriod
);

router.get("/periods/:periodId/runs", vatFilingController.listRunsForPeriod);

router.get("/runs/:runId", vatFilingController.getRunById);

router.put("/runs/:runId", vatFilingController.updateRunById);

router.delete("/runs/:runId", vatFilingController.deleteRunById);

// Generate combined Excel workbook
router.post(
  "/companies/:companyId/combined-excel",
  vatFilingController.generateCombinedExcel
);

router.post(
  "/companies/:companyId/vat-return-template",
  vatFilingController.downloadVatReturnTemplate
);

// Get combined preview data
router.get(
  "/companies/:companyId/preview",
  vatFilingController.getCombinedPreview
);

export default router;

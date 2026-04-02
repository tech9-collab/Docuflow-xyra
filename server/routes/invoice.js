import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import {
  upload,
  startJob,
  jobStatus,
  jobResult,
  jobZohoTemplate,
  jobPreview,
} from "../controllers/invoiceConvertController.js";

const router = Router();

// all routes here are already behind /api/invoice via route.js
router.post("/jobs/start", requireAuth, upload.any(), startJob);
router.get("/jobs/status/:id", requireAuth, jobStatus);
router.get("/jobs/result/:id", requireAuth, jobResult);
router.get("/jobs/zoho-template/:id", requireAuth, jobZohoTemplate);
router.get("/jobs/preview/:id", requireAuth, jobPreview);

export default router;

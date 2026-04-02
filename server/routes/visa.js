// routes/visa.js
import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { upload as visaUpload, startJob, jobStatus, jobPreview, jobResult } from "../controllers/visaController.js";

const router = Router();
router.post("/jobs/start", requireAuth, visaUpload, startJob);
router.get("/jobs/status/:id", requireAuth, jobStatus);
router.get("/jobs/preview/:id", requireAuth, jobPreview);
router.get("/jobs/result/:id", requireAuth, jobResult);

export default router;

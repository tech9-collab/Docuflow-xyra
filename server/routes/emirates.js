import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
 import {
   upload as emiratesUpload,
   startJob,
   jobStatus,
   jobPreview,
   jobResult,
 } from "../controllers/emiratesController.js";

const router = Router();
router.post("/jobs/start", requireAuth, emiratesUpload, startJob);
router.get("/jobs/status/:id", requireAuth, jobStatus);
router.get("/jobs/preview/:id", requireAuth, jobPreview);
router.get("/jobs/result/:id", requireAuth, jobResult);
export default router;
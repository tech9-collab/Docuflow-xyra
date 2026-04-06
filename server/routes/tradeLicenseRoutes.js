import express from "express";
import { upload, startJob, jobStatus, jobPreview, jobResult, extractOne } from "../controllers/tradeLicenseController.js";
const r = express.Router();

r.post("/jobs/start", upload, startJob);
r.get("/jobs/status/:id", jobStatus);
r.get("/jobs/preview/:id", jobPreview);
r.get("/jobs/result/:id", jobResult);
r.post("/extract-one", upload, extractOne);

export default r;
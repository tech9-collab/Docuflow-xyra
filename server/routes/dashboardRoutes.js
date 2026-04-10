import express from "express";
import * as dashboardController from "../controllers/dashboardController.js";
import requireAuth from "../middleware/requireAuth.js";

const router = express.Router();

router.get("/", requireAuth, dashboardController.getDashboardStats);
router.get("/summary", requireAuth, dashboardController.getDashboardSummary);
router.get("/pending-filings", requireAuth, dashboardController.getPendingFilings);
router.get("/stats", requireAuth, dashboardController.getDashboardStats);
router.get("/department-stats", requireAuth, dashboardController.getDepartmentStats);
router.get("/module-stats", requireAuth, dashboardController.getModuleStats);
router.get("/user-processing", requireAuth, dashboardController.getUserProcessingDetails);

export default router;

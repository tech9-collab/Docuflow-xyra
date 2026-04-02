// server/routes/companyRoutes.js
import express from "express";
import * as companyController from "../controllers/companyController.js";
import requireAuth from "../middleware/requireAuth.js";

const router = express.Router();

// All company routes require authentication
router.use(requireAuth);

// Company management routes
router.get("/", companyController.getUserCompanies);
router.get("/:companyId", companyController.getCompanyById);
router.post("/", companyController.createCompany);
router.put("/:companyId", companyController.updateCompany);
router.delete("/:companyId", companyController.deleteCompany);

export default router;
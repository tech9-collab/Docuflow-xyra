import express from "express";

// Import Controller Route
import * as controller from "../controllers/appController.js"

// Import Middleware Route
import requireAuth from "../middleware/requireAuth.js";

// Import Additional Route
// import bankRouter from "./bank.js";
// import bankRouter from "./bank2.js";
import bankRouter from "./bank3.js";
import invoiceRouter from "./invoice.js";
import emiratesRoutes from "./emirates.js";
import passportRoutes from "./passport.js";
import visaRoutes from "./visa.js";
import billsRoutes from "./bills.js";
import tradeLicenseRoutes  from "./tradeLicenseRoutes.js";
import rolesRouter from "./roles.js";
import companyRoutes from "./companyRoutes.js";
// Removed projectsRouter import
import vatFilingRoutes from "./vatFilingRoutes.js";
import ctFilingRoutes from "./ctFilingRoutes.js";
import customerRoutes from "./customerRoutes.js";


const router = express.Router();

/* POST Routes */

// Route for User Registration - auth - POST
router.route("/auth/register").post(controller.registerUser);

// Route for User Login - auth - POST
router.route("/auth/login").post(controller.loginUser);

// Customers
router.use("/customers", customerRoutes);

// Bank Statements
router.use("/bank", requireAuth, bankRouter);

// Invoices
router.use("/invoice", requireAuth, invoiceRouter);

// Emirates ID
router.use("/emirates", requireAuth, emiratesRoutes);

// Passports 
router.use("/passport", requireAuth, passportRoutes);

// Visa
router.use("/visa", requireAuth, visaRoutes);

// Bills
router.use("/bills", requireAuth, billsRoutes);

// Trade License
router.use("/tradelicense", requireAuth, tradeLicenseRoutes);

// Roles and Permissions
router.use("/admin", requireAuth, rolesRouter);

// Companies
router.use("/companies", requireAuth, companyRoutes);

// VAT Filing
router.use("/vat-filing", vatFilingRoutes);

// CT Filing
router.use("/ct-filing", ctFilingRoutes);



// Removed Projects route

export default router;
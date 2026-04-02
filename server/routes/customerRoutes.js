// routes/customerRoutes.js
import { Router } from "express";
import multer from "multer";
import os from "os";
import path from "path";
import * as customerController from "../controllers/customerController.js";
import requireAuth from "../middleware/requireAuth.js";

const router = Router();

// temp upload dir
const upload = multer({
  dest: path.join(os.tmpdir(), "docuflow_customer_uploads"),
});

// All customer routes require auth
router.use(requireAuth);

// GET /api/customers  -> list for table (limited fields)
router.get("/", customerController.listCustomers);

// GET /api/customers/:id -> full details (for view/edit)
router.get("/:id", customerController.getCustomer);

// POST /api/customers   -> create
// we accept multipart/form-data because of file uploads
router.post(
  "/",
  upload.any(), // later you can switch to .fields([...]) if you want strict field names
  customerController.createCustomer
);

// PUT /api/customers/:id -> update
router.put(
  "/:id",
  upload.any(),
  customerController.updateCustomer
);

// DELETE /api/customers/:id -> delete
router.delete("/:id", customerController.deleteCustomer);

export default router;

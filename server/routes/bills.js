// routes/bills.js
import { Router } from "express";
import multer from "multer";
import * as bills from "../controllers/billsController.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/extract", upload.array("files"), bills.extract);
router.post("/excel", bills.excel);

export default router;

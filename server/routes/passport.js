// routes/passport.js
// import { Router } from "express";
// import multer from "multer";
// import * as passport from "../controllers/passportController.js";

// const router = Router();
// const upload = multer({ storage: multer.memoryStorage() });

// router.post("/extract", upload.array("files"), passport.extract);
// router.post("/excel", passport.excel);

// export default router;


import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import {
  upload as passportUpload,
  startJob,
  jobStatus,
  jobPreview,
  jobResult,
} from "../controllers/passportController.js";

const router = Router();
router.post("/jobs/start",  passportUpload, startJob);
router.get("/jobs/status/:id", jobStatus);
router.get("/jobs/preview/:id", jobPreview);
router.get("/jobs/result/:id", jobResult);
export default router;

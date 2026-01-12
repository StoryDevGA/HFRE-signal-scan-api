const express = require("express");
const {
  createScan,
  getPublicResult,
} = require("../controllers/publicController");

const router = express.Router();

router.post("/scans", createScan);
router.get("/results/:publicId", getPublicResult);

module.exports = router;

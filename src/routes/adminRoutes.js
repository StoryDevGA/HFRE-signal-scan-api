const express = require("express");
const { login, logout } = require("../controllers/adminAuthController");
const {
  getAnalytics,
  getAnalyticsForSubmission,
} = require("../controllers/adminAnalyticsController");
const {
  createPromptHandler,
  deletePrompt,
  listPrompts,
  updatePromptHandler,
} = require("../controllers/adminPromptsController");
const {
  deleteSubmission,
  getSubmission,
  listSubmissions,
} = require("../controllers/adminSubmissionsController");
const { deleteUserData } = require("../controllers/adminUsersController");
const { requireAdmin } = require("../middleware/adminAuth");
const { createRateLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const loginRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

router.post("/auth/login", loginRateLimiter, login);
router.post("/auth/logout", logout);
router.get("/auth/logout", logout);

router.use(requireAdmin);
router.get("/submissions", listSubmissions);
router.get("/submissions/:id", getSubmission);
router.delete("/submissions/:id", deleteSubmission);
router.get("/prompts", listPrompts);
router.post("/prompts", createPromptHandler);
router.put("/prompts/:id", updatePromptHandler);
router.delete("/prompts/:id", deletePrompt);
router.get("/analytics", getAnalytics);
router.get("/analytics/:submissionId", getAnalyticsForSubmission);
router.delete("/users/:email", deleteUserData);

module.exports = router;

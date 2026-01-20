const crypto = require("crypto");
const { Analytics, Submission } = require("../models");
const { processSubmission } = require("../services/scanService");
const { publicScanSchema } = require("../validators/schemas");

function generatePublicId() {
  return crypto.randomBytes(12).toString("hex");
}

function formatZodErrors(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

async function createScan(req, res) {
  const parsed = publicScanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: formatZodErrors(parsed.error) });
  }

  const publicId = generatePublicId();

  try {
    const submission = await Submission.create({
      publicId,
      status: "pending",
      inputs: parsed.data,
    });

    await Analytics.create({
      submissionId: submission._id,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || "",
      acceptLanguage: req.get("accept-language") || "",
      referrer: req.get("referer") || "",
    });

    processSubmission(submission._id).catch((error) => {
      console.error("Async scan failed:", error);
    });

    return res.status(201).json({ publicId });
  } catch (error) {
    console.error("Failed to create scan submission:", error);
    return res.status(500).json({ error: "Failed to create submission." });
  }
}

async function getPublicResult(req, res) {
  const { publicId } = req.params;
  const retryAfterMs = Number(process.env.PENDING_RETRY_MS || "60000");

  try {
    const submission = await Submission.findOne({ publicId }).lean();
    if (!submission) {
      return res.status(404).json({ status: "not_found" });
    }

    if (submission.status === "pending") {
      if (
        retryAfterMs > 0 &&
        submission.updatedAt &&
        Date.now() - new Date(submission.updatedAt).getTime() > retryAfterMs
      ) {
        processSubmission(submission._id).catch((error) => {
          console.error("Retry scan failed:", error);
        });
      }
      return res.status(202).json({ status: "pending" });
    }

    if (submission.status === "failed") {
      return res
        .status(500)
        .json({ status: "failed", message: submission.failure?.message || "" });
    }

    const outputs = submission.outputs || {};
    return res.status(200).json({
      status: "complete",
      publicId: submission.publicId,
      company: outputs.company || "",
      customer_report: outputs.customer_report || "",
      metadata: outputs.metadata || null,
    });
  } catch (error) {
    console.error("Failed to fetch submission:", error);
    return res.status(500).json({ status: "failed", message: "" });
  }
}

module.exports = { createScan, getPublicResult };

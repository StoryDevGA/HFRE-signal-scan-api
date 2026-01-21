const { Analytics, Submission } = require("../models");

function parsePagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number.parseInt(query.pageSize, 10) || 20)
  );
  return { page, pageSize };
}

function buildFilters(query) {
  const filters = {};
  if (query.status) {
    filters.status = query.status;
  }

  if (query.q) {
    const escaped = query.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    filters.$or = [
      { "inputs.email": regex },
      { "inputs.company_name": regex },
      { "inputs.name": regex },
    ];
  }

  return filters;
}

async function listSubmissions(req, res) {
  const filters = buildFilters(req.query);
  const { page, pageSize } = parsePagination(req.query);
  const skip = (page - 1) * pageSize;

  try {
    const [items, total] = await Promise.all([
      Submission.find(filters)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      Submission.countDocuments(filters),
    ]);

    return res.status(200).json({
      items: items.map((item) => ({
        ...item,
        failureMessage: item.failure?.message || "",
        llmModelUsed: item.processing?.llmModel || "",
        llmTemperatureUsed:
          typeof item.processing?.llmTemperature === "number"
            ? item.processing.llmTemperature
            : null,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to list submissions." });
  }
}

async function getSubmission(req, res) {
  const { id } = req.params;

  try {
    const submission = await Submission.findById(id).lean();
    if (!submission) {
      return res.status(404).json({ error: "Submission not found." });
    }

    const analytics = await Analytics.findOne({
      submissionId: submission._id,
    }).lean();

    return res.status(200).json({
      submission,
      analytics,
      failureMessage: submission.failure?.message || "",
      llmModelUsed: submission.processing?.llmModel || "",
      llmTemperatureUsed:
        typeof submission.processing?.llmTemperature === "number"
          ? submission.processing.llmTemperature
          : null,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch submission." });
  }
}

async function deleteSubmission(req, res) {
  const { id } = req.params;

  try {
    const submission = await Submission.findByIdAndDelete(id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found." });
    }

    await Analytics.deleteMany({ submissionId: submission._id });
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete submission." });
  }
}

module.exports = {
  listSubmissions,
  getSubmission,
  deleteSubmission,
};

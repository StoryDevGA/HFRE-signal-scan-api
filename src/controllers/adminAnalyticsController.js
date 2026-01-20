const { Analytics, Submission } = require("../models");

function parseBrowser(userAgent) {
  if (!userAgent) {
    return "Unknown";
  }
  if (/edg/i.test(userAgent)) {
    return "Edge";
  }
  if (/chrome/i.test(userAgent) && !/edg/i.test(userAgent)) {
    return "Chrome";
  }
  if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) {
    return "Safari";
  }
  if (/firefox/i.test(userAgent)) {
    return "Firefox";
  }
  return "Other";
}

function parseDevice(userAgent) {
  if (!userAgent) {
    return "Unknown";
  }
  if (/ipad/i.test(userAgent)) {
    return "iPad";
  }
  if (/iphone/i.test(userAgent)) {
    return "iPhone";
  }
  if (/android/i.test(userAgent) && /mobile/i.test(userAgent)) {
    return "Android";
  }
  if (/mobile/i.test(userAgent)) {
    return "Mobile";
  }
  return "Desktop";
}

function incrementCounter(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function toSortedCounts(map) {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return null;
  }
  const promptTokens =
    usage.promptTokens ??
    usage.prompt_tokens ??
    usage.input_tokens ??
    usage.inputTokens ??
    null;
  const completionTokens =
    usage.completionTokens ??
    usage.completion_tokens ??
    usage.output_tokens ??
    usage.outputTokens ??
    null;
  const totalTokens =
    usage.totalTokens ??
    usage.total_tokens ??
    (Number(promptTokens || 0) + Number(completionTokens || 0) || null);

  if (promptTokens == null && completionTokens == null && totalTokens == null) {
    return null;
  }

  return {
    promptTokens: Number(promptTokens || 0),
    completionTokens: Number(completionTokens || 0),
    totalTokens: Number(totalTokens || 0),
  };
}

async function getAnalytics(req, res) {
  try {
    const [statusCounts, dailyCounts, analytics, usageRecords] = await Promise.all([
      Submission.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Submission.aggregate([
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
            total: { $sum: 1 },
            pending: {
              $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
            },
            complete: {
              $sum: { $cond: [{ $eq: ["$status", "complete"] }, 1, 0] },
            },
            failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Analytics.find().lean(),
      Submission.find({ usage: { $exists: true } })
        .select({ usage: 1 })
        .lean(),
    ]);

    const total = statusCounts.reduce((sum, item) => sum + item.count, 0);
    const complete =
      statusCounts.find((item) => item._id === "complete")?.count || 0;
    const failed =
      statusCounts.find((item) => item._id === "failed")?.count || 0;
    const conversionRate = total ? complete / total : 0;

    const browserCounts = new Map();
    const deviceCounts = new Map();
    analytics.forEach((record) => {
      const userAgent = record.userAgent || "";
      incrementCounter(browserCounts, parseBrowser(userAgent));
      incrementCounter(deviceCounts, parseDevice(userAgent));
    });

    const usageTotals = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      submissionsWithUsage: 0,
    };
    usageRecords.forEach((record) => {
      const normalized = normalizeUsage(record.usage);
      if (!normalized) return;
      usageTotals.promptTokens += normalized.promptTokens;
      usageTotals.completionTokens += normalized.completionTokens;
      usageTotals.totalTokens += normalized.totalTokens;
      usageTotals.submissionsWithUsage += 1;
    });

    const usageAverages = {
      averagePromptTokens: usageTotals.submissionsWithUsage
        ? Math.round(usageTotals.promptTokens / usageTotals.submissionsWithUsage)
        : 0,
      averageCompletionTokens: usageTotals.submissionsWithUsage
        ? Math.round(
            usageTotals.completionTokens / usageTotals.submissionsWithUsage
          )
        : 0,
      averageTotalTokens: usageTotals.submissionsWithUsage
        ? Math.round(usageTotals.totalTokens / usageTotals.submissionsWithUsage)
        : 0,
    };

    return res.status(200).json({
      totals: {
        total,
        pending:
          statusCounts.find((item) => item._id === "pending")?.count || 0,
        complete,
        failed,
        conversionRate,
        completeRate: total ? complete / total : 0,
        failedRate: total ? failed / total : 0,
      },
      countsByDay: dailyCounts.map((item) => ({
        date: item._id,
        total: item.total,
        pending: item.pending,
        complete: item.complete,
        failed: item.failed,
      })),
      topBrowsers: toSortedCounts(browserCounts),
      topDevices: toSortedCounts(deviceCounts),
      usage: {
        ...usageTotals,
        ...usageAverages,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load analytics." });
  }
}

async function getAnalyticsForSubmission(req, res) {
  try {
    const analytics = await Analytics.findOne({
      submissionId: req.params.submissionId,
    }).lean();

    if (!analytics) {
      return res.status(404).json({ error: "Analytics not found." });
    }

    return res.status(200).json(analytics);
  } catch (error) {
    return res.status(500).json({ error: "Failed to load analytics." });
  }
}

module.exports = { getAnalytics, getAnalyticsForSubmission };

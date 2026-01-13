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

async function getAnalytics(req, res) {
  try {
    const [statusCounts, dailyCounts, analytics] = await Promise.all([
      Submission.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Submission.aggregate([
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Analytics.find().lean(),
    ]);

    const total = statusCounts.reduce((sum, item) => sum + item.count, 0);
    const complete =
      statusCounts.find((item) => item._id === "complete")?.count || 0;
    const conversionRate = total ? complete / total : 0;

    const browserCounts = new Map();
    const deviceCounts = new Map();
    analytics.forEach((record) => {
      const userAgent = record.userAgent || "";
      incrementCounter(browserCounts, parseBrowser(userAgent));
      incrementCounter(deviceCounts, parseDevice(userAgent));
    });

    return res.status(200).json({
      totals: {
        total,
        pending:
          statusCounts.find((item) => item._id === "pending")?.count || 0,
        complete,
        failed:
          statusCounts.find((item) => item._id === "failed")?.count || 0,
        conversionRate,
      },
      countsByDay: dailyCounts.map((item) => ({
        date: item._id,
        count: item.count,
      })),
      topBrowsers: toSortedCounts(browserCounts),
      topDevices: toSortedCounts(deviceCounts),
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

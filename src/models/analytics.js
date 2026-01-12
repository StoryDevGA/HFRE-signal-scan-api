const mongoose = require("mongoose");

const analyticsSchema = new mongoose.Schema(
  {
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Submission",
      required: true,
    },
    ipAddress: { type: String, required: true },
    userAgent: { type: String, required: true },
    acceptLanguage: { type: String },
    referrer: { type: String },
    deviceSummary: { type: String },
  },
  { timestamps: true }
);

analyticsSchema.index({ submissionId: 1 });
analyticsSchema.index({ createdAt: -1 });

const Analytics = mongoose.model("Analytics", analyticsSchema);

module.exports = { Analytics };

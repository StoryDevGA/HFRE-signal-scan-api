const mongoose = require("mongoose");

const metadataSchema = new mongoose.Schema(
  {
    confidence_level: {
      type: String,
      enum: ["High", "Medium", "Low"],
      required: true,
    },
    source_scope: {
      type: String,
      enum: ["Public website only"],
      required: true,
    },
    shareability: {
      customer_safe: { type: Boolean, required: true },
      internal_only: { type: Boolean, required: true },
    },
  },
  { _id: false }
);

const submissionSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["pending", "complete", "failed"],
      required: true,
      default: "pending",
    },
    inputs: {
      name: { type: String, required: true },
      email: { type: String, required: true, index: true },
      company_name: { type: String, required: true },
      homepage_url: { type: String, required: true },
      product_name: { type: String, required: true },
      product_page_url: { type: String, required: true },
    },
    outputs: {
      company: { type: String },
      internal_report: { type: String },
      customer_report: { type: String },
      metadata: metadataSchema,
    },
    promptRefs: {
      systemPromptId: { type: mongoose.Schema.Types.ObjectId, ref: "Prompt" },
      userPromptId: { type: mongoose.Schema.Types.ObjectId, ref: "Prompt" },
      systemPromptVersion: { type: Number },
      userPromptVersion: { type: Number },
    },
    emailStatus: {
      customerSentAt: { type: Date },
      ownerSentAt: { type: Date },
      lastError: { type: String },
    },
    failure: {
      message: { type: String },
      rawOutput: { type: mongoose.Schema.Types.Mixed },
    },
  },
  { timestamps: true }
);

submissionSchema.index({ createdAt: -1 });

const Submission = mongoose.model("Submission", submissionSchema);

module.exports = { Submission };

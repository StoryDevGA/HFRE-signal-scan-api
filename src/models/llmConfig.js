const mongoose = require("mongoose");

const llmConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },
    mode: { type: String, enum: ["fixed"], required: true },
    temperature: { type: Number, min: 0, max: 2 },
    reasoningEffort: { type: String },
    modelFixed: { type: String },
    updatedBy: { type: String, required: true },
  },
  { timestamps: true }
);

const LlmConfig = mongoose.model("LlmConfig", llmConfigSchema);

module.exports = { LlmConfig };

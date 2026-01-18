const mongoose = require("mongoose");

const promptSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["system", "user"], required: true },
    name: { type: String, required: true },
    content: { type: String, required: true },
    isActive: { type: Boolean, default: false },
    version: { type: Number, default: 1 },
  },
  { timestamps: true }
);

// Index for efficient lookup of active prompts by type
promptSchema.index({ type: 1, isActive: 1 });

const Prompt = mongoose.model("Prompt", promptSchema);

module.exports = { Prompt };

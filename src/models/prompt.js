const mongoose = require("mongoose");

const promptSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["system", "user"], required: true },
    ownerEmail: { type: String, required: true, index: true },
    label: { type: String, required: true },
    name: { type: String, required: true },
    content: { type: String, required: true },
    isActive: { type: Boolean, default: false },
    publishedAt: { type: Date },
    publishedBy: { type: String },
    isLocked: { type: Boolean, default: false },
    lockNote: { type: String },
    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

promptSchema.pre("validate", function applyLegacyDefaults(next) {
  if (!this.ownerEmail) {
    this.ownerEmail = "legacy@system";
  }

  if (!this.label) {
    this.label = this.name || "Legacy Prompt";
  }

  if (!this.name) {
    const timestamp = this.createdAt || new Date();
    const owner = String(this.ownerEmail || "legacy@system").trim().toLowerCase();
    this.name = `${this.label} | ${owner} | ${new Date(timestamp).toISOString()}`;
  }

  next();
});

// Fast lookup for published prompts by type (enforces one published per type).
promptSchema.index(
  { type: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);
promptSchema.index({ ownerEmail: 1, type: 1, createdAt: -1 });

const Prompt = mongoose.model("Prompt", promptSchema);

module.exports = { Prompt };

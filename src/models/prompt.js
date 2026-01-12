const mongoose = require("mongoose");

const promptSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["system", "user"], required: true },
    name: { type: String, required: true },
    content: { type: String, required: true },
    active: { type: Boolean, default: false },
    version: { type: Number },
  },
  { timestamps: true }
);

const Prompt = mongoose.model("Prompt", promptSchema);

module.exports = { Prompt };

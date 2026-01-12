const mongoose = require("mongoose");

const adminAuditSchema = new mongoose.Schema(
  {
    adminEmail: { type: String, required: true },
    action: { type: String, required: true },
    target: { type: String, required: true },
    metadata: { type: Object },
  },
  { timestamps: true }
);

const AdminAudit = mongoose.model("AdminAudit", adminAuditSchema);

module.exports = { AdminAudit };

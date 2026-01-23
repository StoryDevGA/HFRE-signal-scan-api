const { AdminAudit } = require("../models");

async function logAdminAction({ adminEmail, action, target, metadata }) {
  if (!adminEmail || !action || !target) {
    return null;
  }

  const entry = new AdminAudit({
    adminEmail: String(adminEmail).trim().toLowerCase(),
    action,
    target,
    metadata: metadata || {},
  });

  await entry.save();
  return entry;
}

module.exports = { logAdminAction };

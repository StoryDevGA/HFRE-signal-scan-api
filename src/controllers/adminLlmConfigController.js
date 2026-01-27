const { llmConfigSchema } = require("../validators/schemas");
const {
  getLlmConfigWithFallback,
  upsertLlmConfig,
} = require("../services/llmConfigService");
const { logAdminAction } = require("../services/adminAuditService");

function formatZodErrors(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

async function getLlmConfig(req, res) {
  try {
    const config = await getLlmConfigWithFallback();
    return res.status(200).json(config);
  } catch (error) {
    return res.status(500).json({ error: "Failed to load LLM config." });
  }
}

async function updateLlmConfig(req, res) {
  const parsed = llmConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: formatZodErrors(parsed.error) });
  }

  try {
    const actorEmail = String(req.admin?.email || "").toLowerCase();
    const config = await upsertLlmConfig(parsed.data, actorEmail);

    await logAdminAction({
      adminEmail: actorEmail,
      action: "llmConfig.update",
      target: "llmConfig:global",
      metadata: {
        mode: config.mode,
        temperature: config.temperature,
        reasoningEffort: config.reasoningEffort ?? null,
        modelFixed: config.modelFixed,
      },
    });

    return res.status(200).json({ ...config, source: "db" });
  } catch (error) {
    const status = error.status || 500;
    return res
      .status(status)
      .json({ error: error.message || "Failed to update LLM config." });
  }
}

module.exports = {
  getLlmConfig,
  updateLlmConfig,
};

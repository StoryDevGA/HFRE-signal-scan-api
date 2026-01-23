const { Prompt } = require("../models");
const {
  createPrompt,
  updatePrompt,
  deletePrompt: deletePromptService,
} = require("../services/promptService");
const { logAdminAction } = require("../services/adminAuditService");
const {
  promptCreateSchema,
  promptUpdateSchema,
} = require("../validators/schemas");

function formatZodErrors(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

async function listPrompts(req, res) {
  try {
    const prompts = await Prompt.find().sort({ createdAt: -1 }).lean();
    const items = prompts.map((prompt) => ({
      ...prompt,
      isPublished: Boolean(prompt.isActive),
    }));
    return res.status(200).json({ items });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load prompts." });
  }
}

async function createPromptHandler(req, res) {
  const parsed = promptCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: formatZodErrors(parsed.error) });
  }

  try {
    const ownerEmail = String(req.admin?.email || "").toLowerCase();
    const label = parsed.data.label || parsed.data.name;
    const publishFlag =
      typeof parsed.data.isPublished === "boolean"
        ? parsed.data.isPublished
        : parsed.data.isActive;

    const { prompt, publishInfo } = await createPrompt(
      {
        type: parsed.data.type,
        label,
        content: parsed.data.content,
        ownerEmail,
        isActive: Boolean(publishFlag),
      },
      ownerEmail
    );

    await logAdminAction({
      adminEmail: ownerEmail,
      action: "prompt.create",
      target: `prompt:${prompt._id}`,
      metadata: {
        promptId: prompt._id,
        type: prompt.type,
        ownerEmail: prompt.ownerEmail,
        label: prompt.label,
        version: prompt.version,
      },
    });

    if (publishInfo) {
      await logAdminAction({
        adminEmail: ownerEmail,
        action: "prompt.publish",
        target: `prompt:${prompt._id}`,
        metadata: {
          promptId: prompt._id,
          type: prompt.type,
          previousPublishedId: publishInfo.previousPublishedId,
        },
      });
    }

    return res.status(201).json({
      ...prompt.toObject(),
      isPublished: Boolean(prompt.isActive),
    });
  } catch (error) {
    const status = error.status || 500;
    return res
      .status(status)
      .json({ error: error.message || "Failed to create prompt." });
  }
}

async function updatePromptHandler(req, res) {
  const parsed = promptUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: formatZodErrors(parsed.error) });
  }

  try {
    const ownerEmail = String(req.admin?.email || "").toLowerCase();
    const updates = {};

    if (parsed.data.label || parsed.data.name) {
      updates.label = parsed.data.label || parsed.data.name;
    }

    if (typeof parsed.data.content === "string") {
      updates.content = parsed.data.content;
    }

    if (parsed.data.type) {
      updates.type = parsed.data.type;
    }

    if (
      typeof parsed.data.isPublished === "boolean" ||
      typeof parsed.data.isActive === "boolean"
    ) {
      updates.isActive =
        typeof parsed.data.isPublished === "boolean"
          ? parsed.data.isPublished
          : parsed.data.isActive;
    }

    const result = await updatePrompt(req.params.id, updates, ownerEmail);
    if (!result) {
      return res.status(404).json({ error: "Prompt not found." });
    }

    const { prompt, publishInfo } = result;

    const didEdit =
      "label" in updates || "content" in updates || "type" in updates;
    if (didEdit) {
      await logAdminAction({
        adminEmail: ownerEmail,
        action: "prompt.update",
        target: `prompt:${prompt._id}`,
        metadata: {
          promptId: prompt._id,
          type: prompt.type,
          ownerEmail: prompt.ownerEmail,
          label: prompt.label,
          version: prompt.version,
        },
      });
    }

    if (publishInfo) {
      await logAdminAction({
        adminEmail: ownerEmail,
        action: "prompt.publish",
        target: `prompt:${prompt._id}`,
        metadata: {
          promptId: prompt._id,
          type: prompt.type,
          previousPublishedId: publishInfo.previousPublishedId,
        },
      });
    }

    return res.status(200).json({
      ...prompt.toObject(),
      isPublished: Boolean(prompt.isActive),
    });
  } catch (error) {
    const status = error.status || 500;
    return res
      .status(status)
      .json({ error: error.message || "Failed to update prompt." });
  }
}

async function deletePrompt(req, res) {
  try {
    const ownerEmail = String(req.admin?.email || "").toLowerCase();
    const prompt = await deletePromptService(req.params.id, ownerEmail);

    await logAdminAction({
      adminEmail: ownerEmail,
      action: "prompt.delete",
      target: `prompt:${prompt._id}`,
      metadata: {
        promptId: prompt._id,
        type: prompt.type,
        ownerEmail: prompt.ownerEmail,
        label: prompt.label,
        version: prompt.version,
      },
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    const status = error.status || (error.message.includes("not found") ? 404 : 400);
    return res.status(status).json({ error: error.message });
  }
}

module.exports = {
  listPrompts,
  createPromptHandler,
  updatePromptHandler,
  deletePrompt,
};

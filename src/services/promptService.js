const { Prompt } = require("../models");

const MAX_PROMPTS_PER_ADMIN_PER_TYPE = 4;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function formatPromptTimestamp(date) {
  return new Date(date).toISOString();
}

function buildPromptName(label, ownerEmail, timestamp) {
  const safeLabel = String(label || "").trim();
  const safeOwner = normalizeEmail(ownerEmail);
  const safeTimestamp = formatPromptTimestamp(timestamp || new Date());
  return `${safeLabel} | ${safeOwner} | ${safeTimestamp}`;
}

function createServiceError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function ensureNoExampleOutput(content) {
  if (!content) {
    return;
  }

  const rules = [
    { key: "company", allowed: ["string"] },
    { key: "internal_report", allowed: ["string"] },
    { key: "customer_report", allowed: ["string"] },
  ];

  rules.forEach(({ key, allowed }) => {
    const regex = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, "gi");
    let match;
    while ((match = regex.exec(content)) !== null) {
      const rawValue = match[1].trim();
      const lowerValue = rawValue.toLowerCase();
      const isAllowedLiteral = allowed.some(
        (value) => value.toLowerCase() === lowerValue
      );
      const isTemplateValue = rawValue.includes("$form.") || rawValue.includes("{{");

      if (!isAllowedLiteral && !isTemplateValue) {
        throw createServiceError(
          `Prompt output example for "${key}" must use a placeholder (e.g. "string").`,
          400
        );
      }
    }
  });
}

async function getPublishedPrompt(type) {
  return Prompt.findOne({ type, isActive: true });
}

async function publishPrompt(promptId, actorEmail) {
  const prompt = await Prompt.findById(promptId);
  if (!prompt) {
    throw createServiceError("Prompt not found", 404);
  }

  const currentPublished = await Prompt.findOne({
    type: prompt.type,
    isActive: true,
  });

  if (currentPublished && String(currentPublished._id) === String(prompt._id)) {
    if (!prompt.publishedAt) {
      prompt.publishedAt = new Date();
    }
    if (!prompt.publishedBy) {
      prompt.publishedBy = normalizeEmail(actorEmail);
    }
    await prompt.save();
    return { prompt, previousPublishedId: null, alreadyPublished: true };
  }

  await Prompt.updateMany(
    { type: prompt.type, _id: { $ne: prompt._id } },
    { $set: { isActive: false } }
  );

  prompt.isActive = true;
  prompt.publishedAt = new Date();
  prompt.publishedBy = normalizeEmail(actorEmail);

  try {
    await prompt.save();
  } catch (error) {
    if (error && error.code === 11000) {
      throw createServiceError(
        "Another prompt is already published for this type. Try again.",
        409
      );
    }
    throw error;
  }

  return {
    prompt,
    previousPublishedId: currentPublished ? currentPublished._id : null,
    alreadyPublished: false,
  };
}

async function createPrompt(data, actorEmail) {
  const ownerEmail = normalizeEmail(data.ownerEmail);
  if (!ownerEmail) {
    throw createServiceError("Owner email is required.", 400);
  }

  ensureNoExampleOutput(data.content);

  const existingCount = await Prompt.countDocuments({
    ownerEmail,
    type: data.type,
  });

  if (existingCount >= MAX_PROMPTS_PER_ADMIN_PER_TYPE) {
    throw createServiceError(
      `Prompt limit reached. Max ${MAX_PROMPTS_PER_ADMIN_PER_TYPE} ${data.type} prompts per admin.`,
      409
    );
  }

  const now = new Date();
  const name = buildPromptName(data.label, ownerEmail, now);
  const prompt = new Prompt({
    type: data.type,
    ownerEmail,
    label: data.label,
    name,
    content: data.content,
    isActive: Boolean(data.isActive),
    version: 0,
  });

  await prompt.save();

  if (data.isActive) {
    const publishResult = await publishPrompt(prompt._id, actorEmail || ownerEmail);
    return {
      prompt: publishResult.prompt,
      publishInfo: publishResult,
    };
  }

  return { prompt, publishInfo: null };
}

async function updatePrompt(id, updates, actorEmail) {
  const prompt = await Prompt.findById(id);
  if (!prompt) {
    return null;
  }

  const actor = normalizeEmail(actorEmail);
  const owner = normalizeEmail(prompt.ownerEmail);
  const isOwner = Boolean(owner && actor && owner === actor);

  const wantsPublish = updates.isActive === true;
  const wantsUnpublish = updates.isActive === false;

  const editableKeys = ["label", "content", "type"];
  const hasEditableUpdate = editableKeys.some((key) => key in updates);

  if (prompt.isLocked && hasEditableUpdate) {
    throw createServiceError("Prompt is locked and cannot be edited.", 403);
  }

  if (!isOwner) {
    if (hasEditableUpdate || !wantsPublish) {
      throw createServiceError("Forbidden", 403);
    }
  }

  if (wantsUnpublish) {
    throw createServiceError("Unpublishing is not supported. Publish another prompt instead.", 400);
  }

  if (updates.type && updates.type !== prompt.type) {
    throw createServiceError("Prompt type cannot be changed.", 400);
  }

  let hasChanges = false;

  if (updates.label) {
    prompt.label = updates.label;
    prompt.name = buildPromptName(updates.label, prompt.ownerEmail, prompt.createdAt);
    hasChanges = true;
  }

  if (updates.content && updates.content !== prompt.content) {
    ensureNoExampleOutput(updates.content);
    prompt.content = updates.content;
    const currentVersion =
      typeof prompt.version === "number" && !Number.isNaN(prompt.version)
        ? prompt.version
        : 0;
    prompt.version = currentVersion + 0.5;
    hasChanges = true;
  }

  if (hasChanges) {
    await prompt.save();
  }

  if (wantsPublish) {
    const publishResult = await publishPrompt(prompt._id, actorEmail);
    return { prompt: publishResult.prompt, publishInfo: publishResult };
  }

  return { prompt, publishInfo: null };
}

async function deletePrompt(id, actorEmail) {
  const prompt = await Prompt.findById(id);
  if (!prompt) {
    throw createServiceError("Prompt not found", 404);
  }

  if (prompt.isLocked) {
    throw createServiceError("Prompt is locked and cannot be deleted.", 403);
  }

  const actor = normalizeEmail(actorEmail);
  const owner = normalizeEmail(prompt.ownerEmail);
  if (!owner || owner !== actor) {
    throw createServiceError("Forbidden", 403);
  }

  // Prevent deletion of the last active prompt of a type
  if (prompt.isActive) {
    const activeCount = await Prompt.countDocuments({
      type: prompt.type,
      isActive: true,
    });

    if (activeCount <= 1) {
      throw createServiceError(
        `Cannot delete the last active ${prompt.type} prompt. Please activate another prompt first.`,
        400
      );
    }
  }

  await Prompt.findByIdAndDelete(id);
  return prompt;
}

module.exports = {
  getPublishedPrompt,
  publishPrompt,
  createPrompt,
  updatePrompt,
  deletePrompt,
  buildPromptName,
  normalizeEmail,
};

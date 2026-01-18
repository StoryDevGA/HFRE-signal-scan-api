const { Prompt } = require("../models");
const { 
  createPrompt, 
  updatePrompt,
  deletePrompt: deletePromptService 
} = require("../services/promptService");
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
    return res.status(200).json({ items: prompts });
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
    const prompt = await createPrompt(parsed.data);
    return res.status(201).json(prompt);
  } catch (error) {
    return res.status(500).json({ error: "Failed to create prompt." });
  }
}

async function updatePromptHandler(req, res) {
  const parsed = promptUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: formatZodErrors(parsed.error) });
  }

  try {
    const prompt = await updatePrompt(req.params.id, parsed.data);
    if (!prompt) {
      return res.status(404).json({ error: "Prompt not found." });
    }

    return res.status(200).json(prompt);
  } catch (error) {
    return res.status(500).json({ error: "Failed to update prompt." });
  }
}

async function deletePrompt(req, res) {
  try {
    await deletePromptService(req.params.id);
    return res.status(200).json({ ok: true });
  } catch (error) {
    const status = error.message.includes("not found") ? 404 : 400;
    return res.status(status).json({ error: error.message });
  }
}

module.exports = {
  listPrompts,
  createPromptHandler,
  updatePromptHandler,
  deletePrompt,
};

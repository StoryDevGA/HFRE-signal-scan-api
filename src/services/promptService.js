const { Prompt } = require("../models");

async function getActivePrompt(type) {
  return Prompt.findOne({ type, isActive: true });
}

async function createPrompt(data) {
  const prompt = new Prompt(data);
  await prompt.save();

  if (prompt.isActive) {
    await setActivePrompt(prompt._id, prompt.type);
  }

  return prompt;
}

async function updatePrompt(id, updates) {
  // Increment version if content is changing
  const existingPrompt = await Prompt.findById(id);
  if (!existingPrompt) {
    return null;
  }

  if (updates.content && updates.content !== existingPrompt.content) {
    updates.version = (existingPrompt.version || 1) + 1;
  }

  const prompt = await Prompt.findByIdAndUpdate(id, updates, { new: true });
  if (!prompt) {
    return null;
  }

  if (updates.isActive === true) {
    await setActivePrompt(prompt._id, prompt.type);
  }

  return prompt;
}

async function setActivePrompt(promptId, type) {
  await Prompt.updateMany(
    { type, _id: { $ne: promptId } },
    { $set: { isActive: false } }
  );
}

async function deletePrompt(id) {
  const prompt = await Prompt.findById(id);
  if (!prompt) {
    throw new Error("Prompt not found");
  }

  // Prevent deletion of the last active prompt of a type
  if (prompt.isActive) {
    const activeCount = await Prompt.countDocuments({
      type: prompt.type,
      isActive: true,
    });

    if (activeCount <= 1) {
      throw new Error(
        `Cannot delete the last active ${prompt.type} prompt. Please activate another prompt first.`
      );
    }
  }

  await Prompt.findByIdAndDelete(id);
  return true;
}

module.exports = {
  getActivePrompt,
  createPrompt,
  updatePrompt,
  setActivePrompt,
  deletePrompt,
};

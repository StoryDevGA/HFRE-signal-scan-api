const { Prompt } = require("../models");

async function getActivePrompt(type) {
  return Prompt.findOne({ type, active: true });
}

async function createPrompt(data) {
  const prompt = new Prompt(data);
  await prompt.save();

  if (prompt.active) {
    await setActivePrompt(prompt._id, prompt.type);
  }

  return prompt;
}

async function updatePrompt(id, updates) {
  const prompt = await Prompt.findByIdAndUpdate(id, updates, { new: true });
  if (!prompt) {
    return null;
  }

  if (updates.active === true) {
    await setActivePrompt(prompt._id, prompt.type);
  }

  return prompt;
}

async function setActivePrompt(promptId, type) {
  await Prompt.updateMany(
    { type, _id: { $ne: promptId } },
    { $set: { active: false } }
  );
}

module.exports = {
  getActivePrompt,
  createPrompt,
  updatePrompt,
  setActivePrompt,
};

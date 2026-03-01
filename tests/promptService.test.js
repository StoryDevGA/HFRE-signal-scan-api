const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const promptServicePath = path.resolve(
  __dirname,
  "../src/services/promptService.js"
);
const modelsPath = path.resolve(__dirname, "../src/models/index.js");

function clearMocks() {
  delete require.cache[promptServicePath];
  delete require.cache[modelsPath];
}

function createPromptDoc(overrides = {}) {
  let saveCount = 0;
  const prompt = {
    _id: "prompt-1",
    type: "system",
    ownerEmail: "owner@example.com",
    label: "Original Label",
    name: "Original Label | owner@example.com | 2024-01-01T00:00:00.000Z",
    content: "Original content",
    isActive: false,
    isLocked: false,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    version: 1,
    ...overrides,
  };

  prompt.save = async () => {
    saveCount += 1;
    return prompt;
  };

  return {
    prompt,
    getSaveCount: () => saveCount,
  };
}

function loadServiceWithPromptModel(promptModel) {
  delete require.cache[promptServicePath];
  require.cache[modelsPath] = { exports: { Prompt: promptModel } };
  return require(promptServicePath);
}

test("updatePrompt increments version on label change", async () => {
  const { prompt, getSaveCount } = createPromptDoc();
  const service = loadServiceWithPromptModel({
    findById: async () => prompt,
  });

  const result = await service.updatePrompt(
    "prompt-1",
    { label: "Updated Label" },
    "owner@example.com"
  );

  assert.equal(result.prompt.version, 1.5);
  assert.equal(prompt.label, "Updated Label");
  assert.equal(prompt.name.includes("Updated Label | owner@example.com |"), true);
  assert.equal(getSaveCount(), 1);
  clearMocks();
});

test("updatePrompt increments version on content change", async () => {
  const { prompt, getSaveCount } = createPromptDoc();
  const service = loadServiceWithPromptModel({
    findById: async () => prompt,
  });

  const result = await service.updatePrompt(
    "prompt-1",
    { content: "Updated content" },
    "owner@example.com"
  );

  assert.equal(result.prompt.version, 1.5);
  assert.equal(prompt.content, "Updated content");
  assert.equal(getSaveCount(), 1);
  clearMocks();
});

test("updatePrompt does not increment version for no-op label update", async () => {
  const { prompt, getSaveCount } = createPromptDoc();
  const originalVersion = prompt.version;
  const originalName = prompt.name;
  const service = loadServiceWithPromptModel({
    findById: async () => prompt,
  });

  const result = await service.updatePrompt(
    "prompt-1",
    { label: "Original Label" },
    "owner@example.com"
  );

  assert.equal(result.prompt.version, originalVersion);
  assert.equal(prompt.name, originalName);
  assert.equal(getSaveCount(), 0);
  clearMocks();
});

test("updatePrompt publish-only path keeps version unchanged", async () => {
  const { prompt, getSaveCount } = createPromptDoc({ version: 2 });
  let updateManyCalled = false;
  const service = loadServiceWithPromptModel({
    findById: async () => prompt,
    findOne: async () => null,
    updateMany: async () => {
      updateManyCalled = true;
    },
  });

  const result = await service.updatePrompt(
    "prompt-1",
    { isActive: true },
    "publisher@example.com"
  );

  assert.equal(result.prompt.version, 2);
  assert.equal(prompt.isActive, true);
  assert.equal(updateManyCalled, true);
  assert.equal(getSaveCount(), 1);
  clearMocks();
});

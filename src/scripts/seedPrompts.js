require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const { connectToDatabase } = require("../db/connect");
const { Prompt } = require("../models/prompt");

const AGENT_FILE = path.resolve(
  __dirname,
  "../../../HFRE-Signal-scan V4 Agents.json"
);

function buildPromptName(label, ownerEmail, timestamp) {
  const safeLabel = String(label || "").trim();
  const safeOwner = String(ownerEmail || "").trim().toLowerCase();
  const safeTimestamp = new Date(timestamp || new Date()).toISOString();
  return `${safeLabel} | ${safeOwner} | ${safeTimestamp}`;
}

async function loadMessages() {
  const raw = fs.readFileSync(AGENT_FILE, "utf8");
  const data = JSON.parse(raw);
  const llmNode = data.nodes.find((node) => node?.data?.inputs?.llmMessages);

  if (!llmNode) {
    throw new Error("No LLM node with messages found in Agents.json.");
  }

  const messages = llmNode.data.inputs.llmMessages || [];
  const systemMessage = messages.find((msg) => msg.role === "system");
  const userMessage = messages.find((msg) => msg.role === "user");

  if (!systemMessage || !userMessage) {
    throw new Error("System or user prompt missing in Agents.json.");
  }

  return { system: systemMessage.content, user: userMessage.content };
}

async function seedPrompts() {
  const { system, user } = await loadMessages();
  const ownerEmail = String(process.env.SEED_PROMPT_OWNER_EMAIL || "seed@system")
    .trim()
    .toLowerCase();
  const lockNote = String(
    process.env.SEED_PROMPT_LOCK_NOTE || "Default published prompt (locked)"
  ).trim();
  const [hasSystem, hasUser] = await Promise.all([
    Prompt.findOne({ type: "system" }),
    Prompt.findOne({ type: "user" }),
  ]);

  const inserts = [];
  if (!hasSystem) {
    const label = "HFRE Signal Scan v4 System";
    inserts.push({
      type: "system",
      ownerEmail,
      label,
      name: buildPromptName(label, ownerEmail, new Date()),
      content: system,
      isActive: true,
      isLocked: true,
      lockNote,
      version: 0,
    });
  }
  if (!hasUser) {
    const label = "HFRE Signal Scan v4 User";
    inserts.push({
      type: "user",
      ownerEmail,
      label,
      name: buildPromptName(label, ownerEmail, new Date()),
      content: user,
      isActive: true,
      isLocked: true,
      lockNote,
      version: 0,
    });
  }

  if (!inserts.length) {
    console.log("Prompts already exist. Skipping seed.");
    return;
  }

  await Prompt.insertMany(inserts);
  console.log(`Seeded ${inserts.length} prompt(s).`);
}

async function run() {
  try {
    await connectToDatabase();
    await seedPrompts();
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  }
}

run().catch((error) => {
  console.error("Prompt seed failed:", error);
  process.exit(1);
});

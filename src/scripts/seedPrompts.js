require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const { connectToDatabase } = require("../db/connect");
const { Prompt } = require("../models/prompt");

const AGENT_FILE = path.resolve(
  __dirname,
  "../../HFRE-Signal-scan V4 Agents.json"
);

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
  const [hasSystem, hasUser] = await Promise.all([
    Prompt.findOne({ type: "system" }),
    Prompt.findOne({ type: "user" }),
  ]);

  const inserts = [];
  if (!hasSystem) {
    inserts.push({
      type: "system",
      name: "HFRE Signal Scan v4 System",
      content: system,
      active: true,
      version: 4,
    });
  }
  if (!hasUser) {
    inserts.push({
      type: "user",
      name: "HFRE Signal Scan v4 User",
      content: user,
      active: true,
      version: 4,
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

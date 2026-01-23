require("dotenv").config();

const mongoose = require("mongoose");

const { connectToDatabase } = require("../db/connect");
const { Prompt } = require("../models/prompt");

const LOCK_NOTE = String(
  process.env.LOCK_DEFAULT_PROMPT_NOTE || "Default published prompt (locked)"
).trim();

async function lockPublishedPrompts() {
  const published = await Prompt.find({ isActive: true });
  if (!published.length) {
    console.log("No published prompts found.");
    return;
  }

  let updated = 0;
  for (const prompt of published) {
    prompt.isLocked = true;
    prompt.lockNote = LOCK_NOTE;
    await prompt.save();
    updated += 1;
  }

  console.log(`Locked ${updated} published prompt(s).`);
}

async function run() {
  try {
    await connectToDatabase();
    await lockPublishedPrompts();
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  }
}

run().catch((error) => {
  console.error("Lock defaults failed:", error);
  process.exit(1);
});

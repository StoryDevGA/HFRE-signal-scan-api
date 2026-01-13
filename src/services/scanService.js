const { Submission } = require("../models");
const { llmOutputSchema } = require("../validators/schemas");
const { getActivePrompt } = require("./promptService");
const { runScanAgent } = require("./scanAgent");

function extractAgentOutput(result) {
  if (!result) {
    return null;
  }
  if (result.output) {
    return result.output;
  }
  if (result.response) {
    return result.response;
  }
  return result;
}

function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
}

async function processSubmission(submissionId) {
  const submission = await Submission.findById(submissionId);
  if (!submission) {
    return;
  }

  const [systemPrompt, userPrompt] = await Promise.all([
    getActivePrompt("system"),
    getActivePrompt("user"),
  ]);

  if (!systemPrompt || !userPrompt) {
    submission.status = "failed";
    submission.failure = {
      message: "Active prompts not configured.",
    };
    await submission.save();
    return;
  }

  try {
    const result = await runScanAgent({
      systemPrompt: systemPrompt.content,
      userPrompt: userPrompt.content,
      formInputs: submission.inputs,
    });

    const extracted = extractAgentOutput(result);
    const parsed = parseMaybeJson(extracted);
    const validated = llmOutputSchema.safeParse(parsed);

    if (!validated.success) {
      submission.status = "failed";
      submission.failure = {
        message: "LLM output did not match schema.",
        rawOutput: extracted,
      };
      await submission.save();
      return;
    }

    submission.status = "complete";
    submission.outputs = validated.data;
    submission.promptRefs = {
      systemPromptId: systemPrompt._id,
      userPromptId: userPrompt._id,
      systemPromptVersion: systemPrompt.version,
      userPromptVersion: userPrompt.version,
    };
    submission.failure = undefined;
    await submission.save();
  } catch (error) {
    submission.status = "failed";
    submission.failure = {
      message: error.message || "LLM execution failed.",
    };
    await submission.save();
  }
}

module.exports = {
  processSubmission,
};

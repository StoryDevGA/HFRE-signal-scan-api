const { Submission } = require("../models");
const { llmOutputSchema } = require("../validators/schemas");
const { getActivePrompt } = require("./promptService");
const { runScanAgent } = require("./scanAgent");
const { sendCustomerEmail, sendOwnerEmail } = require("./emailService");

function runScanAgentWithTimeout(params) {
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || "60000");

  if (!timeoutMs || Number.isNaN(timeoutMs) || timeoutMs <= 0) {
    return runScanAgent(params);
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("LLM request timed out."));
    }, timeoutMs);
  });

  return Promise.race([
    runScanAgent(params),
    timeoutPromise,
  ]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

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

async function sendCompletionEmails(submission) {
  const emailStatus = submission.emailStatus || {};
  const errors = [];

  if (!emailStatus.customerSentAt) {
    try {
      await sendCustomerEmail({
        to: submission.inputs.email,
        company: submission.outputs.company,
        customerReport: submission.outputs.customer_report,
      });
      emailStatus.customerSentAt = new Date();
    } catch (error) {
      errors.push(error.message || "Customer email failed.");
    }
  }

  if (!emailStatus.ownerSentAt) {
    try {
      await sendOwnerEmail({
        contactName: submission.inputs.name,
        contactEmail: submission.inputs.email,
        companyName: submission.inputs.company_name,
        homepageUrl: submission.inputs.homepage_url,
        productName: submission.inputs.product_name,
        productPageUrl: submission.inputs.product_page_url,
        confidenceLevel: submission.outputs.metadata?.confidence_level,
        customerReport: submission.outputs.customer_report,
        internalReport: submission.outputs.internal_report,
      });
      emailStatus.ownerSentAt = new Date();
    } catch (error) {
      errors.push(error.message || "Owner email failed.");
    }
  }

  if (errors.length) {
    emailStatus.lastError = errors.join(" | ");
  } else {
    emailStatus.lastError = undefined;
  }

  submission.emailStatus = emailStatus;
  await submission.save();
}

async function processSubmission(submissionId) {
  const submission = await Submission.findById(submissionId);
  if (!submission) {
    return;
  }

  try {
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

    const result = await runScanAgentWithTimeout({
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
    await sendCompletionEmails(submission);
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

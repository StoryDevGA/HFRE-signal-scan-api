const { LlmConfig } = require("../models");

const DEFAULT_MODE = "fixed";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeModelName(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("openai:")) {
    return raw.slice("openai:".length);
  }
  return raw;
}

function normalizeReasoningEffort(value) {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw || raw === "none") return null;
  if (raw === "xhigh") {
    return "high"; // xhigh is coerced to high
  }
  if (["low", "medium", "high"].includes(raw)) {
    return raw;
  }
  return null;
}

function createServiceError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getEnvFallback() {
  const rawModelFixed =
    process.env.LLM_MODEL_FIXED ||
    process.env.LLM_MODEL ||
    process.env.LLM_MODEL_LARGE ||
    process.env.LLM_MODEL_SMALL ||
    "gpt-5.2";
  const normalizedModel = normalizeModelName(rawModelFixed) || "gpt-5.2";
  const modelFixed =
    normalizedModel.toLowerCase() === "gpt-5.2-pro"
      ? "gpt-5.2"
      : normalizedModel;
  const temperature = Number(process.env.LLM_TEMPERATURE || "0.2");
  const resolvedTemperature =
    Number.isNaN(temperature) || temperature < 0 || temperature > 2
      ? 0.2
      : temperature;
  const reasoningEffort = normalizeReasoningEffort(
    process.env.LLM_REASONING_EFFORT
  );

  return {
    mode: DEFAULT_MODE,
    temperature: resolvedTemperature,
    reasoningEffort,
    modelFixed,
  };
}

function normalizeStoredConfig(doc) {
  if (!doc) {
    return null;
  }

  const resolvedRaw = normalizeModelName(
    doc.modelFixed || doc.modelLarge || doc.modelSmall
  );
  const resolvedFixed =
    resolvedRaw && resolvedRaw.toLowerCase() === "gpt-5.2-pro"
      ? "gpt-5.2"
      : resolvedRaw;
  const hasReasoningEffort = Object.prototype.hasOwnProperty.call(
    doc,
    "reasoningEffort"
  );
  return {
    mode: "fixed",
    temperature: doc.temperature ?? null,
    reasoningEffort: hasReasoningEffort ? doc.reasoningEffort ?? null : undefined,
    modelFixed: resolvedFixed || null,
    updatedBy: doc.updatedBy || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function mergeWithEnvFallback(config) {
  const fallback = getEnvFallback();
  if (!config) {
    return fallback;
  }

  return {
    ...config,
    modelFixed: config.modelFixed || fallback.modelFixed,
    reasoningEffort:
      config.reasoningEffort !== undefined
        ? config.reasoningEffort
        : fallback.reasoningEffort,
  };
}

async function getLlmConfigWithFallback() {
  const doc = await LlmConfig.findOne({ key: "global" }).lean();
  if (!doc) {
    return {
      ...getEnvFallback(),
      source: "env",
    };
  }

  return {
    ...mergeWithEnvFallback(normalizeStoredConfig(doc)),
    source: "db",
  };
}

async function upsertLlmConfig(data, actorEmail) {
  if (data.mode && data.mode !== "fixed") {
    throw createServiceError("Auto mode is no longer supported.");
  }
  if (!data.modelFixed) {
    throw createServiceError("Fixed mode requires modelFixed.");
  }

  const existing = await LlmConfig.findOne({ key: "global" }).lean();
  const hasField = (field) =>
    Object.prototype.hasOwnProperty.call(data, field);

  const resolvedModelFixed = hasField("modelFixed")
    ? normalizeModelName(data.modelFixed)
    : existing?.modelFixed ?? existing?.modelLarge ?? existing?.modelSmall ?? null;
  if (resolvedModelFixed && resolvedModelFixed.toLowerCase() === "gpt-5.2-pro") {
    throw createServiceError("gpt-5.2-pro is not allowed for admin configuration.");
  }
  const resolvedTemperature = hasField("temperature")
    ? data.temperature ?? null
    : existing?.temperature ?? null;
  const resolvedReasoningEffort = hasField("reasoningEffort")
    ? normalizeReasoningEffort(data.reasoningEffort)
    : existing?.reasoningEffort ?? null;

  const payload = {
    key: "global",
    mode: "fixed",
    temperature: resolvedTemperature,
    reasoningEffort: resolvedReasoningEffort,
    modelFixed: resolvedModelFixed,
    updatedBy: normalizeEmail(actorEmail),
  };

  const doc = await LlmConfig.findOneAndUpdate(
    { key: "global" },
    payload,
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return normalizeStoredConfig(doc);
}

module.exports = {
  getEnvFallback,
  getLlmConfigWithFallback,
  upsertLlmConfig,
  normalizeModelName,
};

function interpolatePrompt(template, inputs) {
  return template.replace(/\{\{\s*\$form\.([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = inputs[key];
    return value == null ? "" : String(value);
  });
}

async function runScanAgent({ systemPrompt, userPrompt, formInputs }) {
  const { initChatModel } = await import("langchain/chat_models/universal");
  const modelName = process.env.LLM_MODEL || "gpt-4o-mini";
  const temperature = Number(process.env.LLM_TEMPERATURE || "0.2");

  const model = await initChatModel(modelName, {
    temperature,
  });

  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: interpolatePrompt(userPrompt, formInputs),
    },
  ];

  const response = await model.invoke(messages);
  if (response && typeof response === "object" && "content" in response) {
    const content = response.content;
    if (Array.isArray(content)) {
      return content
        .map((part) => (part && part.text ? part.text : ""))
        .join("");
    }
    return content;
  }

  return response;
}

module.exports = {
  interpolatePrompt,
  runScanAgent,
};

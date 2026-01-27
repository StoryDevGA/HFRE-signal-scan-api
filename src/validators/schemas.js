const { z } = require("zod");

const trimmedString = z.string().trim();
const shortText = trimmedString.min(2).max(256);
const longText = trimmedString.min(2).max(20000);

const publicScanSchema = z
  .object({
    name: shortText,
    email: trimmedString.email().max(320),
    company_name: shortText,
    homepage_url: trimmedString.url().max(2048),
    product_name: shortText,
    product_page_url: trimmedString.url().max(2048),
  })
  .strict();

const adminAuthSchema = z
  .object({
    email: trimmedString.email().max(320),
    password: trimmedString.min(8).max(256),
  })
  .strict();

const promptCreateSchema = z
  .object({
    type: z.enum(["system", "user"]),
    label: shortText.optional(),
    name: shortText.optional(),
    content: longText,
    isPublished: z.boolean().optional(),
    isActive: z.boolean().optional(),
    version: z.number().min(0).multipleOf(0.5).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.label || value.name), {
    message: "Prompt label is required.",
  });

const promptUpdateSchema = z
  .object({
    type: z.enum(["system", "user"]).optional(),
    label: shortText.optional(),
    name: shortText.optional(),
    content: longText.optional(),
    isPublished: z.boolean().optional(),
    isActive: z.boolean().optional(),
    version: z.number().min(0).multipleOf(0.5).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

const llmOutputSchema = z
  .object({
    company: shortText,
    internal_report: longText,
    customer_report: longText,
    metadata: z
      .object({
        confidence_level: z.enum(["High", "Medium", "Low"]),
        source_scope: z.literal("Public website only"),
        shareability: z
          .object({
            customer_safe: z.boolean(),
            internal_only: z.boolean(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

const allowedLlmModels = [
  "gpt-5.2",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5.1",
  "gpt-4.1",
  "gpt-4o",
  "gpt-4o-mini",
];
const allowedReasoningEfforts = ["none", "low", "medium", "high", "xhigh"];

const llmConfigSchema = z
  .object({
    mode: z.enum(["fixed"]),
    temperature: z.number().min(0).max(2).nullable(),
    reasoningEffort: z.enum(allowedReasoningEfforts).nullable().optional(),
    modelFixed: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.modelFixed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modelFixed"],
        message: "modelFixed is required when mode is fixed.",
      });
      return;
    }

    if (String(value.modelFixed).toLowerCase() === "gpt-5.2-pro") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modelFixed"],
        message: "gpt-5.2-pro is not allowed for admin configuration.",
      });
      return;
    }

    if (!allowedLlmModels.includes(value.modelFixed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modelFixed"],
        message: `Model must be one of: ${allowedLlmModels.join(", ")}`,
      });
    }
  });

module.exports = {
  publicScanSchema,
  adminAuthSchema,
  promptCreateSchema,
  promptUpdateSchema,
  llmOutputSchema,
  llmConfigSchema,
  allowedLlmModels,
};

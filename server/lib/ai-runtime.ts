import OpenAI from "openai";

export const IS_PRODUCTION = process.env.NODE_ENV === "production";
export const USE_REAL_AI = Boolean(
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
);

export const openai = USE_REAL_AI
  ? new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    })
  : null;

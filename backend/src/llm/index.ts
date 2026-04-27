import { AnthropicProvider } from "./anthropic.js";
import { AzureOpenAiProvider } from "./azure_openai.js";
import type { LlmProvider } from "./provider.js";

export type ProviderName = "anthropic" | "azure_openai";

export function createProvider(): LlmProvider {
  const raw = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();
  const name = raw as ProviderName;

  if (name === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");
    }
    return new AnthropicProvider({
      apiKey,
      model: process.env.ANTHROPIC_MODEL,
    });
  }

  if (name === "azure_openai") {
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
    const missing = Object.entries({
      AZURE_OPENAI_API_KEY: apiKey,
      AZURE_OPENAI_ENDPOINT: endpoint,
      AZURE_OPENAI_API_VERSION: apiVersion,
      AZURE_OPENAI_DEPLOYMENT: deployment,
    })
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length) {
      throw new Error(`LLM_PROVIDER=azure_openai but missing: ${missing.join(", ")}`);
    }
    return new AzureOpenAiProvider({
      apiKey: apiKey as string,
      endpoint: endpoint as string,
      apiVersion: apiVersion as string,
      deployment: deployment as string,
      extractDeployment: process.env.AZURE_OPENAI_EXTRACT_DEPLOYMENT,
      classifyDeployment: process.env.AZURE_OPENAI_CLASSIFY_DEPLOYMENT,
    });
  }

  throw new Error(`Unknown LLM_PROVIDER: "${raw}". Use "anthropic" or "azure_openai".`);
}

export type { LlmProvider, ExtractClaimsResult, ExtractedClaim, LlmUsage } from "./provider.js";

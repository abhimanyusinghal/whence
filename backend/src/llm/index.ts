import { AnthropicProvider } from "./anthropic.js";
import { AzureOpenAiProvider } from "./azure_openai.js";
import { FallbackProvider } from "./fallback.js";
import type { LlmProvider } from "./provider.js";

export type ProviderName = "anthropic" | "azure_openai";

function buildProvider(name: ProviderName): LlmProvider | null {
  if (name === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
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
    if (!apiKey || !endpoint || !apiVersion || !deployment) return null;
    return new AzureOpenAiProvider({
      apiKey,
      endpoint,
      apiVersion,
      deployment,
      extractDeployment: process.env.AZURE_OPENAI_EXTRACT_DEPLOYMENT,
      classifyDeployment: process.env.AZURE_OPENAI_CLASSIFY_DEPLOYMENT,
    });
  }

  return null;
}

function missingEnvFor(name: ProviderName): string {
  if (name === "anthropic") return "ANTHROPIC_API_KEY";
  return "AZURE_OPENAI_API_KEY / AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_VERSION / AZURE_OPENAI_DEPLOYMENT";
}

/**
 * Build the live LlmProvider. Honors:
 *   LLM_PROVIDER          — required. "anthropic" | "azure_openai"
 *   LLM_FALLBACK_PROVIDER — optional. If set and credentialed, wrap the
 *                           primary in a FallbackProvider that retries on
 *                           content-filter errors. Same enum as LLM_PROVIDER.
 */
export function createProvider(): LlmProvider {
  const primaryName = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase() as ProviderName;
  if (primaryName !== "anthropic" && primaryName !== "azure_openai") {
    throw new Error(`Unknown LLM_PROVIDER: "${primaryName}". Use "anthropic" or "azure_openai".`);
  }
  const primary = buildProvider(primaryName);
  if (!primary) {
    throw new Error(
      `LLM_PROVIDER=${primaryName} but missing env: ${missingEnvFor(primaryName)}`,
    );
  }

  const fallbackRaw = (process.env.LLM_FALLBACK_PROVIDER ?? "").toLowerCase();
  if (!fallbackRaw) return primary;
  if (fallbackRaw === primaryName) return primary;
  if (fallbackRaw !== "anthropic" && fallbackRaw !== "azure_openai") {
    console.warn(
      `[llm] LLM_FALLBACK_PROVIDER="${fallbackRaw}" is not a known provider — fallback disabled`,
    );
    return primary;
  }

  const secondary = buildProvider(fallbackRaw as ProviderName);
  if (!secondary) {
    console.warn(
      `[llm] LLM_FALLBACK_PROVIDER=${fallbackRaw} but missing env: ${missingEnvFor(fallbackRaw as ProviderName)} — fallback disabled`,
    );
    return primary;
  }

  console.log(
    `[llm] primary=${primaryName} with content-filter fallback to ${fallbackRaw}`,
  );
  return new FallbackProvider(primary, secondary);
}

export type { LlmProvider, ExtractClaimsResult, ExtractedClaim, LlmUsage } from "./provider.js";

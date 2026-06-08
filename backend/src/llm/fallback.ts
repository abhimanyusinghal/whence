import type { AnalyzeRequest } from "../types.js";
import type {
  ClassifyChainResult,
  ExtractClaimsResult,
  LlmProvider,
} from "./provider.js";
import type { ClassifyChainInput } from "./utils.js";

/**
 * Wraps two providers. Calls primary first; on a content-filter rejection,
 * retries the same call with secondary and returns its result.
 *
 * Why this exists: Azure OpenAI is materially cheaper (~3x) than Anthropic
 * but its content filter blocks legitimate journalism/research articles
 * (medical studies, election coverage, anything with strong-language sources).
 * Anthropic's policy is more permissive on those categories. So we use Azure
 * for the 95% of articles that pass its filter, and pay a few cents extra
 * via Anthropic for the 5% that don't — instead of either taking the cost
 * hit on every request or shipping a product that randomly refuses to work.
 *
 * Non-content-filter errors (network, 5xx, malformed model output) are NOT
 * retried — those are the primary's problem to surface; falling back would
 * just double the latency and confuse the error story.
 */
function isContentFilterError(err: unknown): boolean {
  const e = err as { code?: string; status?: number; message?: string };
  if (e?.code === "content_filter") return true;
  if (typeof e?.message === "string") {
    return /content management policy|content_filter|content[_ ]filter|responsibleaipolicyviolation/i.test(
      e.message,
    );
  }
  return false;
}

export class FallbackProvider implements LlmProvider {
  readonly name: string;
  readonly modelLabel: string;
  readonly extractModelLabel: string;
  readonly classifyModelLabel: string;

  constructor(
    private readonly primary: LlmProvider,
    private readonly secondary: LlmProvider,
  ) {
    this.name = `${primary.name}+fallback:${secondary.name}`;
    this.modelLabel = primary.modelLabel;
    this.extractModelLabel = primary.extractModelLabel;
    this.classifyModelLabel = primary.classifyModelLabel;
  }

  async extractClaims(input: AnalyzeRequest): Promise<ExtractClaimsResult> {
    try {
      return await this.primary.extractClaims(input);
    } catch (err) {
      if (!isContentFilterError(err)) throw err;
      console.warn(
        `[llm_fallback] extractClaims: ${this.primary.name} blocked by content filter, retrying with ${this.secondary.name}`,
      );
      return this.secondary.extractClaims(input);
    }
  }

  async classifyChain(input: ClassifyChainInput): Promise<ClassifyChainResult> {
    try {
      return await this.primary.classifyChain(input);
    } catch (err) {
      if (!isContentFilterError(err)) throw err;
      console.warn(
        `[llm_fallback] classifyChain: ${this.primary.name} blocked by content filter, retrying with ${this.secondary.name}`,
      );
      return this.secondary.classifyChain(input);
    }
  }
}

import { AzureOpenAI } from "openai";
import type { AnalyzeRequest, ProvenanceChain } from "../types.js";
import {
  type ClassifyChainResult,
  type ExtractedClaim,
  type ExtractClaimsResult,
  type LlmProvider,
} from "./provider.js";
import {
  buildClassifyUserMessage,
  buildExtractUserMessage,
  CLASSIFY_CHAIN_SCHEMA,
  type ClassifyChainInput,
  EXTRACT_CLAIMS_SCHEMA,
  loadPrompt,
} from "./utils.js";
import { dropUnknownNodes } from "./validation.js";

/**
 * Uses the Responses API (POST /responses) instead of Chat Completions.
 * This is the modern endpoint and is required for "pro" / reasoning-class
 * models (e.g. gpt-5.4-pro). Smaller models like gpt-5.4-nano also accept it.
 *
 * Requires Azure API version >= 2025-03-01-preview.
 */
export class AzureOpenAiProvider implements LlmProvider {
  readonly name = "azure_openai";
  readonly modelLabel: string;
  private extractClient: AzureOpenAI;
  private classifyClient: AzureOpenAI;
  private extractDeployment: string;
  private classifyDeployment: string;

  constructor(opts: {
    apiKey: string;
    endpoint: string;
    apiVersion: string;
    deployment: string;
    extractDeployment?: string;
    classifyDeployment?: string;
  }) {
    this.extractDeployment = opts.extractDeployment ?? opts.deployment;
    this.classifyDeployment = opts.classifyDeployment ?? opts.deployment;
    this.extractClient = new AzureOpenAI({
      apiKey: opts.apiKey,
      endpoint: opts.endpoint,
      apiVersion: opts.apiVersion,
      deployment: this.extractDeployment,
    });
    this.classifyClient = new AzureOpenAI({
      apiKey: opts.apiKey,
      endpoint: opts.endpoint,
      apiVersion: opts.apiVersion,
      deployment: this.classifyDeployment,
    });
    this.modelLabel =
      this.extractDeployment === this.classifyDeployment
        ? `azure:${this.extractDeployment}`
        : `azure:extract=${this.extractDeployment},classify=${this.classifyDeployment}`;
  }

  async extractClaims(input: AnalyzeRequest): Promise<ExtractClaimsResult> {
    const system = await loadPrompt("extract_claims");

    const response = await this.extractClient.responses.create({
      model: this.extractDeployment,
      max_output_tokens: 8192,
      instructions: system,
      input: buildExtractUserMessage(input),
      text: {
        format: {
          type: "json_schema",
          name: "extract_claims",
          strict: true,
          schema: EXTRACT_CLAIMS_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });

    const text = response.output_text;
    if (!text) {
      throw new Error(`Azure OpenAI: empty response (status=${response.status})`);
    }

    const parsed = JSON.parse(text) as { claims: ExtractedClaim[] };

    const usage = response.usage;
    return {
      claims: parsed.claims,
      usage: {
        input_tokens: usage?.input_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? 0,
        cache_read_input_tokens: usage?.input_tokens_details?.cached_tokens ?? 0,
        cache_creation_input_tokens: 0,
      },
    };
  }

  async classifyChain(input: ClassifyChainInput): Promise<ClassifyChainResult> {
    const system = await loadPrompt("classify_chain");

    const response = await this.classifyClient.responses.create({
      model: this.classifyDeployment,
      max_output_tokens: 16384,
      instructions: system,
      input: buildClassifyUserMessage(input),
      text: {
        format: {
          type: "json_schema",
          name: "classify_chain",
          strict: true,
          schema: CLASSIFY_CHAIN_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });

    const text = response.output_text;
    if (!text) {
      throw new Error(`Azure OpenAI: empty response (status=${response.status})`);
    }

    const raw = JSON.parse(text) as Omit<ProvenanceChain, "claim_id">;
    const chain = dropUnknownNodes(raw, input);

    const usage = response.usage;
    return {
      chain,
      usage: {
        input_tokens: usage?.input_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? 0,
        cache_read_input_tokens: usage?.input_tokens_details?.cached_tokens ?? 0,
        cache_creation_input_tokens: 0,
      },
    };
  }
}

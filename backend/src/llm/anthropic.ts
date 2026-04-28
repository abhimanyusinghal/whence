import Anthropic from "@anthropic-ai/sdk";
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

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly modelLabel: string;
  readonly extractModelLabel: string;
  readonly classifyModelLabel: string;
  private client: Anthropic;
  private model: string;

  constructor(opts: { apiKey: string; model?: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? "claude-sonnet-4-6";
    this.modelLabel = this.model;
    this.extractModelLabel = `anthropic:${this.model}`;
    this.classifyModelLabel = `anthropic:${this.model}`;
  }

  async extractClaims(input: AnalyzeRequest): Promise<ExtractClaimsResult> {
    const system = await loadPrompt("extract_claims");

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: [
        {
          name: "submit_claims",
          description: "Submit the extracted checkable claims from the article.",
          input_schema: EXTRACT_CLAIMS_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "submit_claims" },
      messages: [{ role: "user", content: buildExtractUserMessage(input) }],
    });

    const toolUseBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUseBlock) {
      throw new Error(
        `Anthropic: expected tool_use, got ${response.content.map((b) => b.type).join(", ")}`,
      );
    }

    const parsed = toolUseBlock.input as { claims: ExtractedClaim[] };

    return {
      claims: parsed.claims,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }

  async classifyChain(input: ClassifyChainInput): Promise<ClassifyChainResult> {
    const system = await loadPrompt("classify_chain");

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: [
        {
          name: "submit_chain",
          description: "Submit the assembled provenance chain for the claim.",
          input_schema: CLASSIFY_CHAIN_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "submit_chain" },
      messages: [{ role: "user", content: buildClassifyUserMessage(input) }],
    });

    const toolUseBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUseBlock) {
      throw new Error(
        `Anthropic: expected tool_use, got ${response.content.map((b) => b.type).join(", ")}`,
      );
    }

    const raw = toolUseBlock.input as Omit<ProvenanceChain, "claim_id">;
    const chain = dropUnknownNodes(raw, input);

    return {
      chain,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

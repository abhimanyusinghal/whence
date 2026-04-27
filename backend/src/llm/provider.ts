import type { AnalyzeRequest, Claim, ProvenanceChain } from "../types.js";
import type { ClassifyChainInput } from "./utils.js";

export type ExtractedClaim = Omit<Claim, "id">;

export type LlmUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

export type ExtractClaimsResult = {
  claims: ExtractedClaim[];
  usage: LlmUsage;
};

export type ClassifyChainResult = {
  chain: Omit<ProvenanceChain, "claim_id">;
  usage: LlmUsage;
};

export interface LlmProvider {
  readonly name: string;
  readonly modelLabel: string;
  extractClaims(input: AnalyzeRequest): Promise<ExtractClaimsResult>;
  classifyChain(input: ClassifyChainInput): Promise<ClassifyChainResult>;
}

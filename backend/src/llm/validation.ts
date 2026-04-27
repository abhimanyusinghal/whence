import type { ProvenanceChain, ProvenanceNode } from "../types.js";
import type { ClassifyChainInput } from "./utils.js";

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    let s = url.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

/**
 * The model is told never to invent URLs, but enforce it anyway.
 * Drop any node whose URL isn't the article itself or in the candidate set.
 * Filter `links_to_upstream` to the same allow-list.
 */
export function dropUnknownNodes(
  raw: Omit<ProvenanceChain, "claim_id">,
  input: ClassifyChainInput,
): Omit<ProvenanceChain, "claim_id"> {
  const allowed = new Set<string>();
  allowed.add(normalizeUrl(input.article_url));
  for (const c of input.candidates) allowed.add(normalizeUrl(c.url));
  if (input.claim.inline_link) allowed.add(normalizeUrl(input.claim.inline_link));

  const cleanedNodes: ProvenanceNode[] = [];
  let droppedCount = 0;

  for (const node of raw.nodes ?? []) {
    if (!allowed.has(normalizeUrl(node.url))) {
      droppedCount++;
      console.warn(`[classify] dropping invented node: ${node.url}`);
      continue;
    }
    cleanedNodes.push({
      ...node,
      links_to_upstream: (node.links_to_upstream ?? []).filter((u) =>
        allowed.has(normalizeUrl(u)),
      ),
    });
  }

  let notes = raw.notes ?? "";
  if (droppedCount > 0) {
    notes = `${notes} [dropped ${droppedCount} invented URL(s)]`.trim();
  }

  return {
    status: raw.status,
    hop_count: raw.hop_count,
    nodes: cleanedNodes,
    notes,
  };
}

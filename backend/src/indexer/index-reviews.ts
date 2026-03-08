// indexer/index-reviews.ts — Embeds code review notes into the Qdrant "reviews" collection.

import { logger } from "../config/logger.js";
import { ensureCollection, rawQdrant } from "../mastra/infra.js";
import { embedTexts, toUUID } from "./embed.js";

const COLLECTION = "reviews";

export interface ReviewNote {
  text: string;
  severity: "info" | "warning" | "critical";
  category: "convention" | "bug" | "security" | "pattern" | "architecture";
  filePath: string;
  commitSha: string;
  author: string;
  date: string;
  mergeMessage: string;
}

function reviewId(commitSha: string, index: number): string {
  return toUUID(`${COLLECTION}:${commitSha}:${index}`);
}

export async function indexReviewNotes(notes: ReviewNote[]): Promise<{ chunks: number }> {
  if (notes.length === 0) return { chunks: 0 };

  await ensureCollection(COLLECTION);

  const embeddings = await embedTexts(notes.map((n) => n.text));

  await rawQdrant.upsert(COLLECTION, {
    wait: true,
    points: notes.map((n, i) => ({
      id: reviewId(n.commitSha, i),
      vector: embeddings[i],
      payload: {
        text: n.text,
        severity: n.severity,
        category: n.category,
        filePath: n.filePath,
        commitSha: n.commitSha,
        author: n.author,
        date: n.date,
        mergeMessage: n.mergeMessage,
      },
    })),
  });

  logger.info({ chunks: notes.length }, "Review notes indexed");
  return { chunks: notes.length };
}

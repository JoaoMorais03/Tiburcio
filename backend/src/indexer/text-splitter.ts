// indexer/text-splitter.ts — Recursive text splitter replacing @mastra/rag MDocument.
// Splits text by paragraphs then sentences to stay under maxSize with overlap.

export interface TextChunk {
  text: string;
}

function splitBySentences(paragraph: string, maxSize: number): string[] {
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxSize) {
      current = candidate;
    } else {
      if (current) parts.push(current);
      current = sentence.slice(0, maxSize);
    }
  }
  if (current) parts.push(current);
  return parts;
}

function flushParagraph(
  chunks: TextChunk[],
  current: string,
  overlap: number,
  paragraph: string,
): string {
  chunks.push({ text: current });
  const overlapText = current.slice(-overlap);
  return overlapText ? `${overlapText}\n\n${paragraph}` : paragraph;
}

export function splitText(text: string, maxSize = 1000, overlap = 100): TextChunk[] {
  if (text.length <= maxSize) return [{ text }];

  const chunks: TextChunk[] = [];
  const paragraphs = text.split(/\n{2,}/);
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxSize) {
      current = candidate;
    } else if (current) {
      current = flushParagraph(chunks, current, overlap, paragraph);
    } else {
      for (const part of splitBySentences(paragraph, maxSize)) {
        chunks.push({ text: part });
      }
    }
  }

  if (current.trim()) chunks.push({ text: current });
  return chunks.length > 0 ? chunks : [{ text: text.slice(0, maxSize) }];
}

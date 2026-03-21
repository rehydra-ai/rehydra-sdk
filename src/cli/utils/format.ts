import type {
  AnonymizationResult,
  AnonymizationStats,
  PIIType,
} from "../../types/index.js";
import { bold, dim, piiTypeColor } from "./color.js";

export function formatText(result: AnonymizationResult): string {
  return result.anonymizedText;
}

export function formatJson(result: AnonymizationResult): string {
  const output = {
    anonymizedText: result.anonymizedText,
    entities: result.entities.map((e) => ({
      type: e.type,
      id: e.id,
      confidence: e.confidence,
      source: e.source,
      ...(e.semantic !== undefined ? { semantic: e.semantic } : {}),
    })),
    stats: {
      totalEntities: result.stats.totalEntities,
      countsByType: result.stats.countsByType,
      processingTimeMs: result.stats.processingTimeMs,
    },
  };
  return JSON.stringify(output, null, 2);
}

export function formatNdjson(result: AnonymizationResult): string {
  const lines = result.entities.map((e) =>
    JSON.stringify({
      type: e.type,
      id: e.id,
      confidence: e.confidence,
      source: e.source,
      ...(e.semantic !== undefined ? { semantic: e.semantic } : {}),
    }),
  );
  // Also include a summary line
  lines.push(
    JSON.stringify({
      _type: "summary",
      anonymizedText: result.anonymizedText,
      totalEntities: result.stats.totalEntities,
      processingTimeMs: result.stats.processingTimeMs,
    }),
  );
  return lines.join("\n");
}

interface InspectEntity {
  type: PIIType;
  original: string;
  start: number;
  end: number;
}

export function formatInspect(
  originalText: string,
  entities: InspectEntity[],
): string {
  // Sort entities by position descending so replacements don't shift offsets
  const sorted = [...entities].sort((a, b) => b.start - a.start);

  let result = originalText;
  for (const entity of sorted) {
    const colorFn = piiTypeColor(entity.type);
    const label = colorFn(`[${entity.type}: ${entity.original}]`);
    result = result.slice(0, entity.start) + label + result.slice(entity.end);
  }

  return result;
}

export function formatStats(stats: AnonymizationStats): string {
  const lines: string[] = [];
  lines.push(
    `  ${bold("Found")} ${stats.totalEntities} PII ${stats.totalEntities === 1 ? "entity" : "entities"}:`,
  );
  for (const [type, count] of Object.entries(stats.countsByType)) {
    if (count > 0) {
      const colorFn = piiTypeColor(type as PIIType);
      lines.push(`    ${colorFn(type)}  ${count}`);
    }
  }
  lines.push(dim(`  Processing time: ${stats.processingTimeMs}ms`));
  return lines.join("\n");
}

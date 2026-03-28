import { DEFAULT_TAG_FORMAT } from "../../types/index.js";
import type { TagFormat } from "../../types/index.js";
import type { ParsedOptions } from "../main.js";

export function buildTagFormatFromOptions(options: ParsedOptions): TagFormat {
  return {
    open: options["tag-open"] ?? DEFAULT_TAG_FORMAT.open,
    close: options["tag-close"] ?? DEFAULT_TAG_FORMAT.close,
    keyword: options["tag-keyword"] ?? DEFAULT_TAG_FORMAT.keyword,
  };
}

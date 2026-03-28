import { DEFAULT_TAG_FORMAT } from "../../types/index.js";
import type { TagFormat } from "../../types/index.js";
import type { ParsedOptions } from "../main.js";

export function buildTagFormatFromOptions(options: ParsedOptions): TagFormat {
  const open = options["tag-open"];
  const close = options["tag-close"];
  const keyword = options["tag-keyword"];
  return {
    open: open !== undefined && open !== "" ? open : DEFAULT_TAG_FORMAT.open,
    close: close !== undefined && close !== "" ? close : DEFAULT_TAG_FORMAT.close,
    keyword: keyword !== undefined && keyword !== "" ? keyword : DEFAULT_TAG_FORMAT.keyword,
  };
}

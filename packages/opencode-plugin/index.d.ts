export { createRehydraPlugin } from "rehydra/opencode-plugin";
export type { RehydraPluginOptions } from "rehydra/opencode-plugin";
export declare const rehydra: (input: {
  client: unknown;
  directory: string;
  worktree: string;
  [key: string]: unknown;
}) => Promise<Record<string, unknown>>;
export default rehydra;

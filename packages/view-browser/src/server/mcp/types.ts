import type { BrowserService } from '../service.ts';
import type { DebugState } from './debug-state.ts';

export const TEXT_CAP = 20_000;

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export interface ToolProp {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object';
  description?: string;
  additionalProperties?: { type: 'string' };
  enum?: readonly string[];
}

export interface ToolSchema {
  type: 'object';
  properties: Record<string, ToolProp>;
  required?: readonly string[];
}

export interface ToolContext {
  service: BrowserService;
  /** Loads the settings and starts the browser. */
  ready(): Promise<void>;
  /** Folder of the view's own files (traces are written below it). */
  dataDir: string;
  debug: DebugState;
}

export type ToolArgs = Record<string, unknown>;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: ToolSchema;
  run(args: ToolArgs, ctx: ToolContext): Promise<ToolResult>;
}

/** Text cut to `TEXT_CAP`; when cut, the text ends with `hint` (names the parameter that fetches more). */
export function capText(text: string, hint: string): string {
  if (text.length <= TEXT_CAP) return text;
  const tail = `\n... [cut: showing about ${TEXT_CAP} of ${text.length} chars] ${hint}`;
  return text.slice(0, TEXT_CAP - tail.length) + tail;
}

export const textResult = (text: string, hint = 'Ask for less output.'): ToolResult => ({ content: [{ type: 'text', text: capText(text, hint) }] });
export const failResult = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

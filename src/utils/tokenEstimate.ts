/**
 * Rough token estimate (~3.5 chars/token for code-heavy English text).
 * This intentionally avoids pulling in a full tokenizer dependency; it's used only
 * for budgeting decisions, not for exact billing.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

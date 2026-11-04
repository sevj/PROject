export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startClaudeUsageSync } = await import("./server/claude-usage/scheduler");
    startClaudeUsageSync();
  }
}

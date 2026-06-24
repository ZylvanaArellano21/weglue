import Anthropic from "@anthropic-ai/sdk";

export function createClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

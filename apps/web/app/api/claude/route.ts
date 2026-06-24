import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/claude";

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json(
      { error: "messages array is required" },
      { status: 400 }
    );
  }

  const client = createClient();

  const response = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    messages,
  });

  return NextResponse.json(response);
}

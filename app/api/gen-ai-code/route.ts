import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { db } from "@/lib/prisma";
import { CREDIT_COST_PER_GENERATION } from "@/lib/constants";
import type { Message, FileData } from "@/types/workspace";
import { aj } from "@/lib/arcjet";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ─── SSE helper ───────────────────────────────────────────────────────────────

function sseEvent(type: string, payload: unknown): string {
  return `data: ${JSON.stringify({ type, ...(payload as object) })}\n\n`;
}

// ─── Extract short label from a Gemini thought chunk ─────────────────────────
// Gemini thoughts often start with a bold heading like **Verify Config**
// We extract that. If no bold heading, take the first sentence only.

function extractThoughtLabel(text: string): string | null {
  // Try to grab **bold heading** at the start
  const boldMatch = text.match(/\*\*([^*]{4,60})\*\*/);
  if (boldMatch) return boldMatch[1].trim();

  // Fall back to first sentence (up to first . or \n), capped at 60 chars
  const sentence = text.split(/[.\n]/)[0].trim();
  if (sentence.length >= 8 && sentence.length <= 80) return sentence;

  return null;
}

// ─── npm validation ───────────────────────────────────────────────────────────

async function validateDependencies(
  deps: Record<string, string>,
): Promise<Record<string, string>> {
  const valid: Record<string, string> = {};
  await Promise.all(
    Object.entries(deps).map(async ([pkg, version]) => {
      try {
        const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok) valid[pkg] = version;
      } catch {
        // silently skip hallucinated packages
      }
    }),
  );
  return valid;
}

// ─── History trimming ─────────────────────────────────────────────────────────

function trimHistory(messages: Message[]): Message[] {
  if (messages.length <= 10) return messages;
  return [messages[0], ...messages.slice(-8)];
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert React developer. Your job is to generate complete, working React applications based on user prompts.

RULES:
1. Always respond with a valid JSON object — no markdown fences, no extra text.
2. The JSON must match this exact shape:
{
  "assistantMessage": "<brief explanation of what you built/changed>",
  "title": "<short 2-4 word title for the app, e.g. 'Todo List App'>",
  "files": {
    "/App.js": { "code": "<full file content>" },
    "/components/SomeComponent.js": { "code": "<full file content>" }
  },
  "dependencies": {
    "some-package": "latest"
  }
}
3. Use React (functional components + hooks). Do NOT use TypeScript in generated files.
4. Use Tailwind CSS for all styling. Do not use CSS modules or inline styles unless absolutely necessary.
5. The entry point must always be /App.js and must export a default component.
6. All imports must reference files you include in "files" or packages in "dependencies".
7. Do not include react, react-dom, or tailwindcss in "dependencies" — they are always available.
8. When modifying existing code, include ALL files (both changed and unchanged) in "files".
9. Keep code clean, readable, and production-quality.
10. If the user attaches an image, use it as a design reference and match the layout/style as closely as possible.`;

// ─── Gemini contents builder ──────────────────────────────────────────────────

function buildContents(messages: Message[], fileData: FileData | null) {
  const trimmed = trimHistory(messages);

  return trimmed.map((msg, idx) => {
    const role = msg.role === "assistant" ? "model" : "user";

    if (msg.role === "user") {
      const parts: object[] = [];

      let text = msg.content;

      if (msg.imageUrl) {
        text = `[The user has attached an image. Use this URL directly in the generated app where relevant (as img src, background-image, etc.): ${msg.imageUrl}]\n\n${text}`;
      }

      const isLast = idx === trimmed.length - 1;
      if (isLast && fileData) {
        text +=
          "\n\nCurrent project files for context:\n" +
          JSON.stringify(fileData, null, 2);
      }

      parts.push({ text });
      return { role, parts };
    }

    return { role, parts: [{ text: msg.content }] };
  });
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Resource-level auth check: this Route Handler protects itself instead of
  // relying on proxy.ts (Next's middleware) to gate it. auth() reads the
  // Clerk session cookie/JWT off the request; if there's no signed-in user,
  // we bail out with a 401 before touching the database or Gemini.
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { workspaceId, userId, messages, fileData } = body as {
    workspaceId: string | null;
    userId: string;
    messages: Message[];
    fileData: FileData | null;
  };

  if (!messages?.length) {
    return Response.json({ message: "No messages provided" }, { status: 400 });
  }

  // ── Arcjet: rate limit, prompt injection, sensitive info ──────────────────
  // detectPromptInjectionMessage requires the actual user text to inspect.

  // const arcjetReq = new Request(request.url, {
  //   method: request.method,
  //   headers: request.headers,
  //   body: JSON.stringify(body),
  // });

  // const lastUserMessage =
  //   [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  // const decision = await aj.protect(arcjetReq, {
  //   requested: 1,
  //   userId: clerkId,
  //   detectPromptInjectionMessage: lastUserMessage,
  // });

  // if (decision.isDenied()) {
  //   return Response.json(
  //     { message: decision.reason?.type ?? "Request blocked" },
  //     { status: 429 }
  //   );
  // }

  // `userId` above came from the client's request body, so it's not trusted
  // on its own — anyone could put any id in a JSON payload. Requiring BOTH
  // id AND clerkId to match in the same query means the lookup only
  // succeeds if the row actually belongs to *this* signed-in session; a
  // spoofed userId for someone else's account just returns no user (404
  // below), never their data.
  const user = await db.user.findUnique({
    where: { id: userId, clerkId },
    select: { id: true, credits: true },
  });

  if (!user)
    return Response.json({ message: "User not found" }, { status: 404 });
  if (user.credits < CREDIT_COST_PER_GENERATION) {
    return Response.json({ message: "Insufficient credits" }, { status: 402 });
  }

  // ── Streaming the response back to the browser ──────────────────────────
  // We return this ReadableStream directly as the Response body. That lets
  // us `enqueue()` SSE events (see sseEvent() above) the moment we have
  // something to say — "Validating packages…", "Saving…" — instead of
  // making the user stare at a blank screen until the entire generation
  // finishes. WorkspaceClient.tsx reads this same stream chunk-by-chunk on
  // the other end (see the reader.read() loop there).
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) =>
        controller.enqueue(encoder.encode(chunk));

      try {
        const contents = buildContents(messages, fileData);

        // GEMINI_API_KEY (env var, read at module load in `ai` above) authenticates
        // this call. generateContentStream (not generateContent) is what lets
        // us forward Gemini's own "thinking" output as status updates below —
        // a blocking call would only give us the final answer, all at once.
        const geminiStream = await ai.models.generateContentStream({
          model: "gemini-3.5-flash",
          contents,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0.7,
            responseMimeType: "application/json",
            thinkingConfig: {
              includeThoughts: true,
            },
          },
        });

        let accumulated = ""; // final JSON output
        let lastEmitTime = 0; // throttle thought emissions

        for await (const chunk of geminiStream) {
          const parts = chunk.candidates?.[0]?.content?.parts ?? [];

          for (const part of parts) {
            if (!part.text) continue;

            if (part.thought) {
              // Extract just the short label — not the full wall of text
              const now = Date.now();
              if (now - lastEmitTime > 600) {
                const label = extractThoughtLabel(part.text);
                if (label) {
                  enqueue(sseEvent("status", { message: label }));
                  lastEmitTime = now;
                }
              }
            } else {
              // Actual JSON output
              accumulated += part.text;
            }
          }
        }

        // ── Parse the complete JSON response ──────────────────────────────────

        let parsed: {
          assistantMessage: string;
          title?: string;
          files: Record<string, { code: string }>;
          dependencies: Record<string, string>;
        };

        try {
          parsed = JSON.parse(accumulated);
        } catch {
          enqueue(
            sseEvent("error", {
              message: "AI returned invalid JSON. Please try again.",
            }),
          );
          controller.close();
          return;
        }

        const {
          assistantMessage,
          title: aiTitle,
          files,
          dependencies,
        } = parsed;

        if (!files || typeof files !== "object") {
          enqueue(
            sseEvent("error", {
              message: "AI response missing files. Please try again.",
            }),
          );
          controller.close();
          return;
        }

        // ── Validate npm packages ──────────────────────────────────────────────

        enqueue(sseEvent("status", { message: "Validating packages…" }));
        const validatedDeps = await validateDependencies(dependencies ?? {});
        const newFileData: FileData = {
          files,
          dependencies: validatedDeps,
          title: aiTitle,
        };

        // ── Upsert workspace + deduct credit (single transaction) ──────────────
        // Prisma's $transaction runs both writes as one atomic unit: either
        // the workspace gets saved AND the credit gets deducted, or neither
        // does. Without this, a crash between the two writes could save the
        // generated app for free (deduction skipped) or charge a credit for
        // a generation that never got saved — both writes must succeed or
        // fail together.

        enqueue(sseEvent("status", { message: "Saving…" }));

        const lastUserMessage = messages[messages.length - 1];
        const updatedMessages: Message[] = [
          ...messages,
          { role: "assistant", content: assistantMessage },
        ];

        const [workspace] = await db.$transaction([
          workspaceId
            ? db.workspace.update({
                where: { id: workspaceId, userId },
                data: {
                  messages: updatedMessages as never,
                  fileData: newFileData as never,
                },
              })
            : db.workspace.create({
                data: {
                  userId,
                  title: aiTitle ?? lastUserMessage.content.slice(0, 80),
                  messages: updatedMessages as never,
                  fileData: newFileData as never,
                },
              }),
          db.user.update({
            where: { id: userId },
            data: { credits: { decrement: CREDIT_COST_PER_GENERATION } },
          }),
        ]);

        const updatedUser = await db.user.findUnique({
          where: { id: userId },
          select: { credits: true },
        });

        // ── Emit final result ──────────────────────────────────────────────────

        enqueue(
          sseEvent("done", {
            workspaceId: workspace.id,
            assistantMessage,
            fileData: newFileData,
            creditsRemaining:
              updatedUser?.credits ?? user.credits - CREDIT_COST_PER_GENERATION,
          }),
        );
      } catch (err) {
        console.error("[gen-ai-code] stream error:", err);
        // Gemini itself being overloaded (503/UNAVAILABLE) is common and
        // transient — tell the user that specifically instead of a generic
        // "something went wrong," so retrying feels like the obvious next
        // step rather than a shot in the dark.
        const isOverloaded =
          typeof err === "object" &&
          err !== null &&
          "status" in err &&
          err.status === 503;
        enqueue(
          sseEvent("error", {
            message: isOverloaded
              ? "Gemini is currently overloaded. Please wait a moment and try again."
              : "Something went wrong. Please try again.",
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export const runtime = "nodejs";
export const maxDuration = 300; // for vercel - 300s on Fluid

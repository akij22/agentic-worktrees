import { createServer, type Server } from "node:http";
/** Synthetic Responses boundary matching OpenAI Codex rust-v0.154.0 test events.
 * Only inert fixture turns are accepted. Request bodies and headers are never logged or retained. */
export async function localResponsesFixture(toolName?: string) {
  let sequence = 0;
  const server: Server = createServer(async (request, response) => {
    for await (const chunk of request) {
      void chunk;
    }
    if (request.method !== "POST" || !request.url?.endsWith("/responses")) {
      response.writeHead(404).end();
      return;
    }
    const id = `response-${++sequence}`;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const events = [
      { type: "response.created", response: { id } },
      {
        type: "response.output_item.done",
        item:
          sequence % 2 === 1 && toolName
            ? {
                type: "function_call",
                name: toolName.split("__").at(-1),
                namespace: toolName.split("__").slice(0, -1).join("__"),
                call_id: `synthetic-call-${sequence}`,
                arguments: "{}",
              }
            : {
                type: "message",
                role: "assistant",
                id: `message-${sequence}`,
                content: [{ type: "output_text", text: "SYNTHETIC_DONE" }],
              },
      },
      {
        type: "response.completed",
        response: {
          id,
          usage: {
            input_tokens: 0,
            input_tokens_details: null,
            output_tokens: 0,
            output_tokens_details: null,
            total_tokens: 0,
          },
        },
      },
    ];
    response.end(
      events
        .map(
          (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        )
        .join(""),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Local Responses fixture unavailable.");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

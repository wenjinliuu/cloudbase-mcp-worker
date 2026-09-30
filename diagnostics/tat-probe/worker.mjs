// Read-only TAT hosted MCP diagnostics. Never forwards tools/call.
const ORIGIN = "https://mcp-api.tencent-cloud.com";
const reply = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

async function* events(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > 256 * 1024) throw new Error("stream_limit");
      buffer += decoder.decode(part.value, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        let event = "message";
        const data = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (data.length) yield { event, data: data.join("\n") };
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function probe(upstream, requestFetch = fetch, timeoutMs = 20000) {
  const started = Date.now();
  const result = { ok: false, stage: "configuration", elapsed_ms: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let iterator;
  try {
    const url = new URL(upstream);
    if (url.origin !== ORIGIN || !url.pathname.startsWith("/sse/") || url.username || url.password || url.search || url.hash) throw new Error("invalid_upstream");
    result.stage = "sse_connect";
    const response = await requestFetch(url, { headers: { Accept: "text/event-stream" }, redirect: "manual", signal: controller.signal });
    result.http_status = response.status;
    result.content_type = (response.headers.get("content-type") || "").split(";")[0];
    if (!response.ok) throw new Error("upstream_http_error");
    if (result.content_type !== "text/event-stream" || !response.body) throw new Error("unexpected_content_type");
    iterator = events(response.body)[Symbol.asyncIterator]();
    result.stage = "sse_endpoint";
    let endpoint;
    for (let i = 0; i < 32; i++) {
      const item = await iterator.next();
      if (item.done) throw new Error("stream_closed");
      if (item.value.event === "endpoint") {
        endpoint = new URL(item.value.data.trim(), url);
        break;
      }
    }
    if (!endpoint || endpoint.origin !== ORIGIN || endpoint.username || endpoint.password || endpoint.hash) throw new Error("invalid_endpoint");
    const send = async message => {
      const r = await requestFetch(endpoint, {
        method: "POST", redirect: "manual", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(message)
      });
      result.last_post_status = r.status;
      await r.body?.cancel();
      if (!r.ok) throw new Error("upstream_post_error");
    };
    const receive = async id => {
      for (let i = 0; i < 32; i++) {
        const item = await iterator.next();
        if (item.done) throw new Error("stream_closed");
        if (item.value.event !== "message") continue;
        let message;
        try { message = JSON.parse(item.value.data); } catch { throw new Error("invalid_rpc_json"); }
        if (message.id !== id) continue;
        if (message.error) {
          result.rpc_error_code = message.error.code;
          throw new Error("upstream_rpc_error");
        }
        if (!message.result) throw new Error("invalid_rpc_result");
        return message.result;
      }
      throw new Error("response_limit");
    };
    result.stage = "initialize";
    await send({ jsonrpc: "2.0", id: 101, method: "initialize", params: {
      protocolVersion: "2024-11-05", capabilities: {},
      clientInfo: { name: "wardrobe-tat-connectivity-probe", version: "1.0.0" }
    } });
    const init = await receive(101);
    result.protocol_version = init.protocolVersion;
    await send({ jsonrpc: "2.0", method: "notifications/initialized" });
    result.stage = "tools_list";
    await send({ jsonrpc: "2.0", id: 102, method: "tools/list", params: {} });
    const list = await receive(102);
    if (!Array.isArray(list.tools)) throw new Error("invalid_tools_list");
    result.tool_names = list.tools.map(t => String(t.name).slice(0, 100));
    result.tool_count = list.tools.length;
    result.ok = true;
    result.stage = "complete";
  } catch (error) {
    const safeErrors = ["stream_limit", "invalid_upstream", "upstream_http_error", "unexpected_content_type", "stream_closed", "invalid_endpoint", "upstream_post_error", "invalid_rpc_json", "upstream_rpc_error", "invalid_rpc_result", "response_limit", "invalid_tools_list"];
    result.error = controller.signal.aborted ? "timeout" : safeErrors.includes(error?.message) ? error.message : "connection_failed";
  } finally {
    controller.abort();
    clearTimeout(timer);
    await iterator?.return().catch(() => {});
    result.elapsed_ms = Date.now() - started;
  }
  return result;
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/healthz" && request.method === "GET") return reply({ ok: true, service: "tat-connectivity-probe", command_execution: false });
    if (path !== "/probe") return new Response("Not found", { status: 404 });
    if (!env.PROBE_TOKEN || request.headers.get("Authorization") !== "Bearer " + env.PROBE_TOKEN) return new Response("Unauthorized", { status: 401 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    return reply(await probe(env.TAT_UPSTREAM_URL));
  }
};

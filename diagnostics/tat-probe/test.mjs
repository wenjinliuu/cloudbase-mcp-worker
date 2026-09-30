import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { probe } from './worker.mjs';
const url = 'https://mcp-api.tencent-cloud.com/sse/test-fixture';
test('successful SSE handshake lists tools without calling commands', async () => {
  let controller;
  const methods = [];
  const stream = new ReadableStream({ start(c) { controller = c; c.enqueue(new TextEncoder().encode('event: endpoint\r\ndata: /messages/test\r\n\r\n')); } });
  const mock = async (u, options) => {
    if (!options.method) return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    const body = JSON.parse(options.body); methods.push(body.method);
    if (body.id) {
      const result = body.method === 'initialize' ? { protocolVersion: '2024-11-05' } : { tools: [{ name: 'RunCommand' }] };
      controller.enqueue(new TextEncoder().encode('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) + '\n\n'));
    }
    return new Response(null, { status: 202 });
  };
  const result = await probe(url, mock);
  assert.equal(result.ok, true);
  assert.deepEqual(result.tool_names, ['RunCommand']);
  assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list']);
});
test('rejects endpoint redirection outside the trusted origin', async () => {
  let calls = 0;
  const result = await probe(url, async () => { calls++; return new Response('event: endpoint\ndata: https://untrusted.example/messages\n\n', { headers: { 'Content-Type': 'text/event-stream' } }); });
  assert.equal(result.error, 'invalid_endpoint'); assert.equal(calls, 1);
});
test('does not expose upstream error bodies or credentialed URLs', async () => {
  const result = await probe(url, async () => new Response('secret-value-must-never-be-returned', { status: 403 }));
  assert.equal(result.http_status, 403);
  assert.equal(result.error, 'upstream_http_error');
  assert.ok(!JSON.stringify(result).includes('secret-value'));
  assert.ok(!JSON.stringify(result).includes('/sse/'));
});
test('bounds network failures and reports timeout', async () => {
  const result = await probe(url, async (_, opts) => await new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted')))), 5);
  assert.equal(result.error, 'timeout'); assert.ok(result.elapsed_ms < 1000);
});
test('requires authentication and has no MCP execution route', async () => {
  const env = { PROBE_TOKEN: 'fixture', TAT_UPSTREAM_URL: url };
  assert.equal((await worker.fetch(new Request('https://probe.example/probe', { method: 'POST' }), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://probe.example/mcp', { method: 'POST' }), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://probe.example/healthz'), env)).status, 200);
});

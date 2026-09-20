type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeTextContent(block: unknown): boolean {
	if (!isJsonObject(block) || block.type !== "text" || typeof block.text !== "string") {
		return false;
	}

	let toolPayload: unknown;
	try {
		toolPayload = JSON.parse(block.text);
	} catch {
		return false;
	}

	if (!isJsonObject(toolPayload) || !isJsonObject(toolPayload.data)) return false;
	if (toolPayload.data.action !== "listFunctionLayers" || !("raw" in toolPayload.data)) {
		return false;
	}

	// The upstream implementation obtains Layers through getFunctionDetail and
	// currently echoes the whole function detail as data.raw. That includes
	// unrelated CodeInfo and greatly expands the response. The normalized
	// layers/count/requestId fields already contain everything this action promises.
	delete toolPayload.data.raw;
	block.text = JSON.stringify(toolPayload, null, 2);
	return true;
}

function sanitizeJsonRpcMessage(message: unknown): boolean {
	if (!isJsonObject(message) || !isJsonObject(message.result)) return false;
	const content = message.result.content;
	if (!Array.isArray(content)) return false;

	let changed = false;
	for (const block of content) {
		changed = sanitizeTextContent(block) || changed;
	}
	return changed;
}

export function sanitizeDirectV2JsonRpcPayload(payload: unknown): boolean {
	if (Array.isArray(payload)) {
		let changed = false;
		for (const message of payload) {
			changed = sanitizeJsonRpcMessage(message) || changed;
		}
		return changed;
	}

	return sanitizeJsonRpcMessage(payload);
}

export async function sanitizeDirectV2Response(response: Response): Promise<Response> {
	const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
	if (!contentType.includes("application/json")) return response;

	let payload: unknown;
	try {
		payload = await response.clone().json();
	} catch {
		return response;
	}

	if (!sanitizeDirectV2JsonRpcPayload(payload)) return response;

	const headers = new Headers(response.headers);
	headers.delete("content-length");
	return new Response(JSON.stringify(payload), {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

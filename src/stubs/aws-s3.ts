function unavailable(): never {
	throw new Error("S3 archive access is unavailable in CloudBase MCP Cloud Mode.");
}

export class S3Client {
	send(): never {
		return unavailable();
	}
}

export class GetObjectCommand {
	constructor(public readonly input?: unknown) {}
}

export class HeadObjectCommand {
	constructor(public readonly input?: unknown) {}
}

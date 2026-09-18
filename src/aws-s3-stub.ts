// CloudBase depends on unzipper, whose optional S3 helper statically requires
// @aws-sdk/client-s3. This Worker never uses unzipper's S3 helper, so keep a
// tiny fail-fast compatibility shim instead of bundling the full AWS SDK.

export class S3Client {
	constructor() {
		throw new Error("AWS S3 support is not available in this Cloudflare Worker.");
	}
}

export class GetObjectCommand {
	constructor() {
		throw new Error("AWS S3 support is not available in this Cloudflare Worker.");
	}
}

export class HeadObjectCommand {
	constructor() {
		throw new Error("AWS S3 support is not available in this Cloudflare Worker.");
	}
}

import "@passlet/env/web";
import type { NextConfig } from "next";

// PREVIEW_ORIGIN: comma-separated `host[:port]` list this dev server is reached
// through when it isn't plain localhost (proxy/tunnel hosts). Set in .env.local.
const previewOrigins = (process.env.PREVIEW_ORIGIN ?? "")
	.split(",")
	.map((origin) => origin.trim())
	.filter(Boolean);

const nextConfig: NextConfig = {
	typedRoutes: true,
	reactCompiler: true,
	// Next blocks cross-origin dev resources (assets, HMR) from unknown hosts.
	allowedDevOrigins: [
		"web.localhost",
		...previewOrigins.map((origin) => origin.split(":")[0]),
	],
	experimental: {
		serverActions: {
			// An origin/host mismatch behind a reverse proxy trips the Server Action
			// CSRF check; entries here must carry the port the browser sees.
			allowedOrigins: previewOrigins,
		},
	},
};

export default nextConfig;

import type { MetadataRoute } from "next";
import { AGENT_ROUTES } from "@/lib/agent-docs";
import { SITE_MANIFEST } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
	return ["", ...AGENT_ROUTES].map((route) => ({
		url: `${SITE_MANIFEST.url}${route}`,
	}));
}

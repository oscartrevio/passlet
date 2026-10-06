import { llmsTxt } from "@/lib/agent-docs";

export const dynamic = "force-static";

export async function GET() {
	return new Response(await llmsTxt(), {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}

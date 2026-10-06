import { readRepoFile } from "@/lib/agent-docs";

export const dynamic = "force-static";

export async function GET() {
	return new Response(await readRepoFile("SKILL.md"), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
}

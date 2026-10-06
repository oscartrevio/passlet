import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { SITE_MANIFEST } from "@/lib/site";

// Routes that use this module are prerendered with `force-static`, so these
// reads run once during `next build` (cwd = apps/web) and the deployed output
// never needs the repo files at runtime; `turbopackIgnore` keeps the tracer
// from bundling the whole monorepo into the server output.
const REPO_ROOT = path.resolve(process.cwd(), "../..");
const GITHUB_BLOB = `${SITE_MANIFEST.github}/blob/main/`;
const GITHUB_TREE = `${SITE_MANIFEST.github}/tree/main/`;
const GITHUB_RAW = `${SITE_MANIFEST.github.replace("https://github.com", "https://raw.githubusercontent.com")}/main/`;

const EXAMPLE_SKIP_DIRS: Record<string, true> = {
	node_modules: true,
	".next": true,
	assets: true,
};
const EXAMPLE_SOURCE = /\.(ts|tsx)$|^\.env\.example$/;
const EXAMPLE_LANGS: Record<string, string> = {
	".ts": "ts",
	".tsx": "tsx",
	".example": "sh",
};

export const AGENT_ROUTES = ["/llms.txt", "/llms-full.txt", "/skill.md"];

export function readRepoFile(file: string): Promise<string> {
	return readFile(path.join(/*turbopackIgnore: true*/ REPO_ROOT, file), "utf8");
}

// Inlined docs lose their position in the repo, so relative links are pinned
// to `base`; the README's HTML header image is noise for agents.
function toStandaloneMarkdown(markdown: string, base: URL): string {
	return markdown
		.replace(/<picture>[\s\S]*?<\/picture>\s*/g, "")
		.replace(
			/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g,
			(_, href: string) => `](${new URL(href, base).href})`
		)
		.trim();
}

async function listExampleSources(): Promise<string[]> {
	const sources: string[] = [];
	async function walk(dir: string) {
		const entries = await readdir(
			path.join(/*turbopackIgnore: true*/ REPO_ROOT, dir),
			{
				withFileTypes: true,
			}
		);
		for (const entry of entries) {
			const rel = path.posix.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!EXAMPLE_SKIP_DIRS[entry.name]) {
					await walk(rel);
				}
			} else if (EXAMPLE_SOURCE.test(entry.name)) {
				sources.push(rel);
			}
		}
	}
	await walk("examples");
	return sources.sort();
}

export async function llmsTxt(): Promise<string> {
	const sources = await listExampleSources();
	const site = SITE_MANIFEST.url;
	return `# ${SITE_MANIFEST.name}

> ${SITE_MANIFEST.description}

Passlet is a TypeScript library (\`npm install passlet\`) for Node.js servers. Define a pass template once with \`new Wallet()\` and \`wallet.loyalty()\` / \`eventTicket()\` / \`boardingPass()\` / \`coupon()\` / \`giftCard()\` / \`generic()\`, then call \`create()\` per recipient to get signed \`.pkpass\` bytes for Apple and a save JWT for Google.

- Run it on the server only; signing credentials must never reach the client.
- Failures throw \`WalletError\`; branch on its \`code\`, never on message text.

## Docs

- [Full documentation](${site}/llms-full.txt): README, the examples guide, and every example's source in one markdown file
- [README](${GITHUB_BLOB}README.md): what passlet is, install, and a quick start
- [Wiki](${SITE_MANIFEST.github}/wiki): every guide (credentials, pass types, fields, serving, updates, multiple passes, deploying) and the error catalog
- [Agent skill](${site}/skill.md): concise usage rules for coding agents; install it as a SKILL.md

## Examples

- [Examples guide](${GITHUB_RAW}examples/README.md): HTTP headers, environment variables, and common pitfalls
${sources
	// Next.js dynamic segments like `[serial]` would otherwise break the
	// markdown link syntax that llms.txt parsers rely on.
	.map(
		(file) =>
			`- [${file.slice("examples/".length).replace(/[[\]]/g, "\\$&")}](${GITHUB_RAW}${file.replace(/\[/g, "%5B").replace(/\]/g, "%5D")})`
	)
	.join("\n")}

## Optional

- [Playground](${site}): design a pass in the browser and add it to Apple or Google Wallet
- [Source code](${SITE_MANIFEST.github}): library, playground, and examples monorepo
- [npm package](https://www.npmjs.com/package/passlet)
`;
}

export async function llmsFullTxt(): Promise<string> {
	const [readme, examplesGuide, sources] = await Promise.all([
		readRepoFile("README.md"),
		readRepoFile("examples/README.md"),
		listExampleSources(),
	]);
	const sourceBlocks = await Promise.all(
		sources.map(async (file) => {
			const lang = EXAMPLE_LANGS[path.extname(file)] ?? "";
			const code = (await readRepoFile(file)).trimEnd();
			return `### ${file}\n\nSource: ${GITHUB_TREE}${path.posix.dirname(file)}\n\n\`\`\`${lang}\n${code}\n\`\`\``;
		})
	);
	return `# ${SITE_MANIFEST.name}

> ${SITE_MANIFEST.description}

${toStandaloneMarkdown(readme, new URL(GITHUB_BLOB))}

---

${toStandaloneMarkdown(examplesGuide, new URL("examples/", GITHUB_BLOB))}

## Example sources

${sourceBlocks.join("\n\n")}
`;
}

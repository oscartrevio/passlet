// Minimal demo page. In a real app the serial number would come from the
// signed-in user, not from a hardcoded string.
const serial = "user-123";

export default function Home() {
	return (
		<main style={{ fontFamily: "system-ui", padding: 32 }}>
			<h1>Passlet — Next.js example</h1>
			<ul>
				<li>
					{/* Open this one on an iPhone: Safari hands it to Wallet. */}
					<a href={`/api/passes/${serial}/apple`}>Add to Apple Wallet</a>
				</li>
				<li>
					<a href={`/api/passes/${serial}/google`}>Add to Google Wallet</a>
				</li>
			</ul>
		</main>
	);
}

/**
 * What `forgottenTerms` stores instead of the word (ADR-0270): lowercase hex
 * SHA-256 of the fold. Keeps the plaintext out of the store and exports; it is
 * not secrecy against someone who guesses the word.
 */
export async function hashFold(fold: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(fold),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');
}

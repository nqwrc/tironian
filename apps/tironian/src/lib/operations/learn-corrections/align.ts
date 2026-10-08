import type { Word } from './words';

/** A maximal run where the delivery and the field disagree. */
export type Hunk = { from: Word[]; to: Word[]; toStart: number };

const MAX_ALIGN_WORDS = 400;

/** LCS over folds. Null when either side is too long to be a correction. */
export function alignWords(a: Word[], b: Word[]): Hunk[] | null {
	const n = a.length;
	const m = b.length;
	if (n > MAX_ALIGN_WORDS || m > MAX_ALIGN_WORDS) return null;
	const width = m + 1;
	const lcs = new Uint16Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i * width + j] =
				a[i]!.fold === b[j]!.fold
					? lcs[(i + 1) * width + j + 1]! + 1
					: Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
		}
	}
	const hunks: Hunk[] = [];
	let open: Hunk | null = null;
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && a[i]!.fold === b[j]!.fold) {
			if (open) hunks.push(open);
			open = null;
			i++;
			j++;
			continue;
		}
		open ??= { from: [], to: [], toStart: j };
		if (
			j < m &&
			(i === n || lcs[i * width + j + 1]! >= lcs[(i + 1) * width + j]!)
		) {
			open.to.push(b[j]!);
			j++;
		} else {
			open.from.push(a[i]!);
			i++;
		}
	}
	if (open) hunks.push(open);
	return hunks;
}

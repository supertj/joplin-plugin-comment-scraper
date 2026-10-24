import type { ExportRecord, Thread } from './types';

// Turns one exported thread into a Joplin note body: where it came from, then the post, then
// every comment in a blockquote nested inside the one it replies to.
//
// Everything in an export file comes from strangers on Reddit or Hacker News. Joplin renders
// raw HTML and loads remote images in notes, and plugins can act on note text: some render
// fenced blocks that name a language (```mermaid and the like), others look at a note's first
// line. So post and comment bodies go into code blocks they can't close and that name no
// language, the note always starts with a line written here, and links, times and names are
// rebuilt from checked values instead of copied.

/**
 * Deeper replies stay at this level. Past six or so, nested quotes get too narrow to read,
 * and Reddit chains can go hundreds of replies deep.
 */
export const MAX_NESTING = 6;

export function platformName(source: Thread['source']): string {
	return source === 'reddit' ? 'Reddit' : 'Hacker News';
}

/** The thread title on one line, or "Reddit thread 1abcxyz" when the title is empty. */
export function noteTitle(thread: Thread): string {
	return oneLine(thread.title) || `${platformName(thread.source)} thread ${oneLine(thread.threadId)}`.trim();
}

function oneLine(text: string): string {
	return text.replace(/[\p{Cc}\s]+/gu, ' ').trim();
}

/**
 * The [c12] numbers the extension writes in its Markdown export: every comment in file order,
 * starting at 1. The nested JSON flattens back into the same order, so a number points at the
 * same comment whichever format the thread was exported in.
 */
export function commentNumbers(thread: Thread): Map<string, number> {
	const numbers = new Map<string, number>();
	let next = 1;
	for (const comment of thread.comments) if (comment.comment_id) numbers.set(comment.comment_id, next++);
	return numbers;
}

export function threadToNoteBody(thread: Thread): string {
	const numbers = commentNumbers(thread);
	const source = [platformName(thread.source)];
	// Subreddit names are letters, digits and underscores; anything else isn't one.
	if (thread.subreddit && /^\w+$/.test(thread.subreddit)) source.push(`r/${thread.subreddit}`);
	const threadLink = markdownLink('original thread', thread.url);
	if (threadLink) source.push(threadLink);
	const lines = [`- Source: ${source.join(' · ')}`];
	const exported = formatUtc(thread.exportedAt);
	if (exported) lines.push(`- Exported: ${exported}`);
	lines.push(`- Comments in this export: ${thread.comments.length}`, '');

	lines.push(...quoteLines(thread.post, 1, ['**Post**', ...recordFacts(thread.post)]));
	if (thread.comments.length > 0) lines.push('', '## Comments', '');
	let first = true;
	for (const { record, level, shownUnder } of commentsInReplyOrder(thread)) {
		// A line one level up ends the previous quote, so this one opens as its sibling inside
		// the same parent instead of running on inside the previous comment.
		if (!first) lines.push(quotePrefix(level - 1).trimEnd());
		first = false;
		const facts = recordFacts(record);
		if (shownUnder) facts.unshift(`reply to ${parentReference(shownUnder, numbers)}`);
		else if (level === 1 && record.parent_missing) facts.unshift('reply to a comment not in the export');
		const number = record.comment_id ? numbers.get(record.comment_id) : undefined;
		if (number) facts.unshift(`**[c${number}]**`);
		lines.push(...quoteLines(record, level, facts));
	}
	return lines.join('\n') + '\n';
}

interface PlacedComment {
	record: ExportRecord;
	level: number;
	/** The real parent, set when the comment is shown flatter than its real depth so the reply stays clear. */
	shownUnder: ExportRecord | null;
}

/**
 * Comments in reading order: each one followed by its replies. Built from parent_id rather than
 * trusting the file's row order, and walked with a stack because chains can be thousands deep.
 * A comment whose parent isn't in the export starts at the top level.
 */
export function commentsInReplyOrder(thread: Thread): PlacedComment[] {
	const byId = new Map<string, ExportRecord>();
	for (const comment of thread.comments) if (comment.comment_id) byId.set(comment.comment_id, comment);
	const roots: ExportRecord[] = [];
	const replies = new Map<string, ExportRecord[]>();
	for (const comment of thread.comments) {
		const parentId = comment.parent_id;
		if (parentId && parentId !== comment.comment_id && byId.has(parentId)) {
			const siblings = replies.get(parentId) ?? [];
			siblings.push(comment);
			replies.set(parentId, siblings);
		} else roots.push(comment);
	}

	const placed: PlacedComment[] = [];
	const visited = new Set<ExportRecord>();
	const stack: { record: ExportRecord; depth: number }[] = roots.map((record) => ({ record, depth: 1 })).reverse();
	while (stack.length > 0) {
		const { record, depth } = stack.pop()!;
		if (visited.has(record)) continue;
		visited.add(record);
		const level = Math.min(depth, MAX_NESTING);
		const parent = depth > MAX_NESTING && record.parent_id ? byId.get(record.parent_id) : undefined;
		placed.push({ record, level, shownUnder: parent ?? null });
		const children = record.comment_id ? (replies.get(record.comment_id) ?? []) : [];
		for (let index = children.length - 1; index >= 0; index--) stack.push({ record: children[index]!, depth: depth + 1 });
	}
	// Comments caught in a parent loop (only in a hand-edited file) are never reached from a
	// root; list them at the top level rather than dropping them.
	for (const comment of thread.comments) {
		if (!visited.has(comment)) placed.push({ record: comment, level: 1, shownUnder: null });
	}
	return placed;
}

/** "[c5]", linked to that comment when its address is a web address. */
function parentReference(parent: ExportRecord, numbers: Map<string, number>): string {
	const number = parent.comment_id ? numbers.get(parent.comment_id) : undefined;
	const label = number ? `[c${number}]` : 'the comment above';
	return markdownLink(label.replace(/[[\]]/g, '\\$&'), parent.permalink) ?? label;
}

function quoteLines(record: ExportRecord, level: number, header: string[]): string[] {
	const prefix = quotePrefix(level);
	const lines = [`${prefix}${header.join(' · ')}`];
	for (const line of bodyLines(record)) lines.push(line === '' ? prefix.trimEnd() : prefix + line);
	return lines;
}

/** Points, time, OP and edited markers, and the link to the original. Only fixed words, numbers and checked links. */
function recordFacts(record: ExportRecord): string[] {
	const facts: string[] = [];
	if (record.score !== null) facts.push(`${record.score} ${Math.abs(record.score) === 1 ? 'point' : 'points'}`);
	else if (record.score_hidden) facts.push('score hidden');
	const time = formatUtc(record.created_utc);
	if (time) facts.push(time);
	if (record.record_type === 'comment' && record.is_op) facts.push('OP');
	if (record.edited_utc) facts.push('edited');
	const link = markdownLink('link', record.permalink);
	if (link) facts.push(link);
	return facts;
}

function bodyLines(record: ExportRecord): string[] {
	if (record.comment_state === 'deleted') return ['*(deleted)*'];
	if (record.comment_state === 'removed') return ['*(removed)*'];
	// Only blank lines are trimmed: leading spaces on the first line can matter, as in code.
	const body = record.body.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd();
	return body ? fencedText(body) : [];
}

/**
 * The text as a plain code block it can't break out of: the fence is longer than any run of
 * backticks inside, and it names no language for a renderer or plugin to pick up. Inside,
 * Joplin shows the text as it is, with no HTML, images, links or math. The cost is that
 * Reddit's own formatting (bold, lists, links) shows as plain text.
 */
export function fencedText(text: string): string[] {
	let longestRun = 0;
	for (const run of text.match(/`+/g) ?? []) longestRun = Math.max(longestRun, run.length);
	const fence = '`'.repeat(Math.max(3, longestRun + 1));
	return [fence, ...text.split('\n'), fence];
}

function quotePrefix(level: number): string {
	return '> '.repeat(level);
}

/** "2026-09-21 14:13 UTC", or null when the value isn't a date. Kept in UTC so the note reads the same in every time zone. */
export function formatUtc(iso: string): string | null {
	// Only the ISO 8601 form the extension writes; Date() alone would guess at almost anything.
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(iso)) return null;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * The address with every character that could end a Markdown link, start a new line or open a
 * tag percent-encoded, or null for anything but http(s) (javascript: and the like).
 */
export function webAddress(url: string): string | null {
	if (!/^https?:\/\//i.test(url)) return null;
	return url.replace(/[^\w\-.~:/?#@!$&'*+,;=%]/gu, (char) => {
		// encodeURIComponent leaves ( and ) alone, so ASCII is encoded by hand.
		const code = char.codePointAt(0)!;
		if (code < 0x80) return `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
		try {
			return encodeURIComponent(char);
		} catch {
			// A lone surrogate half can't be encoded.
			return '%EF%BF%BD';
		}
	});
}

export function markdownLink(text: string, url: string): string | null {
	const address = webAddress(url);
	return address ? `[${text}](${address})` : null;
}

import { readFileSync } from 'node:fs';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import {
	MAX_NESTING,
	commentNumbers,
	commentsInReplyOrder,
	fencedText,
	formatUtc,
	markdownLink,
	noteTitle,
	threadToNoteBody,
	webAddress,
} from '../src/import/note';
import { parseExport } from '../src/import/parse';
import type { ExportRecord, Thread } from '../src/import/types';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const post: ExportRecord = {
	source: 'reddit',
	record_type: 'post',
	thread_id: 'p1',
	thread_title: 'Is it worth it?',
	subreddit: 'test',
	comment_id: null,
	parent_id: null,
	parent_missing: false,
	score: 120,
	score_hidden: false,
	created_utc: '2026-10-01T08:30:00.000Z',
	edited_utc: null,
	is_op: true,
	body: 'Thinking about it.',
	permalink: 'https://www.reddit.com/r/test/comments/p1/is_it_worth_it/',
	comment_state: 'normal',
};

const comment = (id: string, parent: string, extra: Partial<ExportRecord> = {}): ExportRecord => ({
	...post,
	record_type: 'comment',
	comment_id: id,
	parent_id: parent,
	score: 1,
	is_op: false,
	body: `Text of ${id}`,
	permalink: `https://www.reddit.com/r/test/comments/p1/_/${id}/`,
	...extra,
});

const thread = (comments: ExportRecord[], extra: Partial<Thread> = {}): Thread => ({
	source: 'reddit',
	threadId: 'p1',
	title: post.thread_title,
	url: post.permalink,
	subreddit: 'test',
	exportedAt: '2026-10-02T00:00:00.000Z',
	post,
	comments,
	...extra,
});

// Joplin renders notes with markdown-it, so the tests read the notes back with it too.
const markdown = new MarkdownIt({ html: true });
interface Token {
	type: string;
	info: string;
	content: string;
	children: Token[] | null;
	attrGet(name: string): string | null;
}
const tokensOf = (note: string): Token[] => {
	const all: Token[] = [];
	const visit = (tokens: Token[]) => {
		for (const token of tokens) {
			all.push(token);
			if (token.children) visit(token.children);
		}
	};
	visit(markdown.parse(note, {}) as Token[]);
	return all;
};

/** Each comment's [cN] label with the blockquote depth it renders at, in note order. */
const renderedDepths = (note: string): string[] => {
	const depths: string[] = [];
	let depth = 0;
	for (const token of markdown.parse(note, {}) as Token[]) {
		if (token.type === 'blockquote_open') depth++;
		if (token.type === 'blockquote_close') depth--;
		const label = token.type === 'inline' ? /^\*\*(\[c\d+\])\*\*/.exec(token.content) : null;
		if (label) depths.push(`${label[1]}:${depth}`);
	}
	return depths;
};

describe('threadToNoteBody', () => {
	it('writes the source, the post and numbered, nested comments', () => {
		const note = threadToNoteBody(
			thread([
				comment('a', 'p1', { score: 41, edited_utc: '2026-10-01T10:00:00.000Z' }),
				comment('b', 'a', { is_op: true, body: 'First line\n\nSecond line' }),
				comment('c', 'a', { score: null, score_hidden: true }),
				comment('d', 'p1', { comment_state: 'deleted', body: '' }),
			]),
		);
		expect(note).toBe(
			[
				'- Source: Reddit · r/test · [original thread](https://www.reddit.com/r/test/comments/p1/is_it_worth_it/)',
				'- Exported: 2026-10-02 00:00 UTC',
				'- Comments in this export: 4',
				'',
				'> **Post** · 120 points · 2026-10-01 08:30 UTC · [link](https://www.reddit.com/r/test/comments/p1/is_it_worth_it/)',
				'> ```',
				'> Thinking about it.',
				'> ```',
				'',
				'## Comments',
				'',
				'> **[c1]** · 41 points · 2026-10-01 08:30 UTC · edited · [link](https://www.reddit.com/r/test/comments/p1/_/a/)',
				'> ```',
				'> Text of a',
				'> ```',
				'>',
				'> > **[c2]** · 1 point · 2026-10-01 08:30 UTC · OP · [link](https://www.reddit.com/r/test/comments/p1/_/b/)',
				'> > ```',
				'> > First line',
				'> >',
				'> > Second line',
				'> > ```',
				'>',
				'> > **[c3]** · score hidden · 2026-10-01 08:30 UTC · [link](https://www.reddit.com/r/test/comments/p1/_/c/)',
				'> > ```',
				'> > Text of c',
				'> > ```',
				'',
				'> **[c4]** · 1 point · 2026-10-01 08:30 UTC · [link](https://www.reddit.com/r/test/comments/p1/_/d/)',
				'> *(deleted)*',
				'',
			].join('\n'),
		);
		// Replies render inside their parent's quote, and siblings as separate quotes.
		expect(renderedDepths(note)).toEqual(['[c1]:1', '[c2]:2', '[c3]:2', '[c4]:1']);
		expect(tokensOf(note).filter((token) => token.type === 'blockquote_open')).toHaveLength(5);
	});

	it('never writes an author, since exports have none', () => {
		for (const name of ['batch-flat.json', 'batch.csv']) {
			for (const parsed of parseExport(fixture(name)).threads) {
				expect(threadToNoteBody(parsed)).not.toMatch(/author/i);
			}
		}
	});

	it('nests the extension test thread by reply depth', () => {
		const [reddit, hn] = parseExport(fixture('batch-nested.json')).threads;
		const note = threadToNoteBody(reddit!);
		expect(note).toContain('- Source: Reddit · r/testsub · [original thread](https://www.reddit.com/r/testsub/comments/1abcxyz/title/)\n');
		expect(note).toContain('- Exported: 2026-10-20 15:33 UTC\n- Comments in this export: 11\n');
		expect(note).toContain('> **[c1]** · 10 points · 2026-09-21 14:13 UTC · [link](https://www.reddit.com/r/testsub/comments/1abcxyz/title/c1/)');
		expect(note).toContain('> > **[c2]** · 10 points · 2026-09-21 14:14 UTC · OP · edited · [link](https://www.reddit.com/r/testsub/comments/1abcxyz/title/c2/)');
		// Numbers count comments in file order, so the comment with ID c11 is [c7].
		expect(note).toContain('> > > > **[c7]** · 10 points · 2026-09-21 14:15 UTC · [link](https://www.reddit.com/r/testsub/comments/1abcxyz/title/c11/)');
		expect(note).toContain('> **[c8]** · 10 points · 2026-09-21 14:13 UTC · [link](https://www.reddit.com/r/testsub/comments/1abcxyz/title/c6/)\n> *(removed)*');
		// A heading line in the post stays plain text inside the post's code block.
		expect(note).toContain('> ```\n> Looking for honest takes.\n> # not a heading\n> ```');
		expect(renderedDepths(note)).toEqual(['[c1]:1', '[c2]:2', '[c3]:2', '[c4]:1', '[c5]:2', '[c6]:3', '[c7]:4', '[c8]:1', '[c9]:1', '[c10]:1', '[c11]:2']);

		// Hacker News has no comment scores and no subreddit.
		const hnNote = threadToNoteBody(hn!);
		expect(hnNote).toContain('- Source: Hacker News · [original thread](https://news.ycombinator.com/item?id=1)\n');
		expect(hnNote).toContain('> **Post** · 50 points · 2026-09-21 14:13 UTC · [link](https://news.ycombinator.com/item?id=1)\n> ```\n> https://x.dev');
		expect(hnNote).toContain('> > **[c2]** · 2026-09-21 14:16 UTC · OP · [link](https://news.ycombinator.com/item?id=3)\n> > ```\n> > Thanks');
	});

	it('numbers comments the way the extension does in its Markdown export', () => {
		// The .md fixtures came out of the extension's Markdown export for batch-flat.json. Each
		// comment there starts with "[cN]" or "[cN] reply to [cM]"; the same numbers and the same
		// parent links have to come out of every other format.
		const expected = ['batch-flat.reddit.md', 'batch-flat.hn.md'].map((name) => fixture(name).match(/^\[c\d+\]( reply to \[c\d+\])?/gm));
		for (const file of ['batch-flat.json', 'batch-nested.json', 'batch.csv']) {
			const threads = parseExport(fixture(file)).threads;
			const headers = threads.map((parsed) => {
				const numbers = commentNumbers(parsed);
				return parsed.comments.map((record) => {
					const parentNumber = record.parent_id ? numbers.get(record.parent_id) : undefined;
					return `[c${numbers.get(record.comment_id!)}]${parentNumber ? ` reply to [c${parentNumber}]` : ''}`;
				});
			});
			expect(headers).toEqual(expected);
		}
	});

	it('produces the same note from flat JSON, nested JSON and CSV', () => {
		const notes = ['batch-flat.json', 'batch-nested.json', 'batch.csv'].map((name) =>
			parseExport(fixture(name)).threads.map(threadToNoteBody),
		);
		expect(notes[1]).toEqual(notes[0]);
		expect(notes[2]).toEqual(notes[0]);
	});

	it('numbers comments by file order, not by where they show up', () => {
		const note = threadToNoteBody(thread([comment('b', 'a'), comment('c', 'p1'), comment('a', 'p1')]));
		expect(renderedDepths(note)).toEqual(['[c2]:1', '[c3]:1', '[c1]:2']);
	});

	it('marks replies whose parent was not exported', () => {
		const note = threadToNoteBody(thread([comment('x', 'missing', { parent_missing: true })]));
		expect(note).toContain('> **[c1]** · reply to a comment not in the export · 1 point');
	});

	it('leaves out a subreddit that is not a subreddit name and a thread link that is not a web address', () => {
		const note = threadToNoteBody(thread([], { subreddit: 'test · [x](javascript:alert(1))', url: 'javascript:alert(1)' }));
		expect(note.split('\n')[0]).toBe('- Source: Reddit');
		expect(note).not.toContain('## Comments');
	});

	it('keeps leading spaces on the first line of a comment', () => {
		const note = threadToNoteBody(thread([comment('a', 'p1', { body: '\n\n    indented code\nprose' })]));
		expect(note).toContain('> ```\n>     indented code\n> prose\n> ```');
	});
});

// Comment text comes from strangers. Whatever it contains, it must reach the note as plain text
// that neither Joplin nor a plugin acts on.
describe('untrusted text', () => {
	const allowedLinks = (parsed: Thread) =>
		new Set([parsed.url, parsed.post.permalink, ...parsed.comments.map((record) => record.permalink)].map((url) => webAddress(url)));

	/** Anything in the rendered note that does more than show text, or a link the plugin didn't write. */
	const activeParts = (note: string, parsed: Thread): string[] => {
		const links = allowedLinks(parsed);
		return tokensOf(note).flatMap((token) => {
			if (token.type === 'html_block' || token.type === 'html_inline') return [`html ${token.content}`];
			if (token.type === 'image') return ['image'];
			if (token.type === 'code_inline') return [`inline code ${token.content}`];
			if (token.type === 'fence' && token.info !== '') return [`fence info ${token.info}`];
			if (token.type === 'link_open' && !links.has(token.attrGet('href'))) return [`link ${token.attrGet('href')}`];
			// Joplin turns $...$ into math, and plugins read [[...]] as note links.
			if (token.type === 'text' && /\$|\[\[/.test(token.content)) return [`text ${token.content}`];
			return [];
		});
	};
	const codeBlocks = (note: string) => tokensOf(note).filter((token) => token.type === 'fence').map((token) => token.content);

	const attacks = {
		mermaid: '```mermaid\ngraph TD; A-->B\n```',
		longerFence: '````\nclosing early?\n````\n```mermaid\nstill code\n```',
		tildeFence: '~~~mermaid\ngraph TD; A-->B\n~~~',
		inlineCode: 'Look: `rm -rf ~` here',
		math: 'Costs $5 and $$x^2$$ and \\(y\\)',
		html: '<script>alert(1)</script>\n<iframe src="https://evil.example/"></iframe>\n<img src=x onerror=alert(1)>',
		images: '![tracker](https://tracker.example/p.png) and ![file](:/0123456789abcdef0123456789abcdef)',
		links: '[click](javascript:alert(1)) and [note](:/0123456789abcdef0123456789abcdef) and <https://evil.example>',
		referenceDefinition: '[c1]: https://evil.example\n[link]: https://evil.example',
		wikiLinks: '[[Private note]]',
		shellPrefix: '❕cmd: rm -rf ~',
	};

	for (const [name, body] of Object.entries(attacks)) {
		it(`keeps ${name} text plain`, () => {
			const parsed = thread([comment('a', 'p1'), comment('b', 'a'), comment('c', 'b', { body })], {
				post: { ...post, body },
			});
			const note = threadToNoteBody(parsed);
			expect(activeParts(note, parsed)).toEqual([]);
			// The post and the deepest reply each sit whole in their own code block.
			expect(codeBlocks(note).filter((content) => content === `${body}\n`)).toHaveLength(2);
			// The reply still nests where it belongs, so nothing broke out of the block above it.
			expect(renderedDepths(note)).toEqual(['[c1]:1', '[c2]:2', '[c3]:3']);
			// The note always starts with a line the plugin writes.
			expect(note.startsWith('- Source: Reddit · r/test · [original thread](')).toBe(true);
		});
	}

	it('uses a fence longer than any backtick run in the text', () => {
		expect(fencedText('a ``` b')[0]).toBe('````');
		expect(fencedText('`````')[0]).toBe('``````');
		expect(fencedText('plain')[0]).toBe('```');
	});

	it('only links to web addresses, and an address cannot start new lines', () => {
		expect(markdownLink('link', 'javascript:alert(1)')).toBeNull();
		expect(markdownLink('link', 'file:///etc/passwd')).toBeNull();
		expect(markdownLink('link', 'https://a.example/x (y)\n```mermaid\n[z]<%')).toBe(
			'[link](https://a.example/x%20%28y%29%0A%60%60%60mermaid%0A%5Bz%5D%3C%)',
		);
		const parsed = thread([comment('a', 'p1', { permalink: 'https://a.example/\n```mermaid\nx', created_utc: '2026\n```mermaid' })]);
		const note = threadToNoteBody(parsed);
		expect(activeParts(note, parsed)).toEqual([]);
		expect(note).toContain('> **[c1]** · 1 point · [link](https://a.example/%0A%60%60%60mermaid%0Ax)\n');
	});
});

describe('commentsInReplyOrder', () => {
	it('follows parent_id even when rows are out of order', () => {
		const placed = commentsInReplyOrder(thread([comment('b', 'a'), comment('c', 'p1'), comment('a', 'p1')]));
		expect(placed.map(({ record, level }) => `${record.comment_id}:${level}`)).toEqual(['c:1', 'a:1', 'b:2']);
	});

	it(`stops nesting at level ${MAX_NESTING} and names the parent of deeper replies`, () => {
		const chain = Array.from({ length: 9 }, (_, index) => comment(`n${index}`, index === 0 ? 'p1' : `n${index - 1}`));
		const placed = commentsInReplyOrder(thread(chain));
		expect(placed.map(({ level }) => level)).toEqual([1, 2, 3, 4, 5, 6, 6, 6, 6]);
		expect(placed[5]!.shownUnder).toBeNull();
		expect(placed[6]!.shownUnder!.comment_id).toBe('n5');
		const note = threadToNoteBody(thread(chain));
		expect(note).toContain(`${'> '.repeat(MAX_NESTING)}**[c7]** · reply to [\\[c6\\]](https://www.reddit.com/r/test/comments/p1/_/n5/) · 1 point`);
		expect(note).not.toContain('> '.repeat(MAX_NESTING + 1));
		expect(markdown.render(note)).toContain('<strong>[c7]</strong> · reply to <a href="https://www.reddit.com/r/test/comments/p1/_/n5/">[c6]</a> · 1 point');
	});

	it('handles a chain thousands deep and a parent loop without losing comments', () => {
		const chain = Array.from({ length: 20_000 }, (_, index) => comment(`n${index}`, index === 0 ? 'p1' : `n${index - 1}`));
		expect(commentsInReplyOrder(thread(chain))).toHaveLength(20_000);
		const loop = commentsInReplyOrder(thread([comment('x', 'y'), comment('y', 'x'), comment('z', 'z')]));
		expect(loop.map(({ record }) => record.comment_id).sort()).toEqual(['x', 'y', 'z']);
	});
});

describe('noteTitle and formatUtc', () => {
	const title = (text: string, extra: Partial<Thread> = {}) => noteTitle(thread([], { title: text, ...extra }));

	it('keeps the title as it is, on one line', () => {
		expect(title('Show HN: A tiny thing: with "quotes" / slashes?')).toBe('Show HN: A tiny thing: with "quotes" / slashes?');
		expect(title('  Line\nbreak\tand\u0000control  ')).toBe('Line break and control');
	});

	it('falls back to the platform and thread ID', () => {
		expect(title('')).toBe('Reddit thread p1');
		expect(title(' \n ', { source: 'hn', threadId: '42' })).toBe('Hacker News thread 42');
		expect(title('', { threadId: '' })).toBe('Reddit thread');
	});

	it('formats times in UTC and drops unreadable ones', () => {
		expect(formatUtc('2026-09-21T14:13:20.000Z')).toBe('2026-09-21 14:13 UTC');
		expect(formatUtc('yesterday')).toBeNull();
		expect(formatUtc('2026')).toBeNull();
	});
});

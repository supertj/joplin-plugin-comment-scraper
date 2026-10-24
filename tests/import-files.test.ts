import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importChosenFiles, NOTEBOOK_TITLE, type DataApi } from '../src/import/import-files';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

interface Folder {
	id: string;
	title: string;
	parent_id: string;
}

/**
 * joplin.data backed by two arrays. Like the real data API, folders come back a page at a time
 * (two per page here) and the trash is left out.
 */
function fakeData(folders: Folder[] = [], options: { failOnTitle?: string } = {}) {
	const notes: Record<string, string>[] = [];
	const calls: string[] = [];
	const data: DataApi = {
		get: async (path, query) => {
			calls.push(`get ${path.join('/')} page ${query.page}`);
			const start = (query.page - 1) * 2;
			return { items: folders.slice(start, start + 2), has_more: start + 2 < folders.length };
		},
		post: async (path, _query, body) => {
			calls.push(`post ${path.join('/')}`);
			if (path[0] === 'folders') {
				const folder = { id: `folder${folders.length + 1}`, title: body.title, parent_id: '' };
				folders.push(folder);
				return folder;
			}
			if (body.title === options.failOnTitle) throw new Error('Database is locked');
			const note = { id: `note${notes.length + 1}`, ...body };
			notes.push(note);
			return note;
		},
	};
	return { data, folders, notes, calls };
}

const chosen = (name: string, text: string) => ({ name, text: async () => text });

describe('importChosenFiles', () => {
	it('creates the notebook on first use and one note per thread in it', async () => {
		const { data, folders, notes } = fakeData([{ id: 'other', title: 'Inbox', parent_id: '' }]);
		const result = await importChosenFiles(data, [chosen('batch.csv', fixture('batch.csv'))]);
		expect(result).toEqual({ noteIds: ['note1', 'note2'], problems: [] });
		expect(folders.map((folder) => folder.title)).toEqual(['Inbox', NOTEBOOK_TITLE]);
		expect(notes.map(({ parent_id, title, source_url }) => ({ parent_id, title, source_url }))).toEqual([
			{ parent_id: 'folder2', title: 'Which CRM do small teams actually like?', source_url: 'https://www.reddit.com/r/testsub/comments/1abcxyz/title/' },
			{ parent_id: 'folder2', title: 'Show HN: A tiny thing: with "quotes" / slashes?', source_url: 'https://news.ycombinator.com/item?id=1' },
		]);
		expect(notes[0]!.body).toMatch(/^- Source: Reddit · r\/testsub · /);
	});

	it('reuses a top-level Comment Scraper notebook found on a later page', async () => {
		const { data, folders, notes, calls } = fakeData([
			{ id: 'a', title: 'Inbox', parent_id: '' },
			{ id: 'nested', title: NOTEBOOK_TITLE, parent_id: 'a' },
			{ id: 'b', title: 'Work', parent_id: '' },
			{ id: 'mine', title: NOTEBOOK_TITLE, parent_id: '' },
		]);
		await importChosenFiles(data, [chosen('one.json', fixture('batch-flat.json')), chosen('two.json', fixture('batch-nested.json'))]);
		expect(folders).toHaveLength(4);
		expect(notes.map((note) => note.parent_id)).toEqual(['mine', 'mine', 'mine', 'mine']);
		// The notebook is looked up once per import, not once per note.
		expect(calls.filter((call) => call.startsWith('get'))).toEqual(['get folders page 1', 'get folders page 2']);
	});

	it('importing the same thread again adds a second note', async () => {
		const { data, notes } = fakeData();
		await importChosenFiles(data, [chosen('a.json', fixture('batch-flat.json'))]);
		await importChosenFiles(data, [chosen('a.json', fixture('batch-flat.json'))]);
		expect(notes.map((note) => note.title)).toEqual([
			'Which CRM do small teams actually like?',
			'Show HN: A tiny thing: with "quotes" / slashes?',
			'Which CRM do small teams actually like?',
			'Show HN: A tiny thing: with "quotes" / slashes?',
		]);
		expect(new Set(notes.map((note) => note.parent_id)).size).toBe(1);
	});

	it('reports files and threads that fail and imports the rest', async () => {
		const { data, folders, notes } = fakeData([], { failOnTitle: 'Which CRM do small teams actually like?' });
		const damaged = JSON.parse(fixture('batch-flat.json'));
		delete damaged.threads[1].records[1].body;
		const result = await importChosenFiles(data, [
			chosen('notes.txt', 'just some text'),
			chosen('thread.json', JSON.stringify(damaged)),
			chosen('again.json', fixture('batch-flat.json')),
		]);
		expect(result.problems).toEqual([
			'notes.txt: not a Comment Scraper JSON or CSV export.',
			'thread.json: skipped 1 damaged thread.',
			'Which CRM do small teams actually like?: Database is locked.',
			'Which CRM do small teams actually like?: Database is locked.',
		]);
		expect(notes.map((note) => note.title)).toEqual(['Show HN: A tiny thing: with "quotes" / slashes?']);
		expect(folders).toHaveLength(1);
	});

	it('creates no notebook when nothing could be imported', async () => {
		const { data, folders, calls } = fakeData();
		const result = await importChosenFiles(data, [chosen('x.csv', 'name,email\n')]);
		expect(result).toEqual({ noteIds: [], problems: ['x.csv: not a Comment Scraper JSON or CSV export.'] });
		expect(folders).toEqual([]);
		expect(calls).toEqual([]);
	});

	it('only stores a web address as the source URL', async () => {
		const { data, notes } = fakeData();
		const export_ = JSON.parse(fixture('batch-flat.json'));
		export_.threads = export_.threads.slice(1);
		export_.threads[0].records[0].permalink = 'javascript:alert(1)';
		await importChosenFiles(data, [chosen('hn.json', JSON.stringify(export_))]);
		expect(notes[0]!.source_url).toBe('');
	});
});

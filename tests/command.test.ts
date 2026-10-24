import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import type Joplin from 'api/Joplin';
import { describe, expect, it } from 'vitest';
import { importFromFileDialog } from '../src/import/command';

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** The parts of the plugin API the command uses, recording what it was asked to do. */
const defaultData = () => {
	let notes = 0;
	return {
		get: async () => ({ items: [], has_more: false }),
		post: async (path: string[]) => ({ id: path[0] === 'folders' ? 'folder1' : `note${++notes}` }),
	};
};

function fakeJoplin(pickedPaths: string[] | null, data: unknown = defaultData()) {
	const shown: string[] = [];
	const read: string[] = [];
	const joplin = {
		views: {
			dialogs: {
				showOpenDialog: async (options: unknown) => {
					shown.push(`open dialog ${JSON.stringify(options)}`);
					return pickedPaths;
				},
				showMessageBox: async (message: string) => {
					shown.push(`message box: ${message}`);
					return 0;
				},
				showToast: async (toast: { message: string; type: string }) => {
					shown.push(`${toast.type} toast: ${toast.message}`);
				},
			},
		},
		require: (name: string) => {
			expect(name).toBe('fs-extra');
			return {
				readFile: (path: string, encoding: string) => {
					read.push(path);
					return readFile(path, encoding as BufferEncoding);
				},
			};
		},
		data,
		commands: {
			execute: async (command: string, ...args: unknown[]) => {
				shown.push(`command ${command} ${args.join(' ')}`);
			},
		},
	};
	return { joplin: joplin as unknown as Joplin, shown, read };
}

describe('importFromFileDialog', () => {
	it('asks for one or more JSON or CSV files', async () => {
		const { joplin, shown, read } = fakeJoplin(null);
		await importFromFileDialog(joplin);
		expect(shown).toEqual([
			'open dialog {"properties":["openFile","multiSelections"],"filters":[{"name":"Comment Scraper export","extensions":["json","csv"]}]}',
		]);
		expect(read).toEqual([]);
	});

	it('does nothing when the dialog is closed without a file', async () => {
		const { joplin, shown } = fakeJoplin([]);
		await importFromFileDialog(joplin);
		expect(shown).toHaveLength(1);
	});

	it('imports the picked files, opens the first note and says how many went in', async () => {
		const paths = [fixturePath('batch.csv'), fixturePath('batch-nested.json')];
		const { joplin, shown, read } = fakeJoplin(paths);
		await importFromFileDialog(joplin);
		expect(read).toEqual(paths);
		expect(shown.slice(1)).toEqual(['command openNote note1', 'success toast: Imported 4 threads into the Comment Scraper notebook.']);
	});

	it('lists what could not be imported, by file name', async () => {
		const { joplin, shown } = fakeJoplin([fixturePath('batch-flat.reddit.md'), fixturePath('batch-flat.json')]);
		await importFromFileDialog(joplin);
		expect(shown.slice(1)).toEqual([
			'command openNote note1',
			'message box: Imported 2 threads into the Comment Scraper notebook. Not everything was imported:\nbatch-flat.reddit.md: not a Comment Scraper JSON or CSV export.',
		]);
	});

	it('runs imports one at a time, so a second import uses the notebook the first one made', async () => {
		// A data API that yields between calls, so two imports would interleave if allowed to.
		const folders: { id: string; title: string; parent_id: string }[] = [];
		const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
		const data = {
			get: async () => {
				await tick();
				return { items: [...folders], has_more: false };
			},
			post: async (path: string[], _query: unknown, body: { title: string }) => {
				await tick();
				if (path[0] !== 'folders') return { id: 'note' };
				const folder = { id: `folder${folders.length + 1}`, title: body.title, parent_id: '' };
				folders.push(folder);
				return folder;
			},
		};
		const first = fakeJoplin([fixturePath('batch.csv')], data);
		const second = fakeJoplin([fixturePath('batch-flat.json')], data);
		await Promise.all([importFromFileDialog(first.joplin), importFromFileDialog(second.joplin)]);
		expect(folders).toHaveLength(1);
	});

	it('says so when nothing was imported', async () => {
		const { joplin, shown } = fakeJoplin([fixturePath('batch-flat.hn.md')]);
		await importFromFileDialog(joplin);
		expect(shown.slice(1)).toEqual(['message box: Nothing was imported:\nbatch-flat.hn.md: not a Comment Scraper JSON or CSV export.']);
	});
});

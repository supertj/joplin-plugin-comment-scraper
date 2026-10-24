import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import type Joplin from 'api/Joplin';
import { describe, expect, it } from 'vitest';
import { importFromFileDialog } from '../src/import/command';

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** The parts of the plugin API the command uses, recording what it was asked to do. */
function fakeJoplin(pickedPaths: string[] | null) {
	const shown: string[] = [];
	const read: string[] = [];
	let notes = 0;
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
		data: {
			get: async () => ({ items: [], has_more: false }),
			post: async (path: string[]) => ({ id: path[0] === 'folders' ? 'folder1' : `note${++notes}` }),
		},
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

	it('says so when nothing was imported', async () => {
		const { joplin, shown } = fakeJoplin([fixturePath('batch-flat.hn.md')]);
		await importFromFileDialog(joplin);
		expect(shown.slice(1)).toEqual(['message box: Nothing was imported:\nbatch-flat.hn.md: not a Comment Scraper JSON or CSV export.']);
	});
});

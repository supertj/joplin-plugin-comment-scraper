import type Joplin from 'api/Joplin';
import { ToastType } from 'api/types';
import { importChosenFiles, NOTEBOOK_TITLE, type ImportResult } from './import-files';

// Imports run one after another. Two at once (the command run again before the first is done)
// could each find no Comment Scraper notebook and both create one.
let previousImport: Promise<unknown> = Promise.resolve();

/**
 * Asks for export files, imports them and says how it went. The files picked here are the only
 * ones the plugin reads, and it makes no network requests.
 */
export async function importFromFileDialog(joplin: Joplin): Promise<void> {
	const paths: string[] | null = await joplin.views.dialogs.showOpenDialog({
		properties: ['openFile', 'multiSelections'],
		filters: [{ name: 'Comment Scraper export', extensions: ['json', 'csv'] }],
	});
	if (!paths || paths.length === 0) return;

	const fs = joplin.require('fs-extra');
	const files = paths.map((path) => ({ name: fileName(path), text: (): Promise<string> => fs.readFile(path, 'utf8') }));
	const thisImport: Promise<ImportResult> = previousImport.then(() => importChosenFiles(joplin.data, files));
	previousImport = thisImport.catch(() => undefined);
	const { noteIds, problems } = await thisImport;

	if (noteIds.length > 0) await joplin.commands.execute('openNote', noteIds[0]);
	const imported = `Imported ${noteIds.length} ${noteIds.length === 1 ? 'thread' : 'threads'} into the ${NOTEBOOK_TITLE} notebook.`;
	if (problems.length > 0) {
		const summary = noteIds.length > 0 ? `${imported} Not everything was imported:` : 'Nothing was imported:';
		await joplin.views.dialogs.showMessageBox([summary, ...problems].join('\n'));
	} else if (noteIds.length > 0) {
		await joplin.views.dialogs.showToast({ message: imported, type: ToastType.Success });
	} else {
		await joplin.views.dialogs.showMessageBox('No threads found in the chosen files.');
	}
}

/** The last part of a path, on Windows too. */
function fileName(path: string): string {
	return path.split(/[\\/]/).pop() || path;
}

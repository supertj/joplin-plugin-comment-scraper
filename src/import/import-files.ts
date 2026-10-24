import { noteTitle, threadToNoteBody, webAddress } from './note';
import { parseExport } from './parse';

export const NOTEBOOK_TITLE = 'Comment Scraper';

/** The two joplin.data calls the import makes, so tests can pass a stand-in. */
export interface DataApi {
	get(path: string[], query?: any): Promise<any>;
	post(path: string[], query?: any, body?: any): Promise<any>;
}

/** A file the user picked. Only what the import needs, so tests can pass a stand-in. */
export interface ChosenFile {
	name: string;
	text(): Promise<string>;
}

export interface ImportResult {
	noteIds: string[];
	problems: string[];
}

/**
 * Creates one note per thread in the "Comment Scraper" notebook, which is made on the first
 * import that has something to add. Existing notes are never changed: importing a thread again
 * adds a second note. A file or thread that fails is reported in `problems` and the rest still go in.
 */
export async function importChosenFiles(data: DataApi, files: ChosenFile[]): Promise<ImportResult> {
	let notebookId: string | null = null;
	const noteIds: string[] = [];
	const problems: string[] = [];
	for (const file of files) {
		let parsed;
		try {
			parsed = parseExport(await file.text());
		} catch (error) {
			problems.push(`${file.name}: ${errorText(error)}.`);
			continue;
		}
		if (parsed.skipped > 0) {
			problems.push(`${file.name}: skipped ${parsed.skipped} damaged ${parsed.skipped === 1 ? 'thread' : 'threads'}.`);
		}
		for (const thread of parsed.threads) {
			const title = noteTitle(thread);
			try {
				notebookId = notebookId ?? (await findOrCreateNotebook(data));
				const note = await data.post(['notes'], null, {
					parent_id: notebookId,
					title,
					body: threadToNoteBody(thread),
					// Shown as a clickable link in the note properties, so only a web address goes in.
					source_url: webAddress(thread.url) ?? '',
				});
				noteIds.push(note.id);
			} catch (error) {
				problems.push(`${title}: ${errorText(error)}.`);
			}
		}
	}
	return { noteIds, problems };
}

/** The top-level notebook named "Comment Scraper", created if there isn't one. The data API leaves out notebooks in the trash. */
async function findOrCreateNotebook(data: DataApi): Promise<string> {
	for (let page = 1; ; page++) {
		const { items, has_more } = await data.get(['folders'], { fields: ['id', 'title', 'parent_id'], page });
		const match = items.find((folder: { title: string; parent_id: string }) => folder.title === NOTEBOOK_TITLE && !folder.parent_id);
		if (match) return match.id;
		if (!has_more) break;
	}
	const notebook = await data.post(['folders'], null, { title: NOTEBOOK_TITLE });
	return notebook.id;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

import joplin from 'api';
import { MenuItemLocation } from 'api/types';
import { importFromFileDialog } from './import/command';

const COMMAND_NAME = 'commentScraperImportFiles';

joplin.plugins.register({
	onStart: async function() {
		// A command with a label also shows up in the command palette.
		await joplin.commands.register({
			name: COMMAND_NAME,
			label: 'Import Comment Scraper export...',
			execute: () => importFromFileDialog(joplin),
		});
		await joplin.views.menuItems.create(`${COMMAND_NAME}MenuItem`, COMMAND_NAME, MenuItemLocation.Tools);
	},
});

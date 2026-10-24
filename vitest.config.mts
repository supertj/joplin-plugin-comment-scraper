import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The plugin imports the Joplin API as "api", which webpack resolves to ./api. Tests do the same.
export default defineConfig({
	resolve: {
		alias: { api: fileURLToPath(new URL('./api', import.meta.url)) },
	},
	test: {
		include: ['tests/**/*.test.ts'],
	},
});

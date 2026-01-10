import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
				allowDefaultProject: [
					'eslint.config.mts',
					'manifest.json',
					'__mocks__/obsidian.ts',
					'scripts/debug.js',
					'tests/integration/opencode-server.test.ts',
					'tests/integration/agent-loop.test.ts',
					'tests/security/config-loader.test.ts',
					'tests/unit/retrieval-strategy.test.ts',
					'vitest.config.ts'
				]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		ignores: [
			"node_modules/**",
			"dist/**",
			"esbuild.config.mjs",
			"eslint.config.mts",
			"version-bump.mjs",
			"versions.json",
			"main.js",
		],
	},
	{
		files: ["scripts/**/*.js", "vitest.config.ts"],
		rules: {
			"import/no-nodejs-modules": "off",
			"no-console": "off",
			"no-undef": "off",
		},
	},
	{
		files: ["package.json"],
		rules: {
			"depend/ban-dependencies": "off",
		},
	},
);

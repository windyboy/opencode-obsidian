import path from 'path'
import { fileURLToPath } from 'url'
import globals from 'globals'
import obsidianmd from 'eslint-plugin-obsidianmd'
import tseslint from 'typescript-eslint'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

type TseslintConfig = Parameters<typeof tseslint.config>[number]

const obsidianRecommended = obsidianmd.configs?.recommended
const obsidianConfigs = (
	Array.isArray(obsidianRecommended)
		? obsidianRecommended
		: obsidianRecommended
			? [obsidianRecommended]
			: []
).flatMap(config => {
	if (!config || typeof config !== 'object') {
		return []
	}
	const candidate = config as Record<string, unknown>
	const hasConfigKey = [
		'rules',
		'plugins',
		'languageOptions',
		'files',
		'ignores',
		'processor',
		'settings',
		'linterOptions'
	].some(key => key in candidate)

	if (hasConfigKey) {
		return [candidate as TseslintConfig]
	}

	return [{ rules: candidate } as TseslintConfig]
}) as TseslintConfig[]

export default tseslint.config(
	{
		ignores: [
			'node_modules/**',
			'dist/**',
			'esbuild.config.mjs',
			'eslint.config.mts',
			'version-bump.mjs',
			'versions.json',
			'main.js',
			'package.json',
			'manifest.json',
		],
	},
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'__mocks__/obsidian.ts',
						'scripts/debug.js',
						'tests/integration/opencode-server.test.ts',
						'tests/integration/agent-loop.test.ts',
						'tests/security/config-loader.test.ts',
						'tests/unit/retrieval-strategy.test.ts',
						'vitest.config.ts',
					],
				},
				tsconfigRootDir: __dirname,
			},
		},
	},
	{
		files: ['scripts/**/*.js', 'vitest.config.ts'],
		rules: {
			'import/no-nodejs-modules': 'off',
			'no-console': 'off',
			'no-undef': 'off',
		},
	},
	{
		files: ['package.json'],
		rules: {
			'depend/ban-dependencies': 'off',
		},
	},
)

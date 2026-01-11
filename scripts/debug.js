#!/usr/bin/env node
/**
 * Debug utility for OpenCode Obsidian plugin
 * Helps verify plugin files and configuration
 */

import { readFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, '..')

console.log('🔍 OpenCode Obsidian Plugin Debug Tool\n')

// Check required files
const requiredFiles = [
  'manifest.json',
  'main.js',
  'styles.css',
  'versions.json'
]

console.log('📁 Checking required files...')
let allFilesExist = true
for (const file of requiredFiles) {
  const filePath = join(rootDir, file)
  if (existsSync(filePath)) {
    const stats = statSync(filePath)
    console.log(`  ✅ ${file} (${(stats.size / 1024).toFixed(2)} KB)`)
  } else {
    console.log(`  ❌ ${file} - MISSING`)
    allFilesExist = false
  }
}

// Check manifest.json
console.log('\n📋 Checking manifest.json...')
try {
  const manifestPath = join(rootDir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  
  const requiredFields = ['id', 'name', 'version', 'minAppVersion', 'description']
  for (const field of requiredFields) {
    if (manifest[field]) {
      console.log(`  ✅ ${field}: ${manifest[field]}`)
    } else {
      console.log(`  ❌ ${field}: MISSING`)
    }
  }
} catch (error) {
  console.log(`  ❌ Error reading manifest.json: ${error.message}`)
}

// Check main.js export
console.log('\n🔌 Checking main.js export...')
try {
  const mainJsPath = join(rootDir, 'main.js')
  const mainJs = readFileSync(mainJsPath, 'utf8')
  
  if (mainJs.includes('module.exports = F;')) {
    console.log('  ✅ Correct CommonJS export found')
  } else if (mainJs.includes('module.exports')) {
    console.log('  ⚠️  module.exports found but format may be incorrect')
    const exportMatch = mainJs.match(/module\.exports\s*=\s*[^;]+;/)
    if (exportMatch) {
      console.log(`  📝 Export: ${exportMatch[0].substring(0, 50)}...`)
    }
  } else {
    console.log('  ❌ No module.exports found - plugin will not load!')
  }
  
  // Check for sourcemap
  if (mainJs.includes('//# sourceMappingURL=')) {
    console.log('  ✅ Sourcemap found (dev mode)')
  } else {
    console.log('  ℹ️  No sourcemap (production build)')
  }
} catch (error) {
  console.log(`  ❌ Error reading main.js: ${error.message}`)
}

// Check TypeScript compilation
console.log('\n📝 Checking TypeScript files...')
try {
  const srcFiles = [
    'src/main.ts',
    'src/opencode-client.ts',
    'src/opencode-obsidian-view.ts',
    'src/settings.ts',
    'src/types.ts'
  ]
  
  for (const file of srcFiles) {
    const filePath = join(rootDir, file)
    if (existsSync(filePath)) {
      console.log(`  ✅ ${file}`)
    } else {
      console.log(`  ❌ ${file} - MISSING`)
    }
  }
} catch (error) {
  console.log(`  ❌ Error checking TypeScript files: ${error.message}`)
}

// Summary
console.log('\n📊 Summary:')
if (allFilesExist) {
  console.log('  ✅ All required files are present')
  console.log('\n💡 Next steps:')
  // Note: This is documentation text, not actual code. The path is Obsidian's default config directory.
  console.log('  1. Copy plugin folder to your vault: .obsidian/plugins/opencode-obsidian/')
  console.log('  2. Reload Obsidian (Cmd/Ctrl + R)')
  console.log('  3. Enable plugin in Settings → Community Plugins')
  console.log('  4. Open Developer Tools:')
  console.log('     - macOS: Press Cmd + Option + I')
  console.log('     - Windows/Linux: Press Ctrl + Shift + I')
  console.log('     - Or: View menu → Toggle Developer Tools')
} else {
  console.log('  ❌ Some required files are missing')
  console.log('  💡 Run: pnpm run build')
}

console.log('\n')

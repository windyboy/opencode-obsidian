import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

// 确保使用正确的模块解析
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log('开始打包插件...');

// 1. 执行构建命令
console.log('执行构建命令...');
try {
  execSync('bun run build', { cwd: projectRoot, stdio: 'inherit' });
} catch (error) {
  console.error('构建失败:', error.message);
  process.exit(1);
}

// 2. 读取manifest.json获取版本信息
const manifestPath = path.join(projectRoot, 'manifest.json');
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error('读取manifest.json失败:', error.message);
  process.exit(1);
}

const { id, version } = manifest;
const packageName = `${id}-${version}.zip`;
const packagePath = path.join(projectRoot, 'dist', packageName);

// 3. 创建dist目录
const distDir = path.join(projectRoot, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 4. 收集需要打包的文件
const filesToInclude = [
  'main.js',
  'manifest.json',
  'versions.json',
  'styles.css'
];

// 检查所有必要文件是否存在
for (const file of filesToInclude) {
  const filePath = path.join(projectRoot, file);
  if (!fs.existsSync(filePath)) {
    console.error(`错误: 文件 ${file} 不存在`);
    process.exit(1);
  }
}

// 5. 打包文件
console.log(`创建打包文件: ${packagePath}`);

// 根据操作系统选择不同的打包方法
try {
  if (process.platform === 'win32') {
    // Windows: 使用PowerShell的Compress-Archive命令
    const filesList = filesToInclude.map(file => path.join(projectRoot, file)).join(',');
    const tempDir = path.join(projectRoot, 'temp-package');
    
    // 创建临时目录
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // 复制文件到临时目录
    filesToInclude.forEach(file => {
      const src = path.join(projectRoot, file);
      const dest = path.join(tempDir, file);
      fs.copyFileSync(src, dest);
    });
    
    // 使用PowerShell压缩
    execSync(
      `powershell -Command "Compress-Archive -Path '${tempDir}/*' -DestinationPath '${packagePath}' -Force"`,
      { stdio: 'inherit' }
    );
    
    // 删除临时目录
    fs.rmSync(tempDir, { recursive: true, force: true });
  } else {
    // Linux/macOS: 使用zip命令
    const filesList = filesToInclude.join(' ');
    execSync(`cd "${projectRoot}" && zip -r "${packagePath}" ${filesList}`, { stdio: 'inherit' });
  }
  
  console.log('打包成功!');
  console.log(`插件包已创建: ${packagePath}`);
} catch (error) {
  console.error('打包失败:', error.message);
  
  // 如果打包命令失败，提示用户手动打包
  console.log('\n如果遇到打包问题，请手动打包以下文件:');
  filesToInclude.forEach(file => console.log(`- ${file}`));
  
  process.exit(1);
}

console.log('\n插件打包完成!');
console.log('您可以将', packageName, '上传到Obsidian插件市场或直接安装到Obsidian中。');

import * as fs from 'node:fs';
import * as path from 'node:path';
import { InstalledDependency, InternalUtility, PackageSystem, WorkspaceArchitectureScan } from './types.js';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'target',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  'venv',
  '.venv',
  'env',
  '.env',
  '__pycache__',
  '.pytest_cache',
  '.idea',
  '.vscode',
  '.gemini',
  'coverage',
  '.gradle'
]);

const UTILITY_DIR_NAMES = new Set([
  'utils',
  'util',
  'lib',
  'common',
  'helpers',
  'helper',
  'core',
  'shared'
]);

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.rb',
  '.cs',
  '.cpp',
  '.c',
  '.h'
]);

/**
 * Parses package.json content
 */
export function parsePackageJson(content: string, filePath: string): InstalledDependency[] {
  const deps: InstalledDependency[] = [];
  try {
    const pkg = JSON.parse(content);

    const parseSection = (section: Record<string, string> | undefined, isDev: boolean) => {
      if (!section || typeof section !== 'object') return;
      for (const [name, version] of Object.entries(section)) {
        if (typeof version === 'string') {
          deps.push({
            name,
            version,
            system: 'npm',
            sourceFile: filePath,
            isDev
          });
        }
      }
    };

    parseSection(pkg.dependencies, false);
    parseSection(pkg.devDependencies, true);
    parseSection(pkg.peerDependencies, false);
    parseSection(pkg.optionalDependencies, false);
  } catch {
    // Ignore JSON parse errors in malformed files
  }
  return deps;
}

/**
 * Parses requirements.txt content
 */
export function parseRequirementsTxt(content: string, filePath: string): InstalledDependency[] {
  const deps: InstalledDependency[] = [];
  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('-r') || line.startsWith('-e') || line.startsWith('-i')) {
      continue;
    }
    // Match package name and optional version specifier
    const match = line.match(/^([a-zA-Z0-9_\-\.]+)(?:([=><~!^].*))?$/);
    if (match) {
      const name = match[1];
      const version = match[2]?.trim();
      deps.push({
        name,
        version: version || undefined,
        system: 'pypi',
        sourceFile: filePath,
        isDev: filePath.toLowerCase().includes('dev')
      });
    }
  }
  return deps;
}

/**
 * Parses pyproject.toml content (Poetry, Flit, Hatch, PEP 621)
 */
export function parsePyprojectToml(content: string, filePath: string): InstalledDependency[] {
  const deps: InstalledDependency[] = [];
  const lines = content.split('\n');
  let currentSection = '';
  let inDependenciesArray = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Check for section headers e.g. [project] or [tool.poetry.dependencies]
    const sectionMatch = line.match(/^\[(.*)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      inDependenciesArray = false;
      continue;
    }

    const isDev = currentSection.includes('dev') || currentSection.includes('test');

    // PEP 621 dependencies = [ "package>=1.0.0", ... ]
    if (currentSection === 'project' && line.startsWith('dependencies = [')) {
      inDependenciesArray = true;
      continue;
    }

    if (inDependenciesArray) {
      if (line.includes(']')) {
        inDependenciesArray = false;
        continue;
      }
      const depMatch = line.match(/^["']([a-zA-Z0-9_\-\.]+)(?:([=><~!^][^"']*))?["'],?$/);
      if (depMatch) {
        deps.push({
          name: depMatch[1],
          version: depMatch[2]?.trim(),
          system: 'pypi',
          sourceFile: filePath,
          isDev: false
        });
      }
      continue;
    }

    // Poetry / generic key = value dependencies e.g., requests = "^2.28.0" or requests = { version = "..." }
    if (currentSection.includes('dependencies')) {
      const kvMatch = line.match(/^([a-zA-Z0-9_\-\.]+)\s*=\s*(.*)$/);
      if (kvMatch) {
        const name = kvMatch[1];
        if (name.toLowerCase() === 'python') continue; // Skip python version specifier
        let versionVal = kvMatch[2].trim();
        // Extract string version if quoted
        const strMatch = versionVal.match(/^["']([^"']+)["']/);
        if (strMatch) {
          versionVal = strMatch[1];
        } else {
          const tableVersion = versionVal.match(/version\s*=\s*["']([^"']+)["']/);
          if (tableVersion) {
            versionVal = tableVersion[1];
          }
        }
        deps.push({
          name,
          version: versionVal,
          system: 'pypi',
          sourceFile: filePath,
          isDev
        });
      }
    }
  }
  return deps;
}

/**
 * Parses Cargo.toml content
 */
export function parseCargoToml(content: string, filePath: string): InstalledDependency[] {
  const deps: InstalledDependency[] = [];
  const lines = content.split('\n');
  let currentSection = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[(.*)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    const isDepSection =
      currentSection === 'dependencies' ||
      currentSection.startsWith('dependencies.') ||
      currentSection === 'dev-dependencies' ||
      currentSection === 'build-dependencies';

    if (isDepSection) {
      const kvMatch = line.match(/^([a-zA-Z0-9_\-]+)\s*=\s*(.*)$/);
      if (kvMatch) {
        const name = kvMatch[1];
        let versionVal = kvMatch[2].trim();
        const strMatch = versionVal.match(/^["']([^"']+)["']/);
        if (strMatch) {
          versionVal = strMatch[1];
        } else {
          const tableVersion = versionVal.match(/version\s*=\s*["']([^"']+)["']/);
          if (tableVersion) {
            versionVal = tableVersion[1];
          }
        }
        deps.push({
          name,
          version: versionVal,
          system: 'cargo',
          sourceFile: filePath,
          isDev: currentSection.includes('dev')
        });
      }
    }
  }
  return deps;
}

/**
 * Parses Maven pom.xml content using simple regex
 */
export function parsePomXml(content: string, filePath: string): InstalledDependency[] {
  const deps: InstalledDependency[] = [];
  const depBlockRegex = /<dependency>([\s\S]*?)<\/dependency>/g;
  let match: RegExpExecArray | null;

  while ((match = depBlockRegex.exec(content)) !== null) {
    const block = match[1];
    const groupId = block.match(/<groupId>(.*?)<\/groupId>/)?.[1]?.trim();
    const artifactId = block.match(/<artifactId>(.*?)<\/artifactId>/)?.[1]?.trim();
    const version = block.match(/<version>(.*?)<\/version>/)?.[1]?.trim();
    const scope = block.match(/<scope>(.*?)<\/scope>/)?.[1]?.trim();

    if (artifactId) {
      const name = groupId ? `${groupId}:${artifactId}` : artifactId;
      deps.push({
        name,
        version: version || undefined,
        system: 'maven',
        sourceFile: filePath,
        isDev: scope === 'test'
      });
    }
  }
  return deps;
}

/**
 * Parses Go go.mod content
 */
export function parseGoMod(content: string, filePath: string): InstalledDependency[] {
  const deps: InstalledDependency[] = [];
  const lines = content.split('\n');
  let inRequireBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;

    if (line === 'require (') {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && line === ')') {
      inRequireBlock = false;
      continue;
    }

    if (inRequireBlock) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        deps.push({
          name: parts[0],
          version: parts[1],
          system: 'go',
          sourceFile: filePath,
          isDev: false
        });
      }
    } else if (line.startsWith('require ')) {
      const parts = line.substring(8).trim().split(/\s+/);
      if (parts.length >= 2) {
        deps.push({
          name: parts[0],
          version: parts[1],
          system: 'go',
          sourceFile: filePath,
          isDev: false
        });
      }
    }
  }
  return deps;
}

/**
 * Recursively scans directory for manifests and internal utility directories
 */
export async function scanWorkspaceArchitecture(
  rootPath: string,
  maxDepth: number = 5
): Promise<WorkspaceArchitectureScan> {
  const resolvedRoot = path.resolve(rootPath);
  const manifestsFound: string[] = [];
  const allDependencies: InstalledDependency[] = [];
  const internalUtilities: InternalUtility[] = [];

  async function walk(currentDir: string, currentDepth: number) {
    if (currentDepth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(resolvedRoot, fullPath);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;

        // If this directory name matches a utility directory convention, inspect its files
        if (UTILITY_DIR_NAMES.has(entry.name.toLowerCase())) {
          await collectUtilityFiles(fullPath);
        }

        await walk(fullPath, currentDepth + 1);
      } else if (entry.isFile()) {
        const fileName = entry.name.toLowerCase();

        try {
          if (fileName === 'package.json') {
            manifestsFound.push(relativePath);
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            allDependencies.push(...parsePackageJson(content, relativePath));
          } else if (fileName === 'pyproject.toml') {
            manifestsFound.push(relativePath);
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            allDependencies.push(...parsePyprojectToml(content, relativePath));
          } else if (fileName === 'requirements.txt' || fileName.endsWith('.requirements.txt')) {
            manifestsFound.push(relativePath);
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            allDependencies.push(...parseRequirementsTxt(content, relativePath));
          } else if (fileName === 'cargo.toml') {
            manifestsFound.push(relativePath);
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            allDependencies.push(...parseCargoToml(content, relativePath));
          } else if (fileName === 'pom.xml') {
            manifestsFound.push(relativePath);
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            allDependencies.push(...parsePomXml(content, relativePath));
          } else if (fileName === 'go.mod') {
            manifestsFound.push(relativePath);
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            allDependencies.push(...parseGoMod(content, relativePath));
          }
        } catch {
          // File read error, skip
        }
      }
    }
  }

  async function collectUtilityFiles(utilDir: string) {
    try {
      const entries = await fs.promises.readdir(utilDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (CODE_EXTENSIONS.has(ext)) {
            const fullPath = path.join(utilDir, entry.name);
            internalUtilities.push({
              name: entry.name,
              relativePath: path.relative(resolvedRoot, fullPath),
              fullPath,
              extension: ext
            });
          }
        }
      }
    } catch {
      // Directory read error, skip
    }
  }

  await walk(resolvedRoot, 0);

  // Deduplicate dependencies by name & system
  const uniqueDepsMap = new Map<string, InstalledDependency>();
  for (const dep of allDependencies) {
    const key = `${dep.system}:${dep.name.toLowerCase()}`;
    if (!uniqueDepsMap.has(key) || (!dep.isDev && uniqueDepsMap.get(key)?.isDev)) {
      uniqueDepsMap.set(key, dep);
    }
  }

  return {
    rootPath: resolvedRoot,
    manifestsFound,
    totalDependencies: uniqueDepsMap.size,
    dependencies: Array.from(uniqueDepsMap.values()),
    internalUtilities
  };
}

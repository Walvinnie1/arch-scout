import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  parsePackageJson,
  parsePyprojectToml,
  parseRequirementsTxt,
  parseCargoToml,
  parsePomXml,
  parseGoMod,
  scanWorkspaceArchitecture
} from '../src/manifest-scanner.js';

describe('Manifest Scanner', () => {
  it('correctly parses package.json dependencies and devDependencies', () => {
    const content = JSON.stringify({
      name: 'sample-project',
      dependencies: {
        zod: '^3.22.4',
        lodash: '^4.17.21'
      },
      devDependencies: {
        typescript: '^5.0.0',
        vitest: '^1.0.0'
      }
    });

    const deps = parsePackageJson(content, 'package.json');
    expect(deps).toHaveLength(4);

    const zodDep = deps.find((d) => d.name === 'zod');
    expect(zodDep).toBeDefined();
    expect(zodDep?.version).toBe('^3.22.4');
    expect(zodDep?.isDev).toBe(false);
    expect(zodDep?.system).toBe('npm');

    const vitestDep = deps.find((d) => d.name === 'vitest');
    expect(vitestDep?.isDev).toBe(true);
  });

  it('correctly parses requirements.txt specifiers', () => {
    const content = `
# Core dependencies
fastapi>=0.100.0
pydantic~=2.5.0
requests==2.31.0
pytest
-r other-requirements.txt
`;
    const deps = parseRequirementsTxt(content, 'requirements.txt');
    expect(deps.length).toBe(4);

    const fastapi = deps.find((d) => d.name === 'fastapi');
    expect(fastapi?.version).toBe('>=0.100.0');

    const pytest = deps.find((d) => d.name === 'pytest');
    expect(pytest?.version).toBeUndefined();
  });

  it('correctly parses pyproject.toml for Poetry and PEP 621', () => {
    const content = `
[tool.poetry.dependencies]
python = "^3.11"
tenacity = "^8.2.0"
httpx = { version = ">=0.24.0", extras = ["http2"] }

[tool.poetry.group.dev.dependencies]
black = "^23.0"
`;
    const deps = parsePyprojectToml(content, 'pyproject.toml');
    expect(deps.length).toBe(3);

    const tenacity = deps.find((d) => d.name === 'tenacity');
    expect(tenacity?.version).toBe('^8.2.0');
    expect(tenacity?.isDev).toBe(false);

    const black = deps.find((d) => d.name === 'black');
    expect(black?.isDev).toBe(true);
  });

  it('correctly parses Cargo.toml dependencies', () => {
    const content = `
[package]
name = "rusty-gate"
version = "0.1.0"

[dependencies]
tokio = { version = "1.35", features = ["full"] }
serde = "1.0"

[dev-dependencies]
tempfile = "3.8"
`;
    const deps = parseCargoToml(content, 'Cargo.toml');
    expect(deps.length).toBe(3);

    const tokio = deps.find((d) => d.name === 'tokio');
    expect(tokio?.version).toBe('1.35');
    expect(tokio?.isDev).toBe(false);
    expect(tokio?.system).toBe('cargo');

    const tempfile = deps.find((d) => d.name === 'tempfile');
    expect(tempfile?.isDev).toBe(true);
  });

  it('correctly parses pom.xml Maven dependencies', () => {
    const content = `
<project>
  <dependencies>
    <dependency>
      <groupId>com.google.guava</groupId>
      <artifactId>guava</artifactId>
      <version>32.1.2-jre</version>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.0</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>
`;
    const deps = parsePomXml(content, 'pom.xml');
    expect(deps.length).toBe(2);

    const guava = deps.find((d) => d.name === 'com.google.guava:guava');
    expect(guava?.version).toBe('32.1.2-jre');
    expect(guava?.isDev).toBe(false);
    expect(guava?.system).toBe('maven');

    const junit = deps.find((d) => d.name === 'org.junit.jupiter:junit-jupiter');
    expect(junit?.isDev).toBe(true);
  });

  it('correctly parses go.mod dependencies', () => {
    const content = `
module example.com/my-service

go 1.21

require (
    github.com/gin-gonic/gin v1.9.1
    go.uber.org/zap v1.26.0
)
`;
    const deps = parseGoMod(content, 'go.mod');
    expect(deps.length).toBe(2);

    const gin = deps.find((d) => d.name === 'github.com/gin-gonic/gin');
    expect(gin?.version).toBe('v1.9.1');
    expect(gin?.system).toBe('go');
  });

  it('scans a temporary workspace directory hierarchy and discovers utils', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'arch-gate-test-'));

    try {
      // Create manifest
      await fs.promises.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ dependencies: { zod: '^3.20' } })
      );

      // Create utility folder & file
      const utilsDir = path.join(tempDir, 'src', 'utils');
      await fs.promises.mkdir(utilsDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(utilsDir, 'date-helper.ts'),
        'export function formatDate() {}'
      );

      const result = await scanWorkspaceArchitecture(tempDir);

      expect(result.manifestsFound).toContain('package.json');
      expect(result.totalDependencies).toBe(1);
      expect(result.dependencies[0].name).toBe('zod');
      expect(result.internalUtilities.length).toBe(1);
      expect(result.internalUtilities[0].name).toBe('date-helper.ts');
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });
});

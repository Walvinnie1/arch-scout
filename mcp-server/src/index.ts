#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { scanWorkspaceArchitecture } from './manifest-scanner.js';
import { lookupPackageEcosystem } from './registry-client.js';
import { BuildVsReuseEvaluation, PackageHealthInfo, PackageSystem } from './types.js';

const server = new Server(
  {
    name: 'arch-scout',
    version: '0.1.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

/**
 * Generates the Markdown decision brief
 */
function generateDecisionBriefMarkdown(
  task: string,
  internalMatchDesc: string,
  candidateInfos: PackageHealthInfo[],
  preferredOption: string,
  rationale: string
): string {
  let tableRows = '';

  if (candidateInfos.length > 0) {
    for (const pkg of candidateInfos) {
      const scorecard = pkg.scorecardScore !== undefined ? `${pkg.scorecardScore.toFixed(1)}/10` : 'N/A';
      const cves = pkg.openAdvisoriesCount === 0 ? 'None (0)' : `⚠️ ${pkg.openAdvisoriesCount} advisories`;
      const version = pkg.latestVersion || 'latest';

      tableRows += `
| Option: Reuse / Install \`${pkg.name}@${version}\` | Option: Bespoke Implementation |
| :--- | :--- |
| **Code Footprint:** ~10-25 lines (integration wrapper) | **Code Footprint:** ~50-150 lines (custom logic) |
| **Maintenance:** Upstream maintained by ecosystem | **Maintenance:** Internal ownership, team test burden |
| **Security & Audits:** Handled upstream (CVEs: ${cves}, Scorecard: ${scorecard}) | **Security & Audits:** Team must handle edge cases & CVEs |
| **Dependencies:** +1 package (${pkg.system}) | **Dependencies:** 0 new packages |
| **License:** ${pkg.license || 'Unknown'} | **License:** Workspace native |
`;
    }
  } else {
    tableRows = `
| Option 1: Reuse Internal / Installed Utility | Option 2: Bespoke Implementation |
| :--- | :--- |
| **Code Footprint:** ~5-15 lines | **Code Footprint:** ~50-150 lines |
| **Maintenance:** Shared across project | **Maintenance:** Duplicate bespoke code |
| **Dependencies:** 0 new packages | **Dependencies:** 0 new packages |
`;
  }

  return `### 🛡️ Architectural Check: Build vs. Reuse

- **Task:** ${task}
- **Internal / Installed Match:** ${internalMatchDesc}

${tableRows.trim()}

**Recommendation:** ${preferredOption} — ${rationale}

👉 *Proceed with recommended approach, or prefer an alternative?*`;
}

// Register tool list
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'scan_workspace_architecture',
        description:
          'Scans the workspace for project manifests (package.json, pyproject.toml, Cargo.toml, pom.xml, go.mod, requirements.txt), installed dependencies, and internal shared utility directories (src/utils, lib, common, helpers).',
        inputSchema: {
          type: 'object',
          properties: {
            workspacePath: {
              type: 'string',
              description: 'Root path of the workspace to scan. Defaults to current working directory.'
            },
            maxDepth: {
              type: 'number',
              description: 'Maximum directory recursion depth. Defaults to 5.'
            }
          }
        }
      },
      {
        name: 'lookup_package_ecosystem',
        description:
          "Queries Google's deps.dev API and official package registries (npm, PyPI, Crates.io) to audit a package's license, latest version, open security advisories, and OpenSSF Scorecard score.",
        inputSchema: {
          type: 'object',
          properties: {
            packageName: {
              type: 'string',
              description: 'Name of the package to look up (e.g., "zod", "pydantic", "tokio").'
            },
            system: {
              type: 'string',
              enum: ['npm', 'pypi', 'cargo', 'maven', 'go'],
              description: 'Package system / registry. Defaults to npm.'
            }
          },
          required: ['packageName']
        }
      },
      {
        name: 'evaluate_build_vs_reuse',
        description:
          'Executes an architectural Build vs. Reuse evaluation for a given task. Audits local codebase manifests and queries live ecosystem package health to generate an actionable Architectural Decision Brief.',
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'Brief description of the feature, utility, or capability to build.'
            },
            candidatePackages: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of candidate package names from the open-source ecosystem.'
            },
            system: {
              type: 'string',
              enum: ['npm', 'pypi', 'cargo', 'maven', 'go'],
              description: 'Target package ecosystem. Defaults to npm.'
            },
            workspacePath: {
              type: 'string',
              description: 'Path to local workspace. Defaults to process.cwd().'
            }
          },
          required: ['task']
        }
      }
    ]
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'scan_workspace_architecture') {
      const workspacePath = (args?.workspacePath as string) || process.cwd();
      const maxDepth = typeof args?.maxDepth === 'number' ? args.maxDepth : 5;
      const scanResult = await scanWorkspaceArchitecture(workspacePath, maxDepth);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(scanResult, null, 2)
          }
        ]
      };
    }

    if (name === 'lookup_package_ecosystem') {
      const packageName = args?.packageName as string;
      const system = (args?.system as PackageSystem) || 'npm';

      if (!packageName) {
        throw new Error('packageName parameter is required');
      }

      const info = await lookupPackageEcosystem(packageName, system);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(info, null, 2)
          }
        ]
      };
    }

    if (name === 'evaluate_build_vs_reuse') {
      const task = args?.task as string;
      const candidateNames = (args?.candidatePackages as string[]) || [];
      const system = (args?.system as PackageSystem) || 'npm';
      const workspacePath = (args?.workspacePath as string) || process.cwd();

      if (!task) {
        throw new Error('task parameter is required');
      }

      // 1. Scan workspace
      const scan = await scanWorkspaceArchitecture(workspacePath);

      // Check if any candidate or keyword matches installed dependencies
      const installedMatches = scan.dependencies.filter((dep) =>
        candidateNames.some((c) => dep.name.toLowerCase() === c.toLowerCase()) ||
        task.toLowerCase().includes(dep.name.toLowerCase())
      );

      // Check if internal utilities exist
      const internalMatches = scan.internalUtilities;

      // 2. Query ecosystem for candidate packages
      const candidateInfos: PackageHealthInfo[] = [];
      for (const candName of candidateNames) {
        const info = await lookupPackageEcosystem(candName, system);
        candidateInfos.push(info);
      }

      // Formulate recommendation
      let preferredOption = 'Option 1: Reuse / Install';
      let rationale = 'Leverages battle-tested community package with zero maintenance overhead.';
      let matchDesc = 'None found in local workspace.';

      if (installedMatches.length > 0) {
        preferredOption = `Reuse already-installed package \`${installedMatches[0].name}\``;
        rationale = `Package is already installed in ${installedMatches[0].sourceFile}. Avoids adding any new dependency.`;
        matchDesc = `Found installed in \`${installedMatches[0].sourceFile}\``;
      } else if (internalMatches.length > 0) {
        matchDesc = `Found ${internalMatches.length} internal utility file(s) in workspace (e.g. \`${internalMatches[0].relativePath}\`)`;
      }

      const briefMarkdown = generateDecisionBriefMarkdown(
        task,
        matchDesc,
        candidateInfos,
        preferredOption,
        rationale
      );

      const evaluation: BuildVsReuseEvaluation = {
        task,
        workspaceScanned: true,
        internalMatches,
        installedMatches,
        candidateEcosystemPackages: candidateInfos,
        recommendation: {
          preferredOption,
          rationale
        },
        decisionBriefMarkdown: briefMarkdown
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(evaluation, null, 2)
          }
        ]
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error executing ${name}: ${errMessage}`
        }
      ]
    };
  }
});

// Run server using Stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Arch-Scout MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error starting arch-scout server:', err);
  process.exit(1);
});

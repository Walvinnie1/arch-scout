/**
 * Supported package management systems
 */
export type PackageSystem = 'npm' | 'pypi' | 'cargo' | 'maven' | 'go' | 'unknown';

/**
 * An installed dependency found in a project manifest
 */
export interface InstalledDependency {
  name: string;
  version?: string;
  system: PackageSystem;
  sourceFile: string;
  isDev?: boolean;
}

/**
 * An internal shared utility file found in the workspace
 */
export interface InternalUtility {
  name: string;
  relativePath: string;
  fullPath: string;
  extension: string;
}

/**
 * Summary of a workspace architecture scan
 */
export interface WorkspaceArchitectureScan {
  rootPath: string;
  manifestsFound: string[];
  totalDependencies: number;
  dependencies: InstalledDependency[];
  internalUtilities: InternalUtility[];
}

/**
 * Package health & security information returned from registries and deps.dev
 */
export interface PackageHealthInfo {
  name: string;
  system: PackageSystem;
  latestVersion?: string;
  license?: string;
  description?: string;
  homepage?: string;
  repositoryUrl?: string;
  openAdvisoriesCount: number;
  advisories?: Array<{
    id: string;
    title?: string;
    severity?: string;
    url?: string;
  }>;
  scorecardScore?: number; // OpenSSF Scorecard (0-10)
  links?: Record<string, string>;
  fetchedFrom: 'deps.dev' | 'registry' | 'mock' | 'error';
  error?: string;
}

/**
 * Decision option in the Build vs. Reuse brief
 */
export interface DecisionOption {
  name: string;
  type: 'reuse-internal' | 'reuse-installed' | 'install-oss' | 'bespoke-build';
  codeFootprintEstimate: string;
  maintenanceBurden: string;
  securityAndEdgeCases: string;
  dependencyImpact: string;
  license: string;
  pros: string[];
  cons: string[];
}

/**
 * Full Build vs. Reuse Evaluation Brief
 */
export interface BuildVsReuseEvaluation {
  task: string;
  workspaceScanned: boolean;
  internalMatches: InternalUtility[];
  installedMatches: InstalledDependency[];
  candidateEcosystemPackages: PackageHealthInfo[];
  recommendation: {
    preferredOption: string;
    rationale: string;
  };
  decisionBriefMarkdown: string;
}

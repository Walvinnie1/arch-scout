import { PackageHealthInfo, PackageSystem } from './types.js';

const DEPS_DEV_BASE = 'https://api.deps.dev/v3';
const REQUEST_TIMEOUT_MS = 6000;

interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

async function safeFetchJson<T>(url: string, options: FetchOptions = {}): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'arch-scout/0.1.0 (+https://github.com/Walvinnie1/arch-scout)',
        Accept: 'application/json',
        ...options.headers
      }
    });

    if (!res.ok) {
      return null;
    }

    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Maps common system names to deps.dev system identifiers
 */
export function normalizeDepsDevSystem(system: PackageSystem): string {
  switch (system) {
    case 'npm':
      return 'npm';
    case 'pypi':
      return 'pypi';
    case 'cargo':
      return 'cargo';
    case 'maven':
      return 'maven';
    case 'go':
      return 'go';
    default:
      return 'npm';
  }
}

/**
 * Queries Google's deps.dev API for a given package and system
 */
export async function queryDepsDev(
  system: PackageSystem,
  packageName: string
): Promise<Partial<PackageHealthInfo> | null> {
  const depsSystem = normalizeDepsDevSystem(system);
  const encodedName = encodeURIComponent(packageName);
  const pkgUrl = `${DEPS_DEV_BASE}/systems/${depsSystem}/packages/${encodedName}`;

  interface DepsDevPackageResponse {
    packageKey?: {
      system?: string;
      name?: string;
    };
    versions?: Array<{
      versionKey?: {
        system?: string;
        name?: string;
        version?: string;
      };
      isDefault?: boolean;
    }>;
  }

  const pkgData = await safeFetchJson<DepsDevPackageResponse>(pkgUrl);
  if (!pkgData || !pkgData.versions || pkgData.versions.length === 0) {
    return null;
  }

  // Find default or latest version
  const defaultVersion =
    pkgData.versions.find((v) => v.isDefault)?.versionKey?.version ||
    pkgData.versions[pkgData.versions.length - 1]?.versionKey?.version;

  if (!defaultVersion) {
    return null;
  }

  const encodedVersion = encodeURIComponent(defaultVersion);
  const versionUrl = `${DEPS_DEV_BASE}/systems/${depsSystem}/packages/${encodedName}/versions/${encodedVersion}`;

  interface DepsDevVersionResponse {
    versionKey?: {
      version?: string;
    };
    licenses?: string[];
    advisoryKeys?: Array<{
      id?: string;
    }>;
    links?: Array<{
      label?: string;
      url?: string;
    }>;
    relatedProjects?: Array<{
      projectKey?: {
        id?: string;
      };
      scorecard?: {
        overallScore?: number;
      };
    }>;
  }

  const versionData = await safeFetchJson<DepsDevVersionResponse>(versionUrl);

  const license = versionData?.licenses?.join(', ') || undefined;
  const advisoriesCount = versionData?.advisoryKeys?.length || 0;
  const advisories = versionData?.advisoryKeys?.map((adv) => ({
    id: adv.id || 'UNKNOWN',
    url: adv.id ? `https://osv.dev/vulnerability/${adv.id}` : undefined
  }));

  const scorecardScore = versionData?.relatedProjects?.[0]?.scorecard?.overallScore;
  const linksMap: Record<string, string> = {};
  if (versionData?.links) {
    for (const link of versionData.links) {
      if (link.label && link.url) {
        linksMap[link.label] = link.url;
      }
    }
  }

  return {
    latestVersion: defaultVersion,
    license,
    openAdvisoriesCount: advisoriesCount,
    advisories,
    scorecardScore,
    links: linksMap,
    fetchedFrom: 'deps.dev'
  };
}

/**
 * Queries npm registry directly
 */
export async function queryNpmRegistry(packageName: string): Promise<Partial<PackageHealthInfo> | null> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
  interface NpmResponse {
    name?: string;
    description?: string;
    license?: string | { type?: string };
    homepage?: string;
    repository?: { url?: string } | string;
    'dist-tags'?: { latest?: string };
  }

  const data = await safeFetchJson<NpmResponse>(url);
  if (!data) return null;

  let licenseStr: string | undefined;
  if (typeof data.license === 'string') {
    licenseStr = data.license;
  } else if (data.license && typeof data.license === 'object') {
    licenseStr = data.license.type;
  }

  let repoUrl: string | undefined;
  if (typeof data.repository === 'string') {
    repoUrl = data.repository;
  } else if (data.repository?.url) {
    repoUrl = data.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
  }

  return {
    latestVersion: data['dist-tags']?.latest,
    description: data.description,
    license: licenseStr,
    homepage: data.homepage,
    repositoryUrl: repoUrl,
    fetchedFrom: 'registry'
  };
}

/**
 * Queries PyPI registry directly
 */
export async function queryPypiRegistry(packageName: string): Promise<Partial<PackageHealthInfo> | null> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`;
  interface PypiResponse {
    info?: {
      name?: string;
      version?: string;
      summary?: string;
      license?: string;
      home_page?: string;
      project_urls?: Record<string, string>;
    };
  }

  const data = await safeFetchJson<PypiResponse>(url);
  if (!data || !data.info) return null;

  return {
    latestVersion: data.info.version,
    description: data.info.summary,
    license: data.info.license || undefined,
    homepage: data.info.home_page || data.info.project_urls?.Homepage,
    repositoryUrl: data.info.project_urls?.Source || data.info.project_urls?.Repository,
    fetchedFrom: 'registry'
  };
}

/**
 * Queries Crates.io registry directly
 */
export async function queryCargoRegistry(packageName: string): Promise<Partial<PackageHealthInfo> | null> {
  const url = `https://crates.io/api/v1/crates/${encodeURIComponent(packageName)}`;
  interface CratesResponse {
    crate?: {
      id?: string;
      name?: string;
      max_version?: string;
      description?: string;
      homepage?: string;
      repository?: string;
      license?: string;
    };
  }

  const data = await safeFetchJson<CratesResponse>(url);
  if (!data || !data.crate) return null;

  return {
    latestVersion: data.crate.max_version,
    description: data.crate.description,
    license: data.crate.license,
    homepage: data.crate.homepage,
    repositoryUrl: data.crate.repository,
    fetchedFrom: 'registry'
  };
}

/**
 * Unified package lookup combining Google's deps.dev and language-specific registries
 */
export async function lookupPackageEcosystem(
  packageName: string,
  system: PackageSystem = 'npm'
): Promise<PackageHealthInfo> {
  // Query deps.dev and native registry in parallel
  const [depsDevResult, nativeRegistryResult] = await Promise.all([
    queryDepsDev(system, packageName),
    system === 'npm'
      ? queryNpmRegistry(packageName)
      : system === 'pypi'
      ? queryPypiRegistry(packageName)
      : system === 'cargo'
      ? queryCargoRegistry(packageName)
      : Promise.resolve(null)
  ]);

  if (!depsDevResult && !nativeRegistryResult) {
    return {
      name: packageName,
      system,
      openAdvisoriesCount: 0,
      fetchedFrom: 'error',
      error: `Package "${packageName}" not found in deps.dev or native ${system} registry.`
    };
  }

  const mergedLicense = depsDevResult?.license || nativeRegistryResult?.license || 'Unspecified';
  const mergedVersion = depsDevResult?.latestVersion || nativeRegistryResult?.latestVersion;
  const mergedDescription = nativeRegistryResult?.description || depsDevResult?.description;
  const mergedHomepage =
    nativeRegistryResult?.homepage ||
    depsDevResult?.links?.HOMEPAGE ||
    depsDevResult?.links?.ORIGIN;
  const mergedRepo =
    nativeRegistryResult?.repositoryUrl ||
    depsDevResult?.links?.SOURCE_REPO;

  return {
    name: packageName,
    system,
    latestVersion: mergedVersion,
    license: mergedLicense,
    description: mergedDescription,
    homepage: mergedHomepage,
    repositoryUrl: mergedRepo,
    openAdvisoriesCount: depsDevResult?.openAdvisoriesCount ?? 0,
    advisories: depsDevResult?.advisories || [],
    scorecardScore: depsDevResult?.scorecardScore,
    links: depsDevResult?.links,
    fetchedFrom: depsDevResult ? 'deps.dev' : 'registry'
  };
}

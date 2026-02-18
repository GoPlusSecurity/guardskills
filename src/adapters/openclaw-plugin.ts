/**
 * GoPlus AgentGuard — OpenClaw Plugin
 *
 * Registers before_tool_call, after_tool_call, and session_start hooks
 * with the OpenClaw plugin API to evaluate tool safety at runtime and
 * auto-scan installed skills on session startup.
 *
 * Features:
 * - Auto-scan all loaded plugins on registration
 * - Auto-scan skill directories (~/.openclaw/skills/, ~/.claude/skills/) on session_start
 * - Auto-register plugins to AgentGuard trust registry
 * - Build toolName → pluginId mapping for initiating skill inference
 *
 * Usage in OpenClaw plugin config:
 *   import agentguard from '@goplus/agentguard/openclaw';
 *   export default agentguard;
 *
 * Or register manually:
 *   import { registerOpenClawPlugin } from '@goplus/agentguard';
 *   registerOpenClawPlugin(api);
 */

import { readdirSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { OpenClawAdapter } from './openclaw.js';
import { evaluateHook } from './engine.js';
import { loadConfig, writeAuditLog } from './common.js';
import type { AgentGuardInstance } from './types.js';
import { SkillScanner } from '../scanner/index.js';
import { SkillRegistry } from '../registry/index.js';
import type { CapabilityModel, SkillIdentity } from '../types/skill.js';
import type { TrustLevel } from '../types/registry.js';

// ---------------------------------------------------------------------------
// OpenClaw Types (subset we use)
// ---------------------------------------------------------------------------

/**
 * OpenClaw PluginRecord (subset)
 */
interface OpenClawPluginRecord {
  id: string;
  name: string;
  version?: string;
  source: string;
  status: 'loaded' | 'disabled' | 'error';
  enabled: boolean;
  toolNames: string[];
}

/**
 * OpenClaw PluginRegistry (subset)
 */
interface OpenClawPluginRegistry {
  plugins: OpenClawPluginRecord[];
}

/**
 * OpenClaw plugin API interface (subset we use)
 */
interface OpenClawPluginApi {
  id: string;
  name: string;
  source: string;
  on(event: string, handler: (event: unknown, ctx?: unknown) => Promise<unknown>): void;
  on(event: string, options: Record<string, unknown>, handler: (event: unknown, ctx?: unknown) => Promise<unknown>): void;
}

// ---------------------------------------------------------------------------
// Auto-scan helpers (skill directories)
// ---------------------------------------------------------------------------

const OPENCLAW_SKILLS_DIR = join(homedir(), '.openclaw', 'skills');
const CLAUDE_SKILLS_DIR = join(homedir(), '.claude', 'skills');
const AGENTGUARD_DIR = process.env.AGENTGUARD_HOME || join(homedir(), '.agentguard');
const AUDIT_PATH = join(AGENTGUARD_DIR, 'audit.jsonl');

function ensureAgentGuardDir(): void {
  if (!existsSync(AGENTGUARD_DIR)) {
    mkdirSync(AGENTGUARD_DIR, { recursive: true });
  }
}

function writeScanAuditLog(entry: Record<string, unknown>): void {
  try {
    ensureAgentGuardDir();
    appendFileSync(AUDIT_PATH, JSON.stringify(entry) + '\n');
  } catch {
    // Non-critical
  }
}

/**
 * Discover skill directories (containing SKILL.md) under the given path.
 */
function discoverSkillDirs(skillsDir: string): { name: string; path: string }[] {
  if (!existsSync(skillsDir)) return [];
  const skills: { name: string; path: string }[] = [];
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(skillsDir, entry.name);
      if (existsSync(join(skillDir, 'SKILL.md'))) {
        skills.push({ name: entry.name, path: skillDir });
      }
    }
  } catch {
    // Can't read skills dir
  }
  return skills;
}

function riskToTrustLevel(riskLevel: string): TrustLevel {
  switch (riskLevel) {
    case 'low': return 'trusted';
    case 'medium': return 'restricted';
    default: return 'untrusted';
  }
}

/**
 * Scan skill directories (~/.openclaw/skills/ and ~/.claude/skills/) and register them.
 */
async function autoScanSkillDirs(
  scanner: SkillScanner,
  registry: SkillRegistry,
  logger: (msg: string) => void
): Promise<void> {
  const skills = [
    ...discoverSkillDirs(OPENCLAW_SKILLS_DIR),
    ...discoverSkillDirs(CLAUDE_SKILLS_DIR),
  ];

  if (skills.length === 0) return;

  let scanned = 0;
  let trusted = 0;
  let restricted = 0;
  let untrusted = 0;

  for (const skill of skills) {
    // Skip self
    if (skill.name === 'agentguard') continue;

    try {
      const hash = await scanner.calculateArtifactHash(skill.path);

      // Already registered with same hash → skip
      const existing = await registry.lookup({
        id: skill.name,
        source: skill.path,
        version_ref: '0.0.0',
        artifact_hash: hash,
      });
      if (existing.record && existing.effective_trust_level !== 'untrusted') {
        continue;
      }

      const result = await scanner.quickScan(skill.path);
      scanned++;

      const trustLevel = riskToTrustLevel(result.risk_level);
      if (trustLevel === 'trusted') trusted++;
      else if (trustLevel === 'restricted') restricted++;
      else untrusted++;

      await registry.forceAttest({
        skill: {
          id: skill.name,
          source: skill.path,
          version_ref: '0.0.0',
          artifact_hash: hash,
        },
        trust_level: trustLevel,
        capabilities: {
          network_allowlist: [],
          filesystem_allowlist: trustLevel === 'untrusted' ? [] : ['./**'],
          exec: 'deny',
          secrets_allowlist: [],
        },
        review: {
          reviewed_by: 'auto-scan',
          evidence_refs: [`scan:${result.risk_level}:${result.risk_tags.join(',')}`],
          notes: `Auto-scanned on session start. Risk: ${result.risk_level}. Tags: ${result.risk_tags.join(', ') || 'none'}`,
        },
      });

      writeScanAuditLog({
        timestamp: new Date().toISOString(),
        event: 'auto_scan',
        skill_name: skill.name,
        skill_path: skill.path,
        risk_level: result.risk_level,
        risk_tags: result.risk_tags,
        trust_level: trustLevel,
        summary: result.summary,
      });
    } catch {
      // Skip skills that fail to scan
    }
  }

  if (scanned > 0) {
    const parts: string[] = [];
    if (trusted > 0) parts.push(`${trusted} trusted`);
    if (restricted > 0) parts.push(`${restricted} restricted`);
    if (untrusted > 0) parts.push(`${untrusted} untrusted`);
    logger(`[AgentGuard] Scanned ${scanned} skill dir(s) — ${parts.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Plugin registration options
// ---------------------------------------------------------------------------

/**
 * Plugin registration options
 */
export interface OpenClawPluginOptions {
  /** Protection level (strict/balanced/permissive) */
  level?: string;
  /** Skip auto-scanning of plugins */
  skipAutoScan?: boolean;
  /** Custom AgentGuard instance factory */
  agentguardFactory?: () => AgentGuardInstance;
  /** Custom scanner instance */
  scanner?: SkillScanner;
  /** Custom registry instance */
  registry?: SkillRegistry;
}

// ---------------------------------------------------------------------------
// Global State
// ---------------------------------------------------------------------------

/** Symbol to access OpenClaw's global registry */
const OPENCLAW_REGISTRY_STATE = Symbol.for('openclaw.pluginRegistryState');

/** Tool name → Plugin ID mapping */
const toolToPluginMap = new Map<string, string>();

/** Plugin ID → Scan result cache */
const pluginScanCache = new Map<string, { riskLevel: string; riskTags: string[] }>();

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Get OpenClaw's active plugin registry via global symbol
 */
function getOpenClawRegistry(): OpenClawPluginRegistry | null {
  const globalState = globalThis as typeof globalThis & {
    [key: symbol]: { registry: OpenClawPluginRegistry | null } | undefined;
  };
  const state = globalState[OPENCLAW_REGISTRY_STATE];
  return state?.registry ?? null;
}

/**
 * Get plugin directory from source path
 */
function getPluginDir(source: string): string {
  // source is typically the entry file (e.g., /path/to/plugin/index.ts)
  // We want the directory
  return path.dirname(source);
}

/**
 * Infer capabilities from scan result and plugin info
 */
function inferCapabilities(
  riskLevel: string,
  riskTags: string[],
  toolNames: string[]
): CapabilityModel {
  const hasExecTool = toolNames.some(t =>
    t.toLowerCase().includes('exec') ||
    t.toLowerCase().includes('shell') ||
    t.toLowerCase().includes('bash')
  );

  const hasNetworkTool = toolNames.some(t =>
    t.toLowerCase().includes('fetch') ||
    t.toLowerCase().includes('http') ||
    t.toLowerCase().includes('request') ||
    t.toLowerCase().includes('browser')
  );

  const hasFileTool = toolNames.some(t =>
    t.toLowerCase().includes('file') ||
    t.toLowerCase().includes('write') ||
    t.toLowerCase().includes('read')
  );

  // Start with restrictive defaults
  const capabilities: CapabilityModel = {
    network_allowlist: [],
    filesystem_allowlist: [],
    exec: 'deny',
    secrets_allowlist: [],
  };

  // If plugin has network tools and scan is clean, allow network
  if (hasNetworkTool && riskLevel !== 'critical' && riskLevel !== 'high') {
    capabilities.network_allowlist = ['*'];
  }

  // If plugin has file tools and scan is clean, allow filesystem
  if (hasFileTool && riskLevel !== 'critical') {
    capabilities.filesystem_allowlist = ['./**'];
  }

  // Only allow exec if explicitly needed and scan is very clean
  if (hasExecTool && riskLevel === 'low' && !riskTags.includes('SHELL_EXEC')) {
    capabilities.exec = 'allow';
  }

  return capabilities;
}

/**
 * Determine trust level from scan result
 */
function determineTrustLevel(riskLevel: string, riskTags: string[]): TrustLevel {
  // Critical findings → untrusted
  if (riskLevel === 'critical') {
    return 'untrusted';
  }

  // Specific dangerous patterns → untrusted
  const dangerousTags = [
    'PROMPT_INJECTION',
    'PRIVATE_KEY_PATTERN',
    'MNEMONIC_PATTERN',
    'WALLET_DRAINING',
    'WEBHOOK_EXFIL',
    'REMOTE_LOADER',
    'AUTO_UPDATE',
  ];

  if (riskTags.some(tag => dangerousTags.includes(tag))) {
    return 'untrusted';
  }

  // High risk → restricted
  if (riskLevel === 'high') {
    return 'restricted';
  }

  // Medium risk → restricted
  if (riskLevel === 'medium') {
    return 'restricted';
  }

  // Low risk → trusted
  return 'trusted';
}

/**
 * Scan a plugin and register it in AgentGuard's trust registry
 */
async function scanAndRegisterPlugin(
  plugin: OpenClawPluginRecord,
  scanner: SkillScanner,
  registry: SkillRegistry,
  logger: (msg: string) => void
): Promise<void> {
  // Skip if already scanned
  if (pluginScanCache.has(plugin.id)) {
    return;
  }

  const pluginDir = getPluginDir(plugin.source);

  try {
    // Calculate artifact hash
    const artifactHash = await scanner.calculateArtifactHash(pluginDir);

    // Perform scan
    const scanResult = await scanner.quickScan(pluginDir);

    // Cache result
    pluginScanCache.set(plugin.id, {
      riskLevel: scanResult.risk_level,
      riskTags: scanResult.risk_tags,
    });

    // Determine trust level
    const trustLevel = determineTrustLevel(scanResult.risk_level, scanResult.risk_tags);

    // Infer capabilities
    const capabilities = inferCapabilities(
      scanResult.risk_level,
      scanResult.risk_tags,
      plugin.toolNames
    );

    // Create skill identity
    const skillIdentity: SkillIdentity = {
      id: plugin.id,
      source: plugin.source,
      version_ref: plugin.version || '0.0.0',
      artifact_hash: artifactHash,
    };

    // Register in trust registry (force to skip confirmation)
    await registry.forceAttest({
      skill: skillIdentity,
      trust_level: trustLevel,
      capabilities,
      review: {
        reviewed_by: 'agentguard:auto-scan',
        evidence_refs: [`scan:${plugin.id}`],
        notes: `Auto-scanned on plugin load. Risk: ${scanResult.risk_level}. Tags: ${scanResult.risk_tags.join(', ') || 'none'}`,
      },
    });

    // Build tool → plugin mapping
    for (const toolName of plugin.toolNames) {
      toolToPluginMap.set(toolName, plugin.id);
    }

    logger(`[AgentGuard] Scanned plugin "${plugin.id}": ${trustLevel} (${scanResult.risk_level} risk, ${scanResult.risk_tags.length} findings)`);

  } catch (err) {
    // If scan fails, register as untrusted
    pluginScanCache.set(plugin.id, {
      riskLevel: 'unknown',
      riskTags: ['SCAN_FAILED'],
    });

    const skillIdentity: SkillIdentity = {
      id: plugin.id,
      source: plugin.source,
      version_ref: plugin.version || '0.0.0',
      artifact_hash: 'unknown',
    };

    await registry.forceAttest({
      skill: skillIdentity,
      trust_level: 'untrusted',
      capabilities: {
        network_allowlist: [],
        filesystem_allowlist: [],
        exec: 'deny',
        secrets_allowlist: [],
      },
      review: {
        reviewed_by: 'agentguard:auto-scan',
        evidence_refs: [],
        notes: `Scan failed: ${String(err)}. Defaulting to untrusted.`,
      },
    });

    // Still build tool mapping
    for (const toolName of plugin.toolNames) {
      toolToPluginMap.set(toolName, plugin.id);
    }

    logger(`[AgentGuard] Plugin "${plugin.id}" scan failed, registered as untrusted: ${String(err)}`);
  }
}

/**
 * Scan all loaded OpenClaw plugins
 */
async function scanAllPlugins(
  scanner: SkillScanner,
  registry: SkillRegistry,
  logger: (msg: string) => void,
  selfPluginId?: string
): Promise<void> {
  const openclawRegistry = getOpenClawRegistry();

  if (!openclawRegistry) {
    logger('[AgentGuard] OpenClaw registry not available, skipping plugin auto-scan');
    return;
  }

  const plugins = openclawRegistry.plugins.filter(p =>
    p.status === 'loaded' &&
    p.enabled &&
    p.id !== selfPluginId // Don't scan ourselves
  );

  logger(`[AgentGuard] Auto-scanning ${plugins.length} loaded plugins...`);

  // Scan plugins in parallel (with concurrency limit)
  const CONCURRENCY = 3;
  for (let i = 0; i < plugins.length; i += CONCURRENCY) {
    const batch = plugins.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(plugin => scanAndRegisterPlugin(plugin, scanner, registry, logger))
    );
  }

  logger(`[AgentGuard] Plugin auto-scan complete. ${toolToPluginMap.size} tools mapped.`);
}

/**
 * Get plugin ID from tool name
 */
export function getPluginIdFromTool(toolName: string): string | null {
  return toolToPluginMap.get(toolName) ?? null;
}

/**
 * Get scan result for a plugin
 */
export function getPluginScanResult(pluginId: string): { riskLevel: string; riskTags: string[] } | null {
  return pluginScanCache.get(pluginId) ?? null;
}

// ---------------------------------------------------------------------------
// Main Registration
// ---------------------------------------------------------------------------

/**
 * Register AgentGuard hooks with OpenClaw plugin API
 */
export function registerOpenClawPlugin(
  api: OpenClawPluginApi,
  options: OpenClawPluginOptions = {}
): void {
  const adapter = new OpenClawAdapter();
  const config = options.level ? { level: options.level } : loadConfig();
  const scanner = options.scanner ?? new SkillScanner({ useExternalScanner: false });
  const trustRegistry = options.registry ?? new SkillRegistry();

  // Simple logger
  const logger = (msg: string) => console.log(msg);

  // Lazy-initialize agentguard instance
  let agentguard: AgentGuardInstance | null = null;

  function getAgentGuard(): AgentGuardInstance {
    if (!agentguard) {
      if (options.agentguardFactory) {
        agentguard = options.agentguardFactory();
      } else {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { createAgentGuard } = require('@goplus/agentguard');
          agentguard = createAgentGuard();
        } catch {
          throw new Error('AgentGuard: unable to load engine. Install @goplus/agentguard.');
        }
      }
    }
    return agentguard!;
  }

  // Auto-scan plugins on registration (async, non-blocking)
  if (!options.skipAutoScan) {
    // Use setImmediate to allow plugin registration to complete first
    setImmediate(async () => {
      try {
        await scanAllPlugins(scanner, trustRegistry, logger, api.id);
      } catch (err) {
        logger(`[AgentGuard] Plugin auto-scan error: ${String(err)}`);
      }
    });
  }

  // session_start → auto-scan skill directories
  api.on('session_start', async () => {
    try {
      await autoScanSkillDirs(scanner, trustRegistry, logger);
    } catch {
      // Non-critical — never block session startup
    }
  });

  // before_tool_call → evaluate and optionally block
  api.on('before_tool_call', async (event: unknown) => {
    try {
      // Try to infer plugin from tool name
      const toolEvent = event as { toolName?: string };
      const pluginId = toolEvent.toolName ? getPluginIdFromTool(toolEvent.toolName) : null;

      // Check if plugin is untrusted
      if (pluginId) {
        const scanResult = getPluginScanResult(pluginId);
        if (scanResult?.riskLevel === 'critical') {
          return {
            block: true,
            blockReason: `GoPlus AgentGuard: Plugin "${pluginId}" has critical security findings and is blocked. Run /agentguard trust attest to manually approve.`,
          };
        }
      }

      const result = await evaluateHook(adapter, event, {
        config,
        agentguard: getAgentGuard(),
      });

      if (result.decision === 'deny') {
        return {
          block: true,
          blockReason: result.reason || 'Blocked by GoPlus AgentGuard',
        };
      }

      // OpenClaw has no 'ask' mode — block with explanation in strict/balanced
      if (result.decision === 'ask') {
        return {
          block: true,
          blockReason: result.reason || 'Requires confirmation (GoPlus AgentGuard)',
        };
      }

      return undefined; // allow
    } catch {
      // Fail open
      return undefined;
    }
  });

  // after_tool_call → audit log
  api.on('after_tool_call', async (event: unknown) => {
    try {
      const input = adapter.parseInput(event);
      const toolEvent = event as { toolName?: string };
      const pluginId = toolEvent.toolName ? getPluginIdFromTool(toolEvent.toolName) : null;
      writeAuditLog(input, null, pluginId);
    } catch {
      // Non-critical
    }
  });

  logger(`[AgentGuard] Registered with OpenClaw (protection level: ${config.level || 'balanced'})`);
}

/**
 * Default export for OpenClaw plugin registration
 *
 * Usage: export default from '@goplus/agentguard/openclaw'
 */
export default function register(api: OpenClawPluginApi): void {
  registerOpenClawPlugin(api);
}

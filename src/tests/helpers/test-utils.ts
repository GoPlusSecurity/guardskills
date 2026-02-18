import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentGuard } from '../../index.js';
import { ClaudeCodeAdapter } from '../../adapters/claude-code.js';
import { OpenClawAdapter } from '../../adapters/openclaw.js';
import type { EngineOptions } from '../../adapters/types.js';

/**
 * Create an isolated test context with temporary registry
 * and injectable config level. No real ~/.agentguard/ pollution.
 */
export function createTestContext(level: string = 'balanced') {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentguard-integ-'));
  const registryPath = join(tempDir, 'registry.json');
  const agentguard = createAgentGuard({ registryPath });

  const config = { level };
  const options: EngineOptions = { config, agentguard: agentguard as unknown as EngineOptions['agentguard'] };

  return {
    tempDir,
    agentguard,
    config,
    options,
    claudeAdapter: new ClaudeCodeAdapter(),
    openclawAdapter: new OpenClawAdapter(),
    cleanup() {
      try {
        rmSync(tempDir, { recursive: true });
      } catch {
        // ignore
      }
    },
  };
}

import type { Finding } from '@qa/types';

/**
 * OASIS Static Analysis Results Interchange Format (SARIF) v2.1.0 Exporter
 * Reference: G21
 */
export interface SarifLog {
  $schema: string;
  version: string;
  runs: SarifRun[];
}

export interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri: string;
      rules: SarifRule[];
    };
  };
  results: SarifResult[];
}

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  helpUri?: string;
  defaultConfiguration?: {
    level: 'error' | 'warning' | 'note';
  };
}

export interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  locations?: Array<{
    physicalLocation?: {
      artifactLocation?: {
        uri: string;
      };
    };
  }>;
  properties?: Record<string, unknown>;
}

export function findingsToSarif(findings: Finding[], toolVersion = '0.1.0'): SarifLog {
  const rulesMap = new Map<string, SarifRule>();
  const results: SarifResult[] = [];

  for (const f of findings) {
    const level: 'error' | 'warning' | 'note' =
      f.severity === 'Blocker' || f.severity === 'Major' ? 'error' : f.severity === 'Minor' ? 'warning' : 'note';

    const ruleId = `${f.checker}-${f.categoryTag || 'DEF'}`;
    if (!rulesMap.has(ruleId)) {
      rulesMap.set(ruleId, {
        id: ruleId,
        name: f.title.replace(/[^\w\s-]/g, '').trim(),
        shortDescription: { text: f.title },
        helpUri: 'https://github.com/CJCreator/qa-flow-tester',
        defaultConfiguration: { level },
      });
    }

    results.push({
      ruleId,
      level,
      message: {
        text: `${f.title}\nExpected: ${f.expectedVsActual.expected}\nActual: ${f.expectedVsActual.actual}\nResolution: ${f.resolution}`,
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: f.where.urlPath || '/',
            },
          },
        },
      ],
      properties: {
        id: f.id,
        testCaseId: f.testCaseId,
        flowId: f.flowId,
        role: f.where.role,
        breakpoint: f.where.breakpoint,
      },
    });
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'QA Flow Tester',
            version: toolVersion,
            informationUri: 'https://github.com/CJCreator/qa-flow-tester',
            rules: Array.from(rulesMap.values()),
          },
        },
        results,
      },
    ],
  };
}

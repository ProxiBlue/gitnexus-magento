import fs from 'fs/promises';
import path from 'path';

export interface AugmentEdge {
  sourceId: string;   // e.g., "Class:vendor/.../Product.php:Product"
  targetId: string;   // e.g., "Interface:vendor/.../ProductInterface.php:ProductInterface"
  type: string;       // e.g., "IMPLEMENTS", "WRAPS", "CALLS"
  confidence: number; // 0-1, usually 1.0
  reason: string;     // e.g., "magento:di:preference"
}

export interface AugmentNode {
  label: string;      // e.g., "Route"
  properties: Record<string, unknown>;
}

export interface WriteResult {
  edgesInjected: number;
  edgesSkipped: number;
  nodesCreated: number;
}

const CSV_HEADER = '"from","to","type","confidence","reason","step"';

/**
 * Extract the label prefix from a node ID.
 * Node IDs have the format: "Label:path:name"
 */
export function extractLabel(nodeId: string): string {
  return nodeId.split(':')[0];
}

/**
 * Escape a single CSV field value (always quoted).
 * Internal double-quotes are escaped with backslash.
 */
export function escapeField(value: string | number): string {
  const str = String(value);
  const escaped = str.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Build a CSV row for an edge.
 */
function edgeToCsvRow(edge: AugmentEdge): string {
  return [
    escapeField(edge.sourceId),
    escapeField(edge.targetId),
    escapeField(edge.type),
    escapeField(edge.confidence),
    escapeField(edge.reason),
    '""', // step — empty
  ].join(',');
}

/**
 * Generate CSV files split by source-target label pair.
 * Returns paths of written CSV files.
 */
export async function generateEdgeCsvFiles(
  edges: AugmentEdge[],
  csvDir: string,
): Promise<string[]> {
  if (edges.length === 0) return [];

  // Group edges by from-label → to-label
  const groups = new Map<string, AugmentEdge[]>();
  for (const edge of edges) {
    const fromLabel = extractLabel(edge.sourceId);
    const toLabel = extractLabel(edge.targetId);
    const key = `${fromLabel}_${toLabel}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(edge);
  }

  const files: string[] = [];

  for (const [key, group] of groups) {
    const filename = `rel_${key}.csv`;
    const csvPath = path.join(csvDir, filename);
    const rows = [CSV_HEADER, ...group.map(edgeToCsvRow)].join('\n') + '\n';
    await fs.writeFile(csvPath, rows, 'utf-8');
    files.push(csvPath);
  }

  return files;
}

/**
 * Delete all edges whose reason starts with 'magento:'.
 * Returns number of deleted edges (best-effort from DB response).
 */
export async function cleanupMagentoEdges(dbPath: string): Promise<number> {
  await runCypherQuery(
    dbPath,
    "MATCH ()-[r:CodeRelation]->() WHERE r.reason STARTS WITH 'magento:' DELETE r",
  );
  return 0; // count not returned by current CLI
}

/**
 * Write edges into the DB using CSV bulk COPY.
 */
export async function writeEdges(
  edges: AugmentEdge[],
  dbPath: string,
  csvDir: string,
): Promise<WriteResult> {
  if (edges.length === 0) {
    return { edgesInjected: 0, edgesSkipped: 0, nodesCreated: 0 };
  }

  const csvFiles = await generateEdgeCsvFiles(edges, csvDir);

  for (const csvPath of csvFiles) {
    const base = path.basename(csvPath, '.csv'); // rel_Class_Interface
    const parts = base.split('_'); // ['rel', 'Class', 'Interface']
    const fromLabel = parts[1];
    const toLabel = parts[2];

    const query = `COPY CodeRelation FROM "${csvPath}" (from="${fromLabel}", to="${toLabel}", HEADER=true, ESCAPE='"', DELIM=',', QUOTE='"', PARALLEL=false, auto_detect=false)`;
    await runCypherQuery(dbPath, query);
  }

  return {
    edgesInjected: edges.length,
    edgesSkipped: 0,
    nodesCreated: 0,
  };
}

/**
 * Write nodes into the DB via MERGE.
 */
export async function writeNodes(nodes: AugmentNode[], dbPath: string): Promise<number> {
  if (nodes.length === 0) return 0;

  for (const node of nodes) {
    const propsJson = JSON.stringify(node.properties);
    const query = `MERGE (n:${node.label} ${propsJson})`;
    await runCypherQuery(dbPath, query);
  }

  return nodes.length;
}

/**
 * Thin DB adapter — runs a Cypher query via the gitnexus lbug adapter.
 * Wrapped so tests can mock or skip.
 */
async function runCypherQuery(dbPath: string, query: string): Promise<void> {
  try {
    const mod = await import(
      '/usr/local/lib/node_modules/gitnexus/dist/core/lbug/lbug-adapter.js'
    );
    await mod.withLbugDb(dbPath, async () => {
      await mod.executeQuery(query);
    });
  } catch {
    throw new Error(
      `lbug adapter not found or query failed. Ensure gitnexus is installed globally.\nQuery: ${query}`,
    );
  }
}

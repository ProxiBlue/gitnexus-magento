import path from 'path';
import fs from 'fs/promises';

import { mapDiXmlEdges } from './parsers/di-xml-mapper.js';
import { mapLayoutXmlEdges } from './parsers/layout-xml-mapper.js';
import { parseAndMapEventsXml } from './parsers/events-xml.js';
import { parseAndMapWebapiXml } from './parsers/webapi-xml.js';
import { parseAndMapRoutesXml } from './parsers/routes-xml.js';
import {
  cleanupMagentoEdges,
  writeEdges,
  writeNodes,
  AugmentEdge,
  AugmentNode,
} from './writer/lbug-writer.js';

export async function augment(projectPath: string): Promise<void> {
  const absPath = path.resolve(projectPath);

  // 1. Verify GitNexus index exists
  const lbugPath = path.join(absPath, '.gitnexus', 'lbug');
  try {
    await fs.access(lbugPath);
  } catch {
    throw new Error(`.gitnexus/lbug not found at ${absPath}. Run 'gitnexus analyze' first.`);
  }

  // 2. Verify Magento project
  const autoloadPath = path.join(absPath, 'vendor', 'composer', 'autoload_psr4.php');
  try {
    await fs.access(autoloadPath);
  } catch {
    throw new Error(`vendor/composer/autoload_psr4.php not found. Is ${absPath} a Magento project?`);
  }

  const dbPath = lbugPath;
  const csvDir = path.join(absPath, '.gitnexus', 'magento-csv');

  console.log(`Augmenting GitNexus graph for: ${absPath}`);

  // 5. Clean up previous magento edges
  await cleanupMagentoEdges(dbPath);
  console.log('Cleaned up previous magento edges.');

  const allEdges: AugmentEdge[] = [];
  const allNodes: AugmentNode[] = [];

  // 6a. di.xml → preferences + plugins
  console.log('Phase 1: di.xml (preferences + plugins)...');
  const diResult = await mapDiXmlEdges(absPath);
  allEdges.push(...diResult.edges);
  const { preferencesResolved, preferencesSkipped, pluginsResolved, pluginsSkipped } = diResult.stats;
  console.log(
    `  di.xml: ${preferencesResolved} preferences, ${pluginsResolved} plugins` +
    ` (skipped: ${preferencesSkipped + pluginsSkipped})`,
  );

  // 6b. Layout XML → block→template
  console.log('Phase 2: layout XML (block→template)...');
  const layoutResult = await mapLayoutXmlEdges(absPath);
  allEdges.push(...layoutResult.edges);
  console.log(
    `  layout XML: ${layoutResult.stats.resolved} edges` +
    ` (skipped: ${layoutResult.stats.skippedNoClass + layoutResult.stats.skippedNoTemplate})`,
  );

  // 6c. events.xml → observers
  console.log('Phase 3: events.xml (observers)...');
  const eventsResult = await parseAndMapEventsXml(absPath);
  allEdges.push(...eventsResult.edges);
  console.log(
    `  events.xml: ${eventsResult.stats.resolved} edges (skipped: ${eventsResult.stats.skipped})`,
  );

  // 6d. webapi.xml → REST routes (has nodes too)
  console.log('Phase 4: webapi.xml (REST routes)...');
  const webapiResult = await parseAndMapWebapiXml(absPath);
  allEdges.push(...webapiResult.edges);
  allNodes.push(...webapiResult.nodes);
  console.log(
    `  webapi.xml: ${webapiResult.stats.resolved} edges (skipped: ${webapiResult.stats.skipped})`,
  );

  // 6e. routes.xml → frontend routes (has nodes too)
  console.log('Phase 5: routes.xml (frontend routes)...');
  const routesResult = await parseAndMapRoutesXml(absPath);
  allEdges.push(...routesResult.edges);
  allNodes.push(...routesResult.nodes);
  console.log(
    `  routes.xml: ${routesResult.stats.resolved} edges (skipped: ${routesResult.stats.skipped})`,
  );

  // 7. Write all nodes first
  const nodesWritten = await writeNodes(allNodes, dbPath);

  // 8. Write all edges
  const writeResult = await writeEdges(allEdges, dbPath, csvDir);

  // 9. Print summary
  console.log('\n--- Augmentation Summary ---');
  console.log(`  Nodes created:   ${nodesWritten}`);
  console.log(`  Edges injected:  ${writeResult.edgesInjected}`);
  console.log(`  Edges skipped:   ${writeResult.edgesSkipped}`);
  console.log('Augmentation complete.');

  // 10. Clean up csvDir
  try {
    await fs.rm(csvDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

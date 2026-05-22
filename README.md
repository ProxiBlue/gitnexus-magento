# gitnexus-magento

Magento 2 / Mage-OS XML graph augmenter for [GitNexus](https://github.com/abhigyanpatwari/GitNexus).

GitNexus builds knowledge graphs from source code but misses Magento's XML-driven wiring — plugins, preferences, block-to-template mappings, event observers, and REST endpoints are invisible to static analysis. This tool parses those XML configs and injects the missing dependency edges into the GitNexus graph.

## What it does

After `gitnexus analyze` indexes your PHP code, run `gitnexus-magento augment` to add edges from:

| XML source | Edge type | What it connects |
|---|---|---|
| `etc/di.xml` | `IMPLEMENTS` | Interface → concrete class (preferences) |
| `etc/di.xml` | `WRAPS` | Plugin class → target class |
| `view/*/layout/*.xml` | `CALLS` | Block class file → template file |
| `etc/events.xml` | `CALLS` | events.xml → observer class file |
| `etc/webapi.xml` | `HANDLES_ROUTE` | Service class file → REST route |
| `etc/*/routes.xml` | `HANDLES_ROUTE` | routes.xml → frontend route |

All augmented edges are tagged with a `magento:` prefix in the reason field, making them identifiable and cleanly removable on re-runs.

## Installation

```bash
git clone https://github.com/ProxiBlue/gitnexus-magento.git
cd gitnexus-magento
npm install
npm run build
```

## Usage

```bash
# From your Magento project root (after gitnexus analyze)
node /path/to/gitnexus-magento/dist/cli.js augment

# Or with explicit path
node /path/to/gitnexus-magento/dist/cli.js augment /var/www/html
```

### Prerequisites

- GitNexus must be installed globally (`npm install -g gitnexus`)
- `gitnexus analyze` must have been run on the project (`.gitnexus/lbug` must exist)
- The project must be a Magento 2 / Mage-OS project with `vendor/composer/autoload_psr4.php`

### What happens

1. Cleans up any previously injected `magento:` edges
2. Parses `di.xml` across all modules → injects preference + plugin edges
3. Parses layout XML → injects block-to-template edges
4. Parses `events.xml` → injects observer edges
5. Parses `webapi.xml` → creates Route nodes + handler edges
6. Parses `routes.xml` → creates Route nodes + controller edges
7. Prints a summary of injected/skipped edges

### Querying augmented edges

After augmentation, use GitNexus to query the new edges:

```bash
# All Magento-augmented edges
gitnexus cypher "MATCH ()-[r]->() WHERE r.reason STARTS WITH 'magento:' RETURN r.type, count(r)"

# All plugins on a specific class
gitnexus cypher "MATCH (plugin)-[r {type: 'WRAPS'}]->(target) WHERE r.reason = 'magento:di:plugin' AND target.name = 'Product' RETURN plugin.name, plugin.filePath"

# All observers for an event
gitnexus cypher "MATCH (src)-[r]->(obs) WHERE r.reason STARTS WITH 'magento:events:observer:catalog_product_save' RETURN obs.name, obs.filePath"

# REST endpoints
gitnexus cypher "MATCH (handler)-[r {type: 'HANDLES_ROUTE'}]->(route:Route) WHERE r.reason = 'magento:webapi:route' RETURN route.name, handler.name"
```

## Edge tagging convention

All edges use the `reason` field with a `magento:` prefix:

| Reason | Source |
|---|---|
| `magento:di:preference` | di.xml preference |
| `magento:di:plugin` | di.xml plugin |
| `magento:layout:block-template` | Layout XML block → template |
| `magento:events:observer:{eventName}` | events.xml observer |
| `magento:webapi:route` | webapi.xml REST endpoint |
| `magento:routes:controller` | routes.xml frontend route |

## How FQCN resolution works

Magento XML configs reference classes by fully qualified name (e.g., `Magento\Catalog\Model\Product`). This tool resolves them to GitNexus node IDs by:

1. Parsing `vendor/composer/autoload_psr4.php` for namespace-to-path mappings
2. Matching the longest namespace prefix
3. Building the file path and verifying it exists on disk
4. Constructing the node ID: `Class:{filePath}:{ShortName}`

Classes that can't be resolved (missing from vendor, not indexed) are skipped and reported in the summary.

## Development

```bash
npm install
npm run build
npm test
```

### Project structure

```
src/
├── cli.ts                      # CLI entry point
├── augment.ts                  # Orchestrator — runs all phases
├── resolvers/
│   ├── psr4-map.ts             # PSR-4 autoload parser
│   ├── node-id.ts              # FQCN → GitNexus node ID
│   └── template-path.ts        # Vendor_Module:: → file path
├── parsers/
│   ├── di-xml.ts               # di.xml parser
│   ├── di-xml-mapper.ts        # di.xml → edges
│   ├── layout-xml.ts           # Layout XML parser
│   ├── layout-xml-mapper.ts    # Layout XML → edges
│   ├── events-xml.ts           # events.xml parser + mapper
│   ├── webapi-xml.ts           # webapi.xml parser + mapper
│   └── routes-xml.ts           # routes.xml parser + mapper
└── writer/
    └── lbug-writer.ts          # Edge CSV generation + DB injection
```

## License

MIT

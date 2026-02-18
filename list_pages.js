#!/usr/bin/env node

import { readFileSync } from 'fs';
import jsyaml from 'js-yaml';
import { program } from 'commander';
import path from 'path';

program
  .requiredOption('--navigation <file>', 'Navigation YAML file')
  .requiredOption('--root-path <path>', 'The directory to prefix the file paths with')
  .option('--shared <name>', 'Name of sharded track directory', 'shared')
  .parse();
const options = program.opts();

function extractPages(items, trackPath = '') {
  for (const item of items) {
    if (typeof item === 'string')
      console.log(path.join(options.rootPath, trackPath || options.shared, item));
    else if (typeof item === 'object')
      for (const [trackName, trackItems] of Object.entries(item))
        extractPages(trackItems, path.join(trackPath, trackName));
    else
      throw new Error(`Could not process: ${JSON.stringify(item)}`);
  }
}

try {
  const navigation = jsyaml.load(readFileSync(options.navigation, 'utf8'));
  extractPages(navigation);
} catch (error) {
  console.error(`Error processing navigation file: ${error.message}`);
  process.exit(1);
}

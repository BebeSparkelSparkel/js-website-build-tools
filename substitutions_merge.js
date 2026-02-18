#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { program } from 'commander';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function mergeDeep(target, source) {
  if (typeof source !== 'object' || source === null) return source;

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const srcVal = source[key];
      const tgtVal = target[key];

      if (
        srcVal !== null &&
        typeof srcVal === 'object' &&
        !Array.isArray(srcVal) &&
        tgtVal !== null &&
        typeof tgtVal === 'object' &&
        !Array.isArray(tgtVal)
      ) {
        if (!target[key]) target[key] = {};
        mergeDeep(target[key], srcVal);
      } else {
        target[key] = srcVal;
      }
    }
  }

  return target;
}

program
  .name('deep_merge')
  .description('Deep merge YAML/JSON files. Rightmost files override values on matching paths.')
  .version('1.0.0')
  .arguments('<file...>')
  .action((files) => {
    if (files.length === 0) {
      fail('At least one file argument is required. Use --help for usage.');
    }

    let result = {};

    for (const file of files) {
      let raw;
      try {
        raw = fs.readFileSync(file, 'utf8');
      } catch (err) {
        fail(`Cannot read file ${file}: ${err.message}`);
      }

      let data;
      const ext = path.extname(file).toLowerCase();

      if (ext === '.json') {
        try {
          data = JSON.parse(raw);
        } catch (err) {
          fail(`Invalid JSON in ${file}: ${err.message}`);
        }
      } else if (ext === '.yaml' || ext === '.yml') {
        try {
          data = yaml.load(raw);
        } catch (err) {
          fail(`Invalid YAML in ${file}: ${err.message}`);
        }
      } else {
        fail(`Unsupported extension ${ext} in ${file} (only .json, .yaml, .yml allowed)`);
      }

      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        fail(`${file} must contain a top-level object (got ${typeof data})`);
      }

      result = mergeDeep(result, data);
    }

    console.log(JSON.stringify(result, null, 2));
  });

// Show help if no arguments given
if (process.argv.length <= 2) {
  program.help();
}

program.parse();
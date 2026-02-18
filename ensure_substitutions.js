#!/usr/bin/env node

import { readFileSync } from 'fs';
import { program } from 'commander';

program
  .arguments('<template-file> [substitution-names...]')
  .description('Verify that a template file contains all required mustache substitutions')
  .option('--development', 'emit warnings instead of errors for missing substitutions')
  .parse();

const args = program.args;
const options = program.opts();

if (args.length < 2) {
  console.error('Error: Template file and at least one substitution name required');
  console.error('Usage: ensure_substitutions.js <template-file> <substitution-name> [substitution-name...]');
  process.exit(1);
}

const [templateFile, ...substitutionNames] = args;

try {
  const templateContent = readFileSync(templateFile, 'utf8');
  
  const mustachePattern = /\{\{\{?([^}]+)\}\}/g;
  const foundSubstitutions = new Set(
    templateContent
      .matchAll(mustachePattern)
      .map(match => match[1].trim())
  );
  
  const requiredSubstitutions = new Set(substitutionNames);
  const missingSubstitutions = requiredSubstitutions.difference(foundSubstitutions);
  
  if (missingSubstitutions.size > 0) {
    const message = `Template ${templateFile} is missing required substitutions: ${Array.from(missingSubstitutions).join(', ')}`;
    
    if (options.development) {
      console.warn(`Warn: ${message}`);
    } else {
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  }
  
} catch (error) {
  console.error(`Error reading template file ${templateFile}: ${error.message}`);
  process.exit(1);
}

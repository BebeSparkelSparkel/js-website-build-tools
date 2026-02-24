#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { program } from 'commander';
import Mustache from 'mustache';

/**
 * Template renderer class that handles custom delimiters and strict context validation
 */
class TemplateRenderer {
  constructor(startDelimiter = '{{', endDelimiter = '}}', development = false) {
    this.startDelimiter = startDelimiter;
    this.endDelimiter = endDelimiter;
    this.development = development;
  }

  /**
   * Create a strict context proxy that validates template variable access
   */
  createStrictContext(obj, path = '') {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    // Handle arrays - don't proxy them, just recursively process elements
    if (Array.isArray(obj)) {
      return obj.map(item => this.createStrictContext(item, path));
    }

    return new Proxy(obj, {
      get: (target, prop) => {
        // Allow standard object methods and symbols
        if (prop === 'toString' || prop === 'valueOf' || prop === Symbol.toPrimitive || typeof prop === 'symbol') {
          return target[prop];
        }

        // Check if property exists
        if (!(prop in target)) {
          const fullPath = path ? `${path}.${String(prop)}` : String(prop);
          const message = `Undefined template variable: ${this.startDelimiter}${fullPath}${this.endDelimiter}`;
          
          if (this.development) {
            console.warn(`Warning: ${message}`);
            // Return placeholder using the actual delimiters being used
            return `${this.startDelimiter}${fullPath} is undefined${this.endDelimiter}`;
          } else {
            console.error(`Error: ${message}`);
            process.exit(1);
          }
        }

        const value = target[prop];
        
        // Recursively wrap objects to catch nested undefined access
        if (value !== null && typeof value === 'object') {
          const newPath = path ? `${path}.${String(prop)}` : String(prop);
          return this.createStrictContext(value, newPath);
        }

        return value;
      }
    });
  }

  /**
   * Render template with custom delimiters and strict context validation
   */
  render(template, context) {
    const strictContext = this.createStrictContext(context);
    
    // Set custom delimiters if they differ from defaults
    let renderOptions = {};
    if (this.startDelimiter !== '{{' || this.endDelimiter !== '}}')
      renderOptions.tags = [this.startDelimiter, this.endDelimiter];
    
    return Mustache.render(template, strictContext, undefined, renderOptions);
  }
}

/**
 * Read from file or stdin
 */
async function readFileOrStdin(filePath) {
  if (filePath) {
    console.error('Loading file:', filePath);
    return await fs.promises.readFile(filePath, 'utf8');
  } else {
    console.error('Reading from stdin...');
    let data = '';
    for await (const chunk of process.stdin) {
      data += chunk;
    }
    return data;
  }
}

function addDefaultDisplay(data) {
  const processed = {};
  
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'object' && value !== null && value['#string_source']) {
      const sourceField = value['#string_source'];
      const cleanValue = { ...value };
      delete cleanValue['#string_source']; // Remove metadata
      
      processed[key] = {
        ...cleanValue,
        toString() { return cleanValue[sourceField]; },
        valueOf() { return cleanValue[sourceField]; }
      };
    } else {
      processed[key] = value;
    }
  }
  return processed;
}

async function main() {
  // Handle EPIPE errors gracefully
  process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') {
      process.exit(0); // Normal termination when pipe is closed
    }
    throw err;
  });

  program
    .option('--substitutions <file>', 'pre-merged JSON substitution object')
    .option('--output <file>', 'output file path (defaults to stdout)')
    .option('--input <file>', 'input template file (defaults to stdin)')
    .option('--stdin-key <key>', 'when set, read stdin and place its content into context under this key (template must then come from --input)')
    .option('--stdout', 'output to stdout instead of file')
    .option('--development', 'make validation warnings instead of errors', false)
    .option('--start-delimiter <delimiter>', 'custom start delimiter (default: {{)', '{{')
    .option('--end-delimiter <delimiter>', 'custom end delimiter (default: }})', '}}')
    .allowUnknownOption()
    .argument('[extra-context...]', 'Additional assignments `name=value` or JSON context objects')
    .parse();

  const config = program.opts();
  const additionalArgs = program.args;

  try {
    let context = {};
    
    // Load pre-merged substitution data if provided
    if (config.substitutions) {
      console.error('Loading substitutions:', config.substitutions);
      try {
        const substitutionData = JSON.parse(await fs.promises.readFile(config.substitutions, 'utf8'));
        context = addDefaultDisplay(substitutionData);
      } catch (error) {
        throw new Error(`Error parsing json substitutions from file ${config.substitutions} because ${error.message}`);
      }
    }
    
    // Process additional JSON arguments
    additionalArgs.forEach((argStr, index) => {
      let additionalData;
      try {
        additionalData = JSON.parse(argStr);
      } catch (parseError) {
        const assignmentRegex = /^([-a-zA-Z0-9_]+)=(.+)$/;
        const assignmentMatch = assignmentRegex.exec(argStr);
        if (assignmentMatch) {
          context[assignmentMatch[1]] = assignmentMatch[2];
          return;
        }
        console.error(`Error parsing JSON argument ${index + 1}: ${argStr}`);
        throw new Error(`Invalid JSON in argument ${index + 1}: ${parseError.message}`);
      }
      if (typeof additionalData !== 'object' || additionalData === null || Array.isArray(additionalData))
        throw new Error(`JSON argument ${index + 1} must be an object, got ${Array.isArray(additionalData) ? 'array' : typeof additionalData}`);
      Object.assign(context, additionalData);
    });

    // Read stdin content if --stdin-key is used (before reading template)
    if (config.stdinKey) {
      if (!config.input) {
        console.error('Error: --stdin-key requires --input to specify the template file');
        process.exit(1);
      }
      context[config.stdinKey] = await readFileOrStdin();
    }

    // Read template
    const inputText = await readFileOrStdin(config.input);
    if (inputText.length === 0) {
      console.error("Error: No template data");
      process.exit(1);
    }

    // Create renderer with custom delimiters and render template
    const renderer = new TemplateRenderer(
      config.startDelimiter,
      config.endDelimiter,
      config.development
    );
    
    console.error('Rendering template...');
    const output = renderer.render(inputText, context);

    // Write output
    if (config.stdout || !config.output) {
      process.stdout.write(output);
    } else {
      console.error('Writing output file:', config.output);
      await fs.promises.writeFile(config.output, output, 'utf8');
      console.error('Template rendered successfully!');
    }

  } catch (error) {
    console.error('Template rendering failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);

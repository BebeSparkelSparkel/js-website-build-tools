import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';

function loadFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.json') {
      return JSON.parse(content);
    } else if (ext === '.yaml' || ext === '.yml') {
      return yaml.load(content, {schema: yaml.JSON_SCHEMA});
    } else {
      throw new Error(`Unsupported file format: ${ext}. Only .json, .yaml, and .yml files are supported.`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    } else if (error.code === 'EACCES') {
      throw new Error(`Permission denied reading file: ${filePath}`);
    } else if (error instanceof SyntaxError || error.name === 'YAMLException') {
      throw new Error(`Invalid ${path.extname(filePath)} syntax in file: ${filePath}\n${error.message}`);
    } else {
      throw error;
    }
  }
}

function resolveSchemaPath(refPath, basePath) {
  // Handle different types of references
  if (refPath.startsWith('http://') || refPath.startsWith('https://')) {
    // HTTP references - would need fetch implementation
    throw new Error(`HTTP schema references not supported: ${refPath}`);
  }
  
  if (refPath.startsWith('#')) {
    // Internal reference - handled by AJV automatically
    return null;
  }
  
  // File reference - resolve relative to base schema
  const baseDir = path.dirname(basePath);
  const [filePart] = refPath.split('#'); // Remove fragment part for file resolution
  const resolvedPath = path.resolve(baseDir, filePart);
  
  // Check if file exists
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Referenced schema file not found: ${resolvedPath} (referenced as: ${refPath})`);
  }
  
  return resolvedPath;
}

function findSchemaReferences(schema, refs = new Set()) {
  if (typeof schema === 'object' && schema !== null) {
    if (schema.$ref) {
      refs.add(schema.$ref);
    }
    
    // Recursively search through object properties
    for (const key in schema) {
      if (schema.hasOwnProperty(key)) {
        findSchemaReferences(schema[key], refs);
      }
    }
  } else if (Array.isArray(schema)) {
    // Recursively search through array items
    schema.forEach(item => findSchemaReferences(item, refs));
  }
  
  return refs;
}

function transformSchemaForDevelopment(schema, verbose, path = '') {
  if (typeof schema === 'object' && schema !== null && !Array.isArray(schema)) {
    Object.keys(schema)
      .filter(key => key.endsWith('_dev'))
      .forEach(devKey => {
        const prodKey = devKey.replace(/_dev$/, '');
        if (verbose) {
          console.log(`Using "${devKey}" at: ${path}.${prodKey}`);
          console.log(`  Original   : ${JSON.stringify(schema[prodKey])}`);
          console.log(`  Development: ${JSON.stringify(schema[devKey])}`);
        }
        schema[prodKey] = schema[devKey];
        delete schema[devKey];
      });
    
    Object.keys(schema).forEach(key => transformSchemaForDevelopment(schema[key], verbose, path + '.' + key));
  } else if (Array.isArray(schema))
    schema.forEach((item, i) => transformSchemaForDevelopment(schema[i], verbose, path + '[' + i + ']'));
}

function recursivelyRemove(schema, verbose, removeKey, path = '') {
  if (typeof schema === 'object' && schema !== null && !Array.isArray(schema)) {
    Object.keys(schema).forEach(key => {
      const keyPath = path + '.' + key;
      if (schema[key]?.[removeKey]) {
        if (verbose)
          console.log('Removing property:', keyPath);
        delete schema[key];
      }
      else
        recursivelyRemove(schema[key], verbose, removeKey, keyPath);
    });
  } else if (Array.isArray(schema)) {
    for (let i = schema.length - 1; i >= 0; i--) {
      const indexPath = path + '[' + i + ']';
      if (schema[i]?.[removeKey]) {
        if (verbose)
          console.log('Removing item:', indexPath);
        schema.splice(i, 1);
      }
      else
        recursivelyRemove(schema[i], verbose, removeKey, indexPath);
    }
  }
}

function loadAllSchemas(mainSchemaPath, verbose = false, developmentMode = false) {
  const loadedSchemas = new Map(); // path -> schema content
  const schemaQueue = [mainSchemaPath];
  const processedPaths = new Set();
  
  while (schemaQueue.length > 0) {
    const currentPath = schemaQueue.shift();
    const absolutePath = path.resolve(currentPath);
    
    if (processedPaths.has(absolutePath)) {
      continue;
    }
    
    processedPaths.add(absolutePath);
    
    if (verbose) {
      console.log(`Loading schema: ${currentPath}`);
    }
    
    let schema = loadFile(currentPath);
    
    // Transform schema for development mode if needed
    if (developmentMode) {
      recursivelyRemove(schema, verbose, 'prod_only');
      transformSchemaForDevelopment(schema, verbose);
    } else
      recursivelyRemove(schema, verbose, 'dev_only');
    
    loadedSchemas.set(absolutePath, schema);
    
    // Find references in this schema and add them to the queue
    const refs = findSchemaReferences(schema);
    for (const ref of refs) {
      const resolvedPath = resolveSchemaPath(ref, currentPath);
      if (resolvedPath && !processedPaths.has(path.resolve(resolvedPath))) {
        schemaQueue.push(resolvedPath);
      }
    }
  }
  
  return loadedSchemas;
}

function createSchemaRegistry(loadedSchemas, mainSchemaPath, verbose = false) {
  const registry = new Map(); // ref -> schema content
  const mainAbsolutePath = path.resolve(mainSchemaPath);
  
  for (const [absolutePath, schema] of loadedSchemas) {
    // Create relative reference from main schema
    const relativePath = path.relative(path.dirname(mainSchemaPath), absolutePath);
    const normalizedPath = relativePath.replace(/\\/g, '/'); // normalize path separators
    
    registry.set(normalizedPath, schema);
    registry.set(absolutePath, schema);
    
    // Also register with ./ prefix if it's in the same directory or subdirectory
    if (!normalizedPath.startsWith('../')) {
      const withPrefix = `./${normalizedPath}`;
      registry.set(withPrefix, schema);
    }
    
    if (verbose) {
      console.log(`Registered schema: ${normalizedPath} -> ${absolutePath}`);
    }
  }
  
  return registry;
}

function setupWarningKeyword(ajv, treatWarningsAsErrors = false) {
  ajv.addKeyword({
    keyword: 'warning',
    schemaType: 'string',
    compile: function(schemaValue) {
      return function validate(data, schema, parentSchema, dataPath) {
        if (treatWarningsAsErrors) {
          // Treat warning as an error
          validate.errors = validate.errors || [];
          validate.errors.push({
            keyword: 'warning',
            instancePath: dataPath || '',
            schemaPath: '#/warning',
            message: schemaValue,
            data: data,
            schema: schema
          });
          return false;
        } else {
          // Store as warning
          validate.warnings = validate.warnings || [];
          validate.warnings.push({
            keyword: 'warning',
            instancePath: dataPath || '',
            message: schemaValue,
            data: data
          });
          return true;
        }
      };
    }
  });
}

function collectWarnings(validate) {
  const warnings = [];
  
  // Collect warnings from the main validation function
  if (validate.warnings) {
    warnings.push(...validate.warnings);
  }
  
  // Recursively collect warnings from nested validators
  function collectFromValidator(validator) {
    if (validator && validator.warnings) {
      warnings.push(...validator.warnings);
    }
    if (validator && validator.schema && typeof validator.schema === 'object') {
      Object.values(validator.schema).forEach(subValidator => {
        if (typeof subValidator === 'function') {
          collectFromValidator(subValidator);
        }
      });
    }
  }
  
  collectFromValidator(validate);
  return warnings;
}

function formatErrorMessage(error, verbose = false) {
  let message = error.message;
  
  // Enhance "additionalProperties" errors to show which property is the problem
  if (error.keyword === 'additionalProperties' && error.params && error.params.additionalProperty) {
    message = `must NOT have additional property '${error.params.additionalProperty}'`;
  }
  
  // For other common errors, try to make them more specific
  if (error.keyword === 'required' && error.params && error.params.missingProperty) {
    message = `must have required property '${error.params.missingProperty}'`;
  }
  
  if (error.keyword === 'enum' && error.params && error.params.allowedValues) {
    const allowedValues = error.params.allowedValues.map(v => `'${v}'`).join(', ');
    message = `must be one of: ${allowedValues}`;
  }
  
  if (error.keyword === 'type' && error.params && error.params.type) {
    message = `must be ${error.params.type}`;
  }
  
  return message;
}

function validateSchema(schemaPath, dataPath, {verbose, warningsAsErrors, maxErrors, development}) {
  try {
    // Load all schemas first
    console.log(`Loading schema from: ${schemaPath}`);
    if (development) {
      console.log('Development mode: Using required_dev instead of required fields and including dev_only objects');
    }
    
    const loadedSchemas = loadAllSchemas(schemaPath, verbose, development);
    
    // Create a registry of schemas with their references
    const schemaRegistry = createSchemaRegistry(loadedSchemas, schemaPath, verbose);
    
    // Get the main schema
    const mainSchema = loadedSchemas.get(path.resolve(schemaPath));
    if (!mainSchema) {
      throw new Error(`Could not load main schema: ${schemaPath}`);
    }
    
    if (verbose) {
      console.log(`Loaded ${loadedSchemas.size} schema files`);
      console.log(`Created ${schemaRegistry.size} schema registry entries`);
    }
    
    console.log(`Loading data from: ${dataPath}`);
    const data = loadFile(dataPath);

    const ajv = new Ajv({ 
      allErrors: true,
      verbose: true,
      strict: false, // Allow unknown keywords
    });
    
    addFormats(ajv);
    
    // Add warning keyword
    setupWarningKeyword(ajv, warningsAsErrors);

    // Pre-add all schemas to AJV
    for (const [ref, schema] of schemaRegistry) {
      try {
        if (!schema.$id)
          schema.$id = ref;
        ajv.addSchema(schema, ref);
        if (verbose)
          console.log(`Pre-added schema: ${ref}`);
      } catch (error) {
        console.warn(`Could not pre-add schema ${ref}: ${error.message}`);
      }
    }

    // Compile and validate
    let validate;
    try {
      validate = ajv.compile(mainSchema);
    } catch (error) {
      throw new Error(`Invalid schema: ${error.message}`);
    }

    const valid = validate(data);
    const warnings = collectWarnings(validate);

    // Handle warnings
    if (warnings.length > 0 && !warningsAsErrors) {
      console.log('\n⚠️  Validation warnings:');
      const warningsToShow = warnings.slice(0, maxErrors);
      warningsToShow.forEach((warning, index) => {
        const message = formatErrorMessage(warning, verbose);
        console.log(`${index + 1}. ${warning.instancePath || 'root'}: ${message}`);
        if (verbose && warning.data !== undefined) {
          console.log(`   Data: ${JSON.stringify(warning.data)}`);
        }
      });
      
      if (warnings.length > maxErrors) {
        console.log(`\n... and ${warnings.length - maxErrors} more warnings. Use --max-errors all to see all warnings.`);
      }
    }

    if (!valid) {
      console.error('\n❌ Validation failed with the following errors:');
      const errorsToShow = validate.errors.slice(0, maxErrors);
      errorsToShow.forEach((error, index) => {
        const message = formatErrorMessage(error, verbose);
        console.error(`${index + 1}. ${error.instancePath || 'root'}: ${message}`);
        if (verbose && error.data !== undefined) {
          console.error(`   Data: ${JSON.stringify(error.data)}`);
        }
        if (verbose && error.schemaPath) {
          console.error(`   Schema path: ${error.schemaPath}`);
        }
      });
      
      if (validate.errors.length > maxErrors) {
        console.error(`\n... and ${validate.errors.length - maxErrors} more errors. Use --max-errors all to see all errors.`);
      }
      
      if (!verbose && (validate.errors.some(e => e.data !== undefined) || warnings.some(w => w.data !== undefined))) {
        console.error('\nUse --verbose to see detailed data for errors and warnings.');
      }
      
      process.exit(1);
    } else {
      if (warnings.length > 0 && !warningsAsErrors) {
        const modeText = development ? ' (development mode)' : '';
        console.log(`\n✅ Validation successful with warnings${modeText}! Data conforms to schema but has issues noted above.`);
        if (!verbose && warnings.some(w => w.data !== undefined)) {
          console.log('Use --verbose to see detailed data for warnings.');
        }
      } else {
        const modeText = development ? ' (development mode)' : '';
        console.log(`\n✅ Validation successful${modeText}! Data conforms to schema.`);
      }
      
      if (verbose) {
        console.log(`Total schemas processed: ${loadedSchemas.size}`);
      }
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

function main() {
  const program = new Command();
  
  program
    .name('schema-validator')
    .description('JSON/YAML schema validator with support for external references')
    .argument('<schema-path>', 'path to the schema file (.json, .yaml, .yml)')
    .argument('<data-path>', 'path to the data file to validate (.json, .yaml, .yml)')
    .option('--development', 'use required_dev instead of required fields for looser validation, include dev_only objects', false)
    .option('--warnings-as-errors', 'treat warnings as validation errors', false)
    .option('--verbose', 'show detailed loading information', false)
    .option('--max-errors <non-neg-int>', 'maximum number of errors to display (use "all" for all errors)', x => {
      if (x === 'all')
        return Infinity;
      x = parseInt(x, 10);
      if (isNaN(x) || x < 0)
        throw new Error('Error: --max-errors must be a non-negative number or "all"');
      return x;
    }, '10')
    .addHelpText('after', `
Features:
  • Loads external schema references ($ref)
  • Supports relative file paths in references
  • Handles JSON pointer fragments (e.g., "#/definitions/User")
  • Prevents circular reference loops
  • Limits error output for readability
  • Development mode for looser validation requirements

Development Mode:
  When --development is used, schemas with both "required" and "required_dev"
  properties will use the "required_dev" array instead of "required" for
  validation, allowing for more lenient development-time validation.

Examples:
  $ schema-validator schema.json data.json
  $ schema-validator --development schema.json data.json
  $ schema-validator --warnings-as-errors schema.yaml data.yaml
  $ schema-validator --max-errors 5 complex-schema.json data.json
  $ schema-validator --development --verbose schema.json data.json`);

  program.parse();

  const [schemaPath, dataPath] = program.args;
  const options = program.opts();
  
  // Run validation - NOTE: removed await since we made it sync
  validateSchema(schemaPath, dataPath, options);
}

main();

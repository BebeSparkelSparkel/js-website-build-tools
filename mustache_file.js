#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const fileReplaceRegex = /\{\{\{file:([^}]*)\}\}\}/g;
const doubleFileRegex = /\{\{file:([^}]*)\}\}/g;
const cliNamePattern = "([a-zA-Z_][a-zA-Z0-9_]*)";
const templateVariableNameRegex = new RegExp("\\$" + cliNamePattern, "g");
const cliPathAssignmentRegex = new RegExp("^" + cliNamePattern + "=(.+)$")

const help =
`Usage:
      mustache_file.js [options]                 [path-variables...] [input-file]
      mustache_file.js --stdin-path virtual/path [path-variables...] input-file

Options:
  --root <path>          Root path to prepend to file paths (default: current directory)
  --stdin-path <path>    Map stdin to a virtual file path. Requires an input-file argument
  --development          Show warnings instead of errors for double braces
  -h, --help             Show this help message

Arguments:
  path-variables   Path variable definitions in format <name>=<path>
                   <name> must be matched with JS RegExp ${cliNamePattern}
                   <path> may contain more variable replacements
  input-file       Input template file (use "-" or omit for stdin)

Description:
  Reads template from input file or stdin and writes processed output to stdout.
  Replaces {{{file:filename}}} with the contents of the specified file.
  Supports path variables using $variable syntax in templates.
  If filename is an absolute path, it will be used as-is without prepending root path.
  
  IMPORTANT: Only triple braces {{{file:...}}} are supported for raw content injection.
  Double braces {{file:...}} will cause an error (or warning in development mode).

Examples:
  cat template.html | mustache_file.js > output.html
  mustache_file.js template.html > output.html
  mustache_file.js templates=../templates build=./dist template.html > output.html
  mustache_file.js --root ./assets components=./src template.html > output.html

Template syntax:
  {{{file:$templates/header.html}}}    - Uses templates path variable + relative path
  {{{file:$exact_file}}}               - Uses exact_file path variable as complete path
  {{{file:relative/path.css}}}         - Regular relative path
  {{{file:/absolute/path.js}}}         - Absolute path (ignores root)
`;

function parseArgs() {
  const args = process.argv.slice(2);

  const helpFlags = ["--help", "-h"];
  if (args.some(arg => helpFlags.includes(arg))) {
    console.log(help);
    process.exit(0);
  }

  const config = {
    rootPath: '.',
    stdinPath: null,
    production: true,
    inputFile: null,
    pathVariables: {}
  };
  let i = 0;
  function error(msg) {
    console.error(help + '\n\nError: ' + msg);
    process.exit(1);
  }
  function getOptionValue() {
    if (i + 1 >= args.length)
      error(`${args[i]} option requires a value`);
    const value = args[++i].trim();
    if (value.length <= 0)
      error(`${args[i - 1]} has a zero length value`);
    return value;
  }
  // options
  for (; i < args.length && args[i].startsWith('--'); i++) {
    switch (args[i]) {
      case '--root':
        config.rootPath = getOptionValue();
        if (!fs.existsSync(config.rootPath))
          error(`Root path does not exist: ${config.rootPath}`);
        break;
      case '--stdin-path':
        config.stdinPath = getOptionValue();
        break;
      case '--development':
        config.production = false;
        break;
      default:
        error(`Unknown option: ${args[i]}`);
        break;
    }
  }
  // path-variables
  let match;
  for (; i < args.length && (match = args[i].match(cliPathAssignmentRegex)); i++) {
      // Path variable definition
      const [, name, path] = match;
      config.pathVariables[name] = path.trim();
  }
  // input file
  if (i >= args.length) {
    if (config.stdinPath)
      error('input-file must be given if --stdin-path is set');
  }
  else {
    switch (args[i]) {
      case '-':
        if (config.stdinPath)
          error('input-file cannot be set to stdin with - while --stdin-path is also set');
        break;
      case '':
        error('Empty string input file path');
        break;
      default:
        config.inputFile = args[i];
        break;
    }
    i++;
  }

  // extranious arguments
  if (i < args.length)
    error('Unknown arguments: ' + args.slice(i).join(' '));

  return config;
}

function checkForDoubleFileBraces(template, development) {
  const doubleMatches = [...template.matchAll(doubleFileRegex)];
  if (doubleMatches.length > 0) {
    const message = `Found unsupported double brace file syntax. Use {{{file:...}}} instead of {{file:...}}: ${doubleMatches.map(m => m[0]).join(', ')}`;
    
    if (development) {
      console.warn('Warning:', message);
    } else {
      console.error('Error:', message);
      process.exit(1);
    }
  }
}

let exitOnError = true;
function preprocessTemplate(template, rootPath, pathVariables, stdinPath, stdinData) {
  function error(...messages) {
    console.error(messages.join("\n"));
    if (exitOnError)
      process.exit(1);
  }
  let stdinPathNotFound = true;
  const result = template.replace(fileReplaceRegex, (match, filePath) => {
    filePath = filePath.trim();
    let unfinished = true;
    let i = 0;
    while (unfinished) {
      if (i++ >= 100)
        error('Exceeded maximum path resolution iterations');
      unfinished = false;
      filePath = filePath.replace(templateVariableNameRegex, (_, variable) => {
        unfinished = true;
        if (!(variable in pathVariables)) {
          error( `Error: Path variable '$${variable}' is not defined in ${match}`,
                 `Available path variables: ${Object.keys(pathVariables).join(', ')}`);
          return match;
        }
        return pathVariables[variable];
      });
    }
    if (filePath.length === 0)
      error(`Error: Empty path result from ${match}`);
    if (filePath === stdinPath) {
      stdinPathNotFound = false;
      return stdinData;
    }
    if (!path.isAbsolute(filePath))
      filePath = path.join(rootPath, filePath);
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      error(`Error reading file ${filePath} from replace ${match}: ${e.message}`);
    }
    return match;
  });
  if (stdinPath && stdinPathNotFound)
    error(`--stdin-path ${stdinPath} specified but not utilized by the template`);
  return result;
}

async function readInput(inputFile) {
  let data = '';
  if (inputFile) {
    // Read from file
    try {
      data = await fs.promises.readFile(inputFile, 'utf8');
    } catch (e) {
      console.error(`Error reading input file ${inputFile}:`, e.message);
      process.exit(1);
    }
  }
  else {
    // Read from stdin
    for await (const chunk of process.stdin) {
      data += chunk;
    }
  }
  if (data.length <= 0) {
    console.error(`No data read from ${inputFile ? inputFile : "stdin"}`);
    process.exit(1);
  }
  return data;
}

function writeOutput(output) {
  // Handle EPIPE errors gracefully
  process.stdout.on('error', (e) => {
    if (e.code === 'EPIPE')
      process.exit(0); // Normal termination when pipe is closed
    console.error('Stdout error:', e.message);
    process.exit(1);
  });
  process.stdout.write(output);
}

async function main() {
  const config = parseArgs();
  exitOnError = config.production;
  const inputText = await readInput(config.inputFile);
  if (inputText.length === 0) {
    console.error("Error: No template data");
    process.exit(1);
  }
  const stdinData = config.stdinPath ? await readInput() : null;
  if (config.stdinPath && stdinData.length === 0) {
    console.error('Error: No data from stdin');
    process.exit(1);
  }

  const output = preprocessTemplate(inputText, config.rootPath, config.pathVariables, config.stdinPath, stdinData);
  checkForDoubleFileBraces(output, !config.production);
  writeOutput(output);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});

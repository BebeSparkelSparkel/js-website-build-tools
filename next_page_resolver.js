#!/usr/bin/env node

import { readFileSync } from 'fs';
import jsyaml from 'js-yaml';
import { program } from 'commander';
import path from 'path';

if (process.argv.includes('--test'))
  unit_tests(findNexts);

program
  .requiredOption('--current-page <page>', 'Current page path')
  .requiredOption('--navigation <file>', 'Navigation YAML file')
  .option('--id-prefix <string>', 'Prefix string for the substitution object keys', 'next_page')
  .option('--shared <name>', 'Name of sharded track directory', 'shared')
  .option('--url-prefix <path>', 'URL prefix path to prepend to next page paths', '')
  .parse();

const options = program.opts();

try {
  const navigation = jsyaml.load(readFileSync(options.navigation, 'utf8'));
  const currentPageParts = options.currentPage.split(path.sep);
  if (currentPageParts[0] === options.shared)
    currentPageParts.shift();
  const nexts = findNexts(navigation, currentPageParts);
  if (nexts.length > 0) {
    const paths = nexts.map(components => {
      const file = components.pop();
      if (components.length === 0)
        components.push(options.shared);
      const id = options.idPrefix + '-' + components.join('_');
      const fp = path.join(options.urlPrefix, ...components, file);
      return [id, fp];
    });
    if (paths.length === 1)
      paths[0][0] = options.idPrefix;
    console.log(JSON.stringify(Object.fromEntries(paths)));
  }
  else
    throw Error(`Could not find next page for: ${options.currentPage}`);
} catch (error) {
  console.error(`Error processing navigation: ${error.message}`);
  process.exit(1);
}

function findNexts(xs, path) {
  let nexts;
  if (path.length === 0)
    nexts = getNexts(xs, []);
  else
    nexts = findNextsHelper(xs, path, []);
  return Array.isArray(nexts) ? nexts : [];
}

function findNextsHelper(xs, path, directions) {
  if (!xs)
    return false;
  if (path.length === 0) {
    return false;
    throw new Error('findNexts unexpected empty path: ' + JSON.stringify({xs: xs, path: path, directions: directions}));
  }
  if (Array.isArray(xs)) {
    let found = false;
    for (const x of xs) {
      if (found) {
        if (Array.isArray(found))
          return found;
        found = getNexts(x, directions);
      } else {
        found = findNextsHelper(x, path, directions);
      }
    }
    return found;
  }
  if (path.length === 1) {
    if (typeof xs === 'string')
      return xs === path[0];
    if (typeof xs === 'object' && xs !== null)
      return false;
    throw new Error('findNexts unhandled state: ' + JSON.stringify({xs: xs, path: path, directions: directions}));
  }
  if (typeof xs === 'string')
    return false;
  if (typeof xs === 'object' && xs !== null)
    return findNextsHelper(xs[path[0]], path.slice(1), [...directions, path[0]]);
  throw new Error('findNexts unhandled state: ' + JSON.stringify({xs: xs, path: path, directions: directions}));
}

function getNexts(xs, directions) {
  if (typeof xs === 'string')
    return [[...directions, xs]];
  if (Array.isArray(xs))
    return xs.length > 0 ? getNexts(xs[0], directions) : true;
  if (typeof xs === 'object' && xs !== null) {
    const nexts = Object.entries(xs).flatMap(([k,v]) => getNexts(v, [...directions, k])).filter(Array.isArray);
    return nexts.length > 0 ? nexts : true;
  }
  throw new Error('getNexts unhandled state: ' + JSON.stringify({xs, directions}));
}


function unit_tests() {
  // Test runner
  let testCount = 0;
  let passCount = 0;
  
  function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  
  function test(description, structure, input, expected) {
    testCount++;
    const result = findNexts(structure, input);
    const pass = deepEqual(result, expected);
    
    if (pass) {
      passCount++;
      console.log(`+ ${description}`);
    } else {
      console.log(`- ${description}`);
      console.log(`  Input: ${JSON.stringify(input)}`);
      console.log(`  Expected: ${JSON.stringify(expected)}`);
      console.log(`  Got: ${JSON.stringify(result)}`);
    }
  }
  
  function testGroup(title) {
    console.log(`\n=== ${title} ===`);
  }
  
  // Test structures
  const basic = [
    "config.js",
    {
      "src": ["index.js", "utils.js"]
    },
    "readme.md"
  ];
  
  const multiDir = [
    "a.js",
    {
      "shared": ["x.js"]
    },
    "b.js", 
    {
      "shared": ["y.js", "z.js"]
    },
    "c.js"
  ];
  
  const complex = [
    "start.js",
    {
      "lib": [
        {
          "utils": ["helper.js", "math.js"]
        },
        "index.js"
      ]
    },
    {
      "test": ["spec.js"]
    },
    "end.js"
  ];
  
  const nested = [
    {
      "deep": [
        {
          "nested": [
            {
              "very": ["deep.js"]
            }
          ]
        }
      ]
    },
    "surface.js"
  ];
  
  const emptyDirs = [
    "file1.js",
    {
      "empty": []
    },
    "file2.js"
  ];
  
  const mixedComplex = [
    "pre.js",
    {
      "main": [
        "first.js",
        {
          "sub": ["nested.js"]
        },
        "last.js"
      ]
    },
    {
      "main": ["duplicate.js"]
    },
    "post.js"
  ];
  
  const dirOnly = [
    {
      "dir1": [
        {
          "subdir": ["file.js"]
        }
      ]
    },
    {
      "dir2": ["other.js"]
    }
  ];
  
  // Run tests
  testGroup('Basic Structure Tests');
  test('First file to directory', basic, ["config.js"], [["src", "index.js"]]);
  test('File to next sibling in same dir', basic, ["src", "index.js"], [["src", "utils.js"]]);
  test('Last file in dir to parent next', basic, ["src", "utils.js"], [["readme.md"]]);
  test('Last file in structure', basic, ["readme.md"], []);
  
  testGroup('Multiple Same-Named Directories');
  test('First shared directory', multiDir, ["shared", "x.js"], [["b.js"]]);
  test('Second shared directory first file', multiDir, ["shared", "y.js"], [["shared", "z.js"]]);
  test('Second shared directory last file', multiDir, ["shared", "z.js"], [["c.js"]]);
  test('File between shared directories', multiDir, ["b.js"], [["shared", "y.js"]]);
  
  testGroup('Complex Nested Structure');
  test('Root to nested first', complex, ["start.js"], [["lib", "utils", "helper.js"]]);
  test('Deep nested file to sibling', complex, ["lib", "utils", "helper.js"], [["lib", "utils", "math.js"]]);
  test('Deep nested last to parent next', complex, ["lib", "utils", "math.js"], [["lib", "index.js"]]);
  test('Directory last file to next directory', complex, ["lib", "index.js"], [["test", "spec.js"]]);
  test('Last file in structure', complex, ["end.js"], []);
  
  testGroup('Very Deep Nesting');
  test('Deep nested to surface', nested, ["deep", "nested", "very", "deep.js"], [["surface.js"]]);
  
  testGroup('Empty Directory Handling');
  test('File before empty dir to file after', emptyDirs, ["file1.js"], [["file2.js"]]);
  
  testGroup('Edge Cases');
  test('Empty path returns first', basic, [], [["config.js"]]);
  test('Non-existent file', basic, ["missing.js"], []);
  test('Non-existent path', basic, ["src", "missing.js"], []);
  test('Non-existent deep path', basic, ["missing", "deep", "file.js"], []);
  test('Empty structure', [], [], []);
  test('Single file structure - found', ["only.js"], ["only.js"], []);
  test('Single file structure - not found', ["only.js"], ["other.js"], []);
  
  testGroup('Directory-Only Structures');
  test('Directory only - first to second', dirOnly, ["dir1", "subdir", "file.js"], [["dir2", "other.js"]]);
  
  testGroup('Mixed Complex Cases');
  test('Mixed - nested in first main', mixedComplex, ["main", "sub", "nested.js"], [["main", "last.js"]]);
  test('Mixed - last in first main', mixedComplex, ["main", "last.js"], [["main", "duplicate.js"]]);
  test('Mixed - duplicate main', mixedComplex, ["main", "duplicate.js"], [["post.js"]]);
  
  testGroup('Backtracking Edge Cases');
  test('Backtrack from deep nested', complex, ["lib", "utils", "math.js"], [["lib", "index.js"]]);
  test('Backtrack across multiple levels', nested, ["deep", "nested", "very", "deep.js"], [["surface.js"]]);
  test('No backtrack needed - direct sibling', basic, ["src", "index.js"], [["src", "utils.js"]]);

  testGroup('Multiple Directory Instances');
  const tripleDir = [
    {"same": ["a.js"]},
    "middle.js",
    {"same": ["b.js", "c.js"]},
    "end.js",
    {"same": ["d.js"]}
  ];
  test('First instance of triple dir', tripleDir, ["same", "a.js"], [["middle.js"]]);
  test('Second instance first file', tripleDir, ["same", "b.js"], [["same", "c.js"]]);
  test('Second instance last file', tripleDir, ["same", "c.js"], [["end.js"]]);
  test('Third instance', tripleDir, ["same", "d.js"], []);
  
  testGroup('Stress Tests');
  const deepNest = [
    {
      "a": [
        {
          "b": [
            {
              "c": [
                {
                  "d": ["deep.js"]
                },
                "mid.js"
              ]
            },
            "shallow.js"
          ]
        }
      ]
    },
    "root.js"
  ];
  test('Very deep backtrack', deepNest, ["a", "b", "c", "d", "deep.js"], [["a", "b", "c", "mid.js"]]);
  test('Deep to shallow', deepNest, ["a", "b", "c", "mid.js"], [["a", "b", "shallow.js"]]);
  test('Shallow to root', deepNest, ["a", "b", "shallow.js"], [["root.js"]]);
  
  // Summary
  console.log(`\n=== SUMMARY ===`);
  console.log(`${passCount}/${testCount} tests passed (${Math.round(passCount/testCount*100)}%)`);
  if (passCount === testCount) {
    console.log('+ ALL TESTS PASSED!');
    process.exit(0);
  } else {
    console.log('- Some tests failed. Check results above.');
    process.exit(1);
  }
}

/**
 * Fast cross-platform JavaScript syntax validator using Node V8 parser
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIRS_TO_CHECK = [
  "config",
  "controllers",
  "middleware",
  "models",
  "routes",
  "services",
  "utils",
  "scripts",
];

const ROOT_FILES = ["app.js"];

function getJsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file !== "node_modules" && file !== ".git") {
        results = results.concat(getJsFiles(fullPath));
      }
    } else if (file.endsWith(".js")) {
      results.push(fullPath);
    }
  });
  return results;
}

console.log("=========================================");
console.log("🔍 VALIDATING JAVASCRIPT SYNTAX (NODE V8)");
console.log("=========================================");

let allFiles = ROOT_FILES.map((f) => path.join(ROOT_DIR, f)).filter((f) => fs.existsSync(f));

DIRS_TO_CHECK.forEach((dir) => {
  const fullDir = path.join(ROOT_DIR, dir);
  if (fs.existsSync(fullDir)) {
    allFiles = allFiles.concat(getJsFiles(fullDir));
  }
});

let passed = 0;
let errors = 0;

allFiles.forEach((filePath) => {
  const relPath = path.relative(ROOT_DIR, filePath);
  try {
    const code = fs.readFileSync(filePath, "utf8");
    // Parse syntax via V8 without executing
    new vm.Script(code, { filename: relPath });
    passed++;
  } catch (err) {
    console.error(`❌ Syntax Error in ${relPath}:\n`, err.stack || err.message);
    errors++;
  }
});

console.log(`\nSyntax Validation Results:`);
console.log(`✅ ${passed} files passed cleanly without syntax errors.`);

if (errors > 0) {
  console.error(`❌ ${errors} files failed syntax validation.`);
  process.exit(1);
} else {
  console.log("🎉 ALL JAVASCRIPT FILES PASSED SYNTAX CHECK!\n");
  process.exit(0);
}

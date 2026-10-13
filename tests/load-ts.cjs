const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');
module.exports = function loadTs(file, mocks = {}, cache = new Map()) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const requireFrom = createRequire(file);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  new Function('require', 'module', 'exports', source)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    const local = path.resolve(path.dirname(file), `${name}.ts`);
    return name.startsWith('.') && fs.existsSync(local) ? loadTs(local, mocks, cache) : requireFrom(name);
  }, module, module.exports);
  return module.exports;
};

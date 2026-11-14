// Helper for Node tests: load a preset data file (browser script) into an object.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
module.exports = function loadPreset(id) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'data', 'presets', id + '.js'), 'utf8'), ctx);
  return ctx.window.PRESET_DATA[id];
};

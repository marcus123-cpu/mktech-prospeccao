const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { patchHistorySource } = require('./compat-history');
test('canonical key fix is idempotent for installed library', () => {
  const pkg = require.resolve('whatsapp-web.js/package.json');
  const source = fs.readFileSync(path.join(path.dirname(pkg), 'src/util/Injected/Utils.js'), 'utf8');
  const fixed = patchHistorySource(source, '1.34.7');
  assert.equal(patchHistorySource(fixed, '1.34.7'), fixed);
  assert.ok(fixed.includes('chat.lastReceivedKey.$1'));
  assert.ok(fixed.includes('Promise.allSettled(chatPromises)'));
  new vm.Script(fixed);
  assert.throws(() => patchHistorySource(source, 'different'), /Revisar/);
});

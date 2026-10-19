const { test }=require('node:test');
const assert=require('node:assert/strict');
const p=require('../package.json');
test('oito comandos e menus na ordem, apenas arquivos locais',()=>{
  const ids=['getLatest','get','checkout','checkin','undoCheckout','history','compare','properties'].map(x=>'sourcesafe.'+x);
  assert.deepEqual(p.contributes.commands.map(x=>x.command),ids);
  const entries=p.contributes.menus['sourcesafe.context'];
  assert.deepEqual(entries.map(x=>x.command),ids);
  entries.forEach((entry,i)=>{assert.equal(entry.group,`sourcesafe@${i+1}`);assert.ok(entry.when.includes('resourceScheme == file'));if([2,3,4,6].includes(i))assert.ok(entry.when.includes('!explorerResourceIsFolder'));});
  for(const key of ['explorer/context','editor/context','editor/title/context'])assert.deepEqual(p.contributes.menus[key],[{submenu:'sourcesafe.context',when:'resourceScheme == file',group:'sourcesafe'}]);
  for(const key of ['executablePath','databaseDirectory','projectRoot','username']) assert.equal(p.contributes.configuration.properties['sourcesafe.'+key].scope,'resource');
  assert.ok(!Object.keys(p.contributes.configuration.properties).some(x=>/password|senha/i.test(x)));
});

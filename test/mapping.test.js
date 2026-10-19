const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapToVss, validateVersion } = require('../dist/mapping');
test('mapeia Windows, Unicode, espaços e raiz', () => {
  assert.equal(mapToVss('C:\\Projetos\\RealizaERP', 'C:\\Projetos\\RealizaERP\\Regras\\Cliente.vb', '$/RealizaERP'), '$/RealizaERP/Regras/Cliente.vb');
  assert.equal(mapToVss('C:\\Projeto', 'c:\\projeto\\Ação Nova.vb', '$/ERP/'), '$/ERP/Ação Nova.vb');
  assert.equal(mapToVss('C:\\Projeto', 'C:\\Projeto', '$/'), '$/');
  assert.equal(mapToVss('\\\\server\\share\\projeto', '\\\\server\\share\\projeto\\sub\\a.vb', '$/ERP'), '$/ERP/sub/a.vb');
});
test('rejeita caminhos externos, unidades diferentes e raízes inválidas', () => {
  for (const local of ['C:\\Projetos2\\a.vb','D:\\Projetos\\a.vb','C:\\Projetos\\..\\a.vb']) assert.throws(() => mapToVss('C:\\Projetos', local, '$/ERP'));
  for (const root of ['ERP', '$/ERP/../Outro', '$/ERP//Sub', '$/ERP/*', '$/ERP\\Sub']) assert.throws(() => mapToVss('C:\\Projetos', 'C:\\Projetos\\a.vb', root));
});
test('versões não aceitam opções nem identificadores arbitrários', () => {
  assert.equal(validateVersion('12'),'12');
  for (const version of ['0','-1','1 -R','1.2','', '9007199254740992']) assert.throws(() => validateVersion(version));
});

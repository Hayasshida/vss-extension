const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SourceSafeClient, VssError, operationArgs, isAuthenticationFailure, redact } = require('../dist/client');
const fixture = path.join(__dirname,'fixture.cjs');
function client(log = () => {}) { return new SourceSafeClient({executable:process.execPath,database:'C:\\Banco VSS',username:'dev',encoding:'utf8'}, log); }
test('argumentos separados, sem shell; exclusividade nativa e nenhum recurse implícito', () => {
  assert.deepEqual(operationArgs('Checkout','$/ERP/a b.vb',{localDirectory:'C:\\ERP'}),['Checkout','$/ERP/a b.vb','-I-','-GLC:\\ERP','-E']);
  assert.deepEqual(operationArgs('Get','$/ERP',{version:'2'}),['Get','$/ERP','-I-','-V2']);
  assert.ok(operationArgs('Get','$/ERP',{recursive:true,confirmed:true}).includes('-I-Y'));
  assert.ok(operationArgs('Checkin','$/ERP/a',{comment:'$(whoami) & "x"'}).includes('-C$(whoami) & "x"'));
  assert.ok(operationArgs('Checkin','$/ERP/a').includes('-C-'));
  assert.throws(() => operationArgs('Checkin','$/ERP/a',{comment:'a\nb'}));
});
test('transporte preserva argumentos e envia credenciais exclusivamente pelo ambiente', async () => {
  const result = await client().execute([fixture,'echo','a b','$(touch /tmp/never-run)','"quote"'],__dirname,'secret-unique');
  const data=JSON.parse(result.stdout);
  assert.deepEqual(data.args,['a b','$(touch /tmp/never-run)','"quote"']);
  assert.equal(data.database,'C:\\Banco VSS');assert.equal(data.user,'dev');assert.equal(data.passwordPresent,true);
});
test('autenticação e logs não expõem senha', async () => {
  const logs=[];await assert.rejects(client(x=>logs.push(x)).execute([fixture,'auth'],__dirname,'secret-unique'),e=>e instanceof VssError && e.kind==='authentication');
  assert.ok(!logs.join('\n').includes('secret-unique'));
  assert.equal(redact('secret-unique secret-unique','secret-unique'),'[senha omitida] [senha omitida]');
  assert.ok(isAuthenticationFailure('Senha incorreta'));
  assert.equal(isAuthenticationFailure('Access denied'),false);
});
test('informações não são falhas; retorno não zero é falha', async () => {
  assert.equal((await client().execute([fixture,'info'],__dirname)).code,0);
  await assert.rejects(client().execute([fixture,'fail'],__dirname),/código 7/);
});
test('falha de spawn e cancelamentos são tratados', async () => {
  const c = new SourceSafeClient({executable:path.join(__dirname,'missing-executable'),database:'x',username:'x',encoding:'utf8'},()=>{});
  await assert.rejects(c.execute([],__dirname),/Não foi possível executar/);
  const before=new AbortController();before.abort();
  await assert.rejects(client().execute([fixture,'hang'],__dirname,undefined,before.signal),e=>e.kind==='cancelled');
  const during=new AbortController();const pending=client().execute([fixture,'hang'],__dirname,undefined,during.signal);
  setTimeout(()=>during.abort(),80);
  await assert.rejects(pending,e=>e.kind==='cancelled');
});
test('ajuda instalada deve confirmar todos os parâmetros antes de executar', async () => {
  const c=client();let calls=[];
  c.execute=async args=>{calls.push(args);return {code:0,stdout:'Get -I[-|Y|N] -GLpath -R -Vversion',stderr:''};};
  await c.verify('Get',__dirname,['I','GL','R','V']);
  assert.deepEqual(calls,[['Help','Get']]);
  await assert.rejects(c.verify('Get',__dirname,['E']),e=>e.kind==='compatibility');
  c.execute=async()=>({code:1,stdout:'',stderr:'unknown command'});
  await assert.rejects(c.verify('Checkout',__dirname,['E']),e=>e.kind==='compatibility');
});

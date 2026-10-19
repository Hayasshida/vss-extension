// Exercises UI orchestration against the public API shape. Does not validate a real editor/VSS.
const {test, before, after, beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const Module=require('node:module');
const {VssError}=require('../dist/client');
const registered=new Map(), calls=[], notices=[], secrets=new Map(), diffs=[];
let root, localFile, configuration, context, answers, failAuth, failOperation, promptCount, folderFor, dirtyDocuments, snapshotProvider;
const disposable=()=>({dispose(){}});
const uri=(file,scheme='file')=>({fsPath:file,path:file,scheme,toString:()=>`${scheme}://${file}`,with(change){return uri(file,change.scheme||scheme);}});
const api={
 Uri:{file:uri}, ProgressLocation:{Notification:15},
 window:{
  createOutputChannel:()=>({appendLine(){},show(){},dispose(){}}),
  showErrorMessage:async msg=>{notices.push(msg);},
  showInformationMessage:async msg=>{notices.push(msg);},
  showWarningMessage:async(msg,options,action)=>{calls.push(['confirm',msg]);return answers.confirm ? action : undefined;},
  showQuickPick:async()=>answers.pick,
  showInputBox:async options=>{promptCount++;return options.password? answers.password:answers.input;},
  withProgress:async(options,fn)=>fn({}, {isCancellationRequested:false,onCancellationRequested:disposable})
 },
 workspace:{
  isTrusted:true,
  get textDocuments(){return dirtyDocuments;},
  getWorkspaceFolder:u=>{calls.push(['folder',u.fsPath]);return folderFor?folderFor(u):{uri:uri(root)};},
  getConfiguration:(section,resource)=>({get:(key,fallback)=>{calls.push(['setting',section,key,resource?.fsPath]);return section==='sourcesafe'?(configuration[key]??fallback):fallback;}}),
  registerTextDocumentContentProvider:(scheme,provider)=>{snapshotProvider=provider;return disposable();}
 },
 commands:{registerCommand:(id,fn)=>{registered.set(id,fn);return disposable();},executeCommand:async(...args)=>{diffs.push(args);}}
};
class Client {
 constructor(config){this.config=config;}
 async verify(...args){calls.push(['verify',...args]);}
 async run(op,item,cwd,password,options){
  calls.push(['run',op,item,cwd,password,options]);
  if(op==='Properties'&&failAuth>0){failAuth--;throw new VssError('Autenticação recusada','authentication');}
  if(op===failOperation)throw new VssError('Operação recusada pelo banco');
  if(op==='Get' && options.localDirectory && path.basename(options.localDirectory).startsWith('sourcesafe-diff-'))await fs.writeFile(path.join(options.localDirectory,path.basename(localFile)),'versão do banco');
  return {code:0,stdout:'real output from mock transport',stderr:''};
 }
}
const originalPlatform=Object.getOwnPropertyDescriptor(process,'platform');
before(async()=>{
 root=await fs.mkdtemp(path.join(os.tmpdir(),'vss-ui-test-'));localFile=path.join(root,'arquivo.vb');
 await fs.writeFile(localFile,'local preservado');await fs.mkdir(path.join(root,'db'));await fs.writeFile(path.join(root,'db','srcsafe.ini'),'test fixture');await fs.writeFile(path.join(root,'ss.exe'),'test fixture');
 context={subscriptions:[],secrets:{get:async key=>secrets.get(key),store:async(key,value)=>{secrets.set(key,value);}}};
 const originalLoad=Module._load;
 Module._load=function(id,parent,...rest){if(id==='vscode')return api;if(id==='./client'&&parent?.filename.endsWith('extension.js'))return {SourceSafeClient:Client,VssError};return originalLoad.call(this,id,parent,...rest);};
 try {require('../dist/extension').activate(context);}finally{Module._load=originalLoad;}
 Object.defineProperty(process,'platform',{value:'win32'});
});
after(async()=>{Object.defineProperty(process,'platform',originalPlatform);for(const sub of context.subscriptions)sub.dispose();await fs.rm(root,{recursive:true,force:true});});
beforeEach(()=>{calls.length=0;notices.length=0;diffs.length=0;secrets.clear();answers={confirm:true,input:'comentário',pick:'Última versão',password:'senha'};failAuth=0;failOperation=undefined;promptCount=0;folderFor=undefined;dirtyDocuments=[];configuration={executablePath:path.join(root,'ss.exe'),databaseDirectory:path.join(root,'db'),projectRoot:'$/ERP',username:'ana',outputEncoding:'utf8'};});
const invoke=command=>registered.get('sourcesafe.'+command)(uri(localFile));
const runs=op=>calls.filter(c=>c[0]==='run'&&c[1]===op);
test('registra exatamente os oito comandos',()=>assert.deepEqual([...registered.keys()],['getLatest','get','checkout','checkin','undoCheckout','history','compare','properties'].map(x=>'sourcesafe.'+x)));
test('Get e UndoCheckout cancelados não executam escrita',async()=>{
 answers.confirm=false;
 await invoke('getLatest');await invoke('undoCheckout');await invoke('checkout');
 assert.equal(runs('Get').length,0);assert.equal(runs('UndoCheckout').length,0);assert.equal(runs('Checkout').length,0);
});
test('Get de pasta distingue recursivo e não recursivo; versão validada',async()=>{
 await registered.get('sourcesafe.getLatest')(uri(root));assert.equal(runs('Get')[0][5].recursive,true);
 calls.length=0;await registered.get('sourcesafe.get')(uri(root));assert.equal(runs('Get')[0][5].recursive,false);
 calls.length=0;answers.pick='Versão específica...';answers.input='42';await invoke('get');assert.equal(runs('Get')[0][5].version,'42');
 calls.length=0;answers.input='-R';await invoke('get');assert.equal(runs('Get').length,0);
});
test('cancelar seleção, versão ou comentário não executa operação',async()=>{
 answers.pick=undefined;await invoke('get');assert.equal(runs('Get').length,0);
 answers.pick='Versão específica...';answers.input=undefined;await invoke('get');assert.equal(runs('Get').length,0);
 await invoke('checkin');assert.equal(runs('Checkin').length,0);
});
test('Checkin falho não anuncia sucesso e mantém arquivo',async()=>{
 failOperation='Checkin';await invoke('checkin');
 assert.equal(runs('Checkin').length,1);assert.ok(notices.includes('Operação recusada pelo banco'));assert.ok(!notices.some(n=>n.includes('confirmou')));
 assert.equal(await fs.readFile(localFile,'utf8'),'local preservado');
});
test('desfazer exige confirmação e checkout verifica exclusividade',async()=>{
 await invoke('undoCheckout');assert.equal(runs('UndoCheckout')[0][5].confirmed,true);assert.ok(calls.some(c=>c[0]==='confirm'&&c[1].includes('perdidas')));
 await invoke('checkout');assert.ok(calls.some(c=>c[0]==='verify'&&c[1]==='Checkout'&&c[3].includes('E')));
});
test('senha só é solicitada após recusa; cancelamento não avança',async()=>{
 await invoke('history');assert.equal(promptCount,0);
 failAuth=1;await invoke('history');assert.equal(promptCount,1);assert.equal(secrets.size,1);
 assert.equal([...secrets.values()][0],'senha');
 calls.length=0;failAuth=1;answers.password=undefined;await invoke('checkin');assert.equal(runs('Checkin').length,0);
});
test('comparação usa snapshot somente leitura e preserva arquivo original',async()=>{
 await invoke('compare');assert.equal(diffs.length,1);assert.equal(diffs[0][0],'vscode.diff');assert.equal(diffs[0][1].scheme,'file');assert.equal(diffs[0][2].fsPath,localFile);
 assert.equal(await fs.readFile(diffs[0][1].fsPath,'utf8'),'versão do banco');
 assert.equal((await fs.stat(diffs[0][1].fsPath)).mode & 0o222,0);
 assert.equal(await fs.readFile(localFile,'utf8'),'local preservado');
 assert.equal(runs('Get')[0][5].confirmed,undefined);
});
test('arquivo remoto, pasta em comando de arquivo e configuração inválida são rejeitados',async()=>{
 await registered.get('sourcesafe.history')(uri(localFile,'untitled'));assert.equal(runs('History').length,0);
 await registered.get('sourcesafe.checkin')(uri(root));assert.equal(runs('Checkin').length,0);
 configuration.executablePath='ss.exe';await invoke('history');assert.equal(runs('History').length,0);
});
test('configuração é consultada com URI da pasta correta em multi-root',async()=>{
 folderFor=()=>({uri:uri(root)});await invoke('history');
 assert.ok(calls.some(c=>c[0]==='setting'&&c[1]==='sourcesafe'&&c[3]===localFile));assert.equal(runs('History')[0][2],'$/ERP/arquivo.vb');
});
test('documento não salvo requer salvar e cancelar impede Checkin',async()=>{
 let saved=0;dirtyDocuments=[{isDirty:true,uri:uri(localFile),save:async()=>{saved++;return true;}}];
 answers.confirm=false;await invoke('checkin');assert.equal(runs('Checkin').length,0);assert.equal(saved,0);
 answers.confirm=true;await invoke('checkin');assert.equal(saved,1);assert.equal(runs('Checkin').length,1);
});

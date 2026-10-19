// Fake process for transport tests only. Not a SourceSafe implementation.
const [mode, ...args] = process.argv.slice(2);
if (mode === 'echo') console.log(JSON.stringify({ args, database: process.env.SSDIR, user: process.env.SSUSER, passwordPresent: process.env.SSPWD === 'secret-unique' }));
if (mode === 'auth') { console.error('Invalid password: '+ process.env.SSPWD); process.exitCode = 1; }
if (mode === 'info') console.log('Informational message');
if (mode === 'fail') { console.error('Access denied'); process.exitCode = 7; }
if (mode === 'hang') setInterval(() => {}, 1000);

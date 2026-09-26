// Lists public BuddiesStore/mixin methods and counts textual `.name` uses in unleashd/server/src.
import fs from 'fs'; import path from 'path';
const src='/Users/nicholasbardy/git/unleashd/node_modules/@nbardy/buddies/src';
const files=['store.js','coordination.js','coordination-work.js','coordination-receipts.js','coordination-approvals.js','background-work.js','team-access.js','team-configuration.js','knowledge.js','mailbox.js','lists.js'];
const skip=new Set(['if','for','while','switch','return','constructor','add','string','strict','refCheck','bool','requireActive','requiredMember','compileGrant','set','grant','hash','transaction','migrateCoordinationApprovals','createHash']);
const methods=[];
for(const f of files){fs.readFileSync(path.join(src,f),'utf8').split('\n').forEach((l,i)=>{
  const m=f==='store.js'?(i>242&&l.match(/^  (?:async )?([A-Za-z_]\w*)\s*\(/)):l.match(/^(?:  |\t)(?:async )?([A-Za-z_]\w*)\s*\(/);
  if(m&&!skip.has(m[1]))methods.push({f,line:i+1,name:m[1]});});}
const walk=(d,o=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);e.isDirectory()?walk(p,o):/\.(ts|tsx|js|mjs)$/.test(e.name)&&o.push(p);}return o;};
const root='/Users/nicholasbardy/git/unleashd/server/src';
const sf=walk(root).map(p=>({p,t:fs.readFileSync(p,'utf8')}));
const seen=new Set();console.log('where\tmethod\tserver_uses\tfiles');
for(const m of methods){if(seen.has(m.name))continue;seen.add(m.name);const re=new RegExp('\\.'+m.name+'\\b','g');let n=0;const fl=[];
 for(const s of sf){const c=(s.t.match(re)||[]).length;if(c){n+=c;fl.push(path.relative(root,s.p)+':'+c);}}
 console.log([m.f+':'+m.line,m.name,n,fl.join(' ')].join('\t'));}

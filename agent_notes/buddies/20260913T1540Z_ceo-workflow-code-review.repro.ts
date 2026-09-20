import { BuddiesStore } from '/Users/nicholasbardy/git/unleashd/node_modules/@nbardy/buddies/src/index.js';
import { BuddyRunExecutor } from '/Users/nicholasbardy/git/unleashd/server/src/buddies/run-executor.ts';
async function main(){
const raw = new BuddiesStore(':memory:');
const w=raw.createWorkspace({name:'Review repro',rootPath:'/tmp/buddy-review-repro'});
const lead=raw.createBuddy({project:w.id,name:'Lead',role:'Review'});
const worker=raw.createBuddy({project:w.id,name:'Worker',role:'Build'});
for(const b of [lead,worker]) raw.setCoordinationMembership(b.id,w.id,{background_enabled:true});
raw.linkConversation({buddy:lead.id,workspace:w.id,provider:'codex',unleashdConversationId:'human'});
raw.setBuddyRelationship({fromBuddy:lead.id,toBuddy:worker.id,kind:'manager'});
const p=raw.createCoordinatedProject({workspaceId:w.id,buddyId:worker.id,title:'Export',definitionOfDone:'Saved export verified',todos:[{title:'Export',definitionOfDone:'Export verified'}]},{actor:worker.id,key:'p'});
const m=raw.sendCoordinatedMessage({fromBuddy:lead.id,to:worker.id,workspace:w.id,project:p.id,parentConversationId:'human',key:'work',purpose:'Export',body:'Save export',execution:{mode:'until_done',maxRuns:1,maxDurationSeconds:600}},{policy:{allowed_operations:['buddy.get_inbox','buddy.get_current_work','buddy.send','buddy.checkpoint']},returnConversationId:'return'});
const child=raw.listBuddyRuns()[0];
raw.claimBuddyRun(child.id,{conversationId:'worker',claimToken:'token',maxRuntimeSeconds:1});
raw.startBuddyRun(child.id,'token');
raw.checkpointBuddyRun(child.id,{claimToken:'token',key:'cp',artifacts:[{ref:'saved-export.md',version:'v1'}],effects:['Saved export'],resume:'Inspect saved-export.md before repeating',visibility:'participants'});
raw.finishBuddyRun(child.id,{claimToken:'token',status:'failed',error:'Maximum runtime reached',errorCode:'max_runtime_timeout'});
const returns=raw.listBuddyRuns().filter(r=>r.id!==child.id);
let received='';
const conversations=new Map();
const executor=new BuddyRunExecutor({store:raw,getConversation:id=>conversations.get(id),createConversation:async input=>{const c={id:input.conversationId,placement:'background',buddyContext:input.context,isRunning:false,hasActiveProcess:()=>false,queue:[],runCoordinationMessage:async(prompt,context,token,done)=>{received=prompt;done('complete','reviewed');}};conversations.set(c.id,c);return c;}});
executor.poll();
await new Promise(r=>setTimeout(r,20));
console.log(JSON.stringify({messageStatus:raw.getMessage(m.id).status,returnKinds:returns.map(r=>r.input_kind),checkpointSaved:raw.listRunCheckpoints(child.id).length,promptIncludesCheckpoint:received.includes('saved-export.md'),prompt:received},null,2));
raw.close();
}
main().catch(e=>{console.error(e);process.exitCode=1;});

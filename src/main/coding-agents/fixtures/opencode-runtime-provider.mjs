// Synthetic external-provider protocol fixture. No application implementation is mocked.
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}');
const fixture = JSON.parse(await readFile(join(process.cwd(), 'provider-fixture.json'), 'utf8'));
const sessions = new Map();
const history = [...(fixture.messages||[])];
const streams = new Set();
const catalog = async () => {
 const result = [...(fixture.baselineSkills || [])];
 for (const root of config.skills?.paths || []) for (const name of await readdir(root)) {
  const location = join(root,name,'SKILL.md'); const document = await readFile(location,'utf8');
  const content = document.replace(/^---\n[\s\S]*?\n---\n/, '');
  result.push({name,location,description:'Synthetic isolation check.',content});
 }
 return result;
};
const commands = async () => [...(fixture.baselineCommands||[]).map(c=>({...c,template:c.template.replace('${path}',process.cwd())})),...(await catalog()).map(s=>({name:s.name,source:'skill',template:s.location==='<built-in>'?s.content:[s.content,'',`Base directory for this skill: ${dirname(s.location)}`,'Relative paths in this skill (e.g., scripts/, references/) are relative to this base directory.'].join('\n'),hints:[]}))];
const server=createServer(async(req,res)=>{
 const url = new URL(req.url,'http://localhost');let body='';for await(const c of req)body+=c;
 const input=body?JSON.parse(body):{};
 res.setHeader('Content-Type','application/json');
 if(url.pathname==='/global/event'){res.setHeader('Content-Type','text/event-stream');res.write('data: '+JSON.stringify({directory:process.cwd(),payload:{type:'server.connected',properties:{}}})+'\n\n');streams.add(res);req.on('close',()=>streams.delete(res));return;}
 let data;
 if(url.pathname==='/global/health')data={healthy:true,version:fixture.version};
 else if(url.pathname==='/skill')data=await catalog();
 else if(url.pathname==='/command')data=await commands();
 else if(url.pathname==='/config')data={...config,...fixture.configOverride};
 else if(url.pathname==='/experimental/tool/ids')data=fixture.tools || [];
 else if(url.pathname==='/mcp')data=Object.fromEntries(Object.keys(config.mcp||{}).map(k=>[k,{status:'connected'}]));
 else if(url.pathname==='/session/status')data={};
 else if(url.pathname==='/session' && req.method==='POST'){data={id:'session-'+(sessions.size+1),title:input.title};sessions.set(data.id,{info:data,parts:[]});}
 else if(/^\/session\/[^/]+$/.test(url.pathname))data=sessions.get(url.pathname.split('/')[2])?.info||{id:url.pathname.split('/')[2]};
 else if(url.pathname.endsWith('/message'))data=history;
 else if(url.pathname.endsWith('/command')||url.pathname.endsWith('/prompt_async')){
  if(fixture.injectCommand&&url.pathname.endsWith('/command')) {const cmd=(await commands()).find(c=>c.name===input.command);history.push({info:{id:input.messageID,sessionID:url.pathname.split('/')[2],role:'user',time:{created:1}},parts:[{id:'user-part',type:'text',sessionID:url.pathname.split('/')[2],messageID:input.messageID,text:(cmd.template+(input.arguments?.trim()?"\n\n"+input.arguments:"")).trim()}]});}
  for(const event of fixture.events||[])for(const stream of streams)stream.write('data: '+JSON.stringify({directory:process.cwd(),payload:event})+'\n\n');
  data={info:{id:'reply',sessionID:url.pathname.split('/')[2]},parts:fixture.commandParts||[]};
  if(fixture.exitAfterPrompt)setTimeout(()=>process.exit(0),20);
 }
 else data=true;
 res.end(JSON.stringify(data));
});
server.listen(Number(process.argv.at(-1)),'127.0.0.1');
process.on('SIGTERM',()=>{for(const s of streams)s.end();server.close(()=>process.exit(0));});

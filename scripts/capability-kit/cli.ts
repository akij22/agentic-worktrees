import { fileURLToPath } from "node:url"; import path from "node:path"; import { createCapability } from "./create-capability";
export interface CapabilityCreateCliIo { log(message:string):void; error(message:string):void }
export async function runCapabilityCreateCli(argv:readonly string[],io:CapabilityCreateCliIo={log:console.log,error:console.error}):Promise<number>{
 if(argv.length!==3||argv[1]!=="--tool"||!argv[0]||!argv[2]){io.error("Usage: npm run capability:create -- <slug> --tool <tool_name>");return 1;}
 try{const result=await createCapability({rootDirectory:process.cwd(),slug:argv[0],toolName:argv[2]}); for(const item of [...result.created,...result.modified])io.log(item); io.log(`Next:\nnpm install\nnpm test -- capabilities/${argv[0]}\nnpm run typecheck`);return 0;}catch(error){io.error(error instanceof Error?error.message:"Capability creation failed.");return 1;}
}
if(path.resolve(process.argv[1]??"")===fileURLToPath(import.meta.url)) process.exitCode=await runCapabilityCreateCli(process.argv.slice(2));

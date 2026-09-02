import { existsSync } from "node:fs";
import process from "node:process";

export function parseArguments(argv){const at=argv.indexOf("--provider");return {provider:at>=0?argv[at+1]:undefined};}
export function redact(value){return String(value).replace(/(?:Bearer\s+|token[=:]\s*)\S+/gi,"[REDACTED]");}
/** @param {{provider?: string, executable?: string}} [options] */
export async function runSkillSmoke(options={}){
 const {provider,executable=process.env.AW_SMOKE_EXECUTABLE}=options;
 if(!executable||!existsSync(executable))throw new Error("AW_SMOKE_EXECUTABLE must reference an owned packaged Electron executable.");
 if(provider&&!(["codex","opencode"].includes(provider)))throw new Error("Provider must be codex or opencode.");
 // The packaged app owns provider authentication. The smoke intentionally never initiates login.
 const {runPackagedSkillScenarios}=await import("./driver.mjs");
 return runPackagedSkillScenarios({executable,provider});
}
if(import.meta.url===`file://${process.argv[1]}`)runSkillSmoke({...parseArguments(process.argv.slice(2))}).catch(error=>{console.error(redact(error instanceof Error?error.message:error));process.exitCode=1;});

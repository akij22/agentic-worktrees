import {describe,expect,it} from "vitest";
import {codingAgentTurnRequestSchema,skillDetailSchema,skillInvocationRequestSchema,skillSummarySchema} from "./schemas";
const summary={id:"security-review",name:"security-review",description:"Review security",version:"1.0.0",source:"local" as const,compatibility:{codex:"supported" as const,opencode:"supported" as const},installationState:"installed" as const,automaticInvocation:true};
describe("Agent Skill contracts",()=>{
 it("accepts one versioned invocation",()=>expect(skillInvocationRequestSchema.parse({skillId:"security-review",version:"1.0.0",arguments:"Review auth"})).toMatchObject({skillId:"security-review"}));
 it("accepts ordinary turns",()=>expect(codingAgentTurnRequestSchema.parse({runId:"r",content:"hello"})).toMatchObject({content:"hello"}));
 it("rejects content and invocation together",()=>expect(()=>codingAgentTurnRequestSchema.parse({runId:"r",content:"x",skillInvocation:{skillId:"security-review",version:"1"}})).toThrow());
 it.each(["Security","security_review","-security","security--review","security-"])("rejects invalid id %s",id=>expect(()=>skillSummarySchema.parse({...summary,id,name:id})).toThrow());
 it("rejects overlong descriptions",()=>expect(()=>skillSummarySchema.parse({...summary,description:"x".repeat(1025)})).toThrow());
 it("strips managed paths from details",()=>expect(skillDetailSchema.parse({...summary,license:null,origin:"local",contentDigest:`sha256:${"a".repeat(64)}`,reviewState:"reviewed",instructionPreview:"preview",packagePath:"/secret"})).not.toHaveProperty("packagePath"));
});

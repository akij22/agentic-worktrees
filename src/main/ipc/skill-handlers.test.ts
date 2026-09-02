import {describe,expect,it,vi} from "vitest";import {createSkillHandlers} from "./skill-handlers";
const detail={id:"security-review",name:"security-review",description:"Review",version:"1",source:"local",compatibility:{codex:"supported",opencode:"supported"},installationState:"installed",automaticInvocation:true,license:null,origin:"local",contentDigest:`sha256:${"a".repeat(64)}`,reviewState:"reviewed",instructionPreview:"preview"};
describe("skill IPC handlers",()=>{
 it("opens a main-owned picker",async()=>{const service={installFromDirectory:vi.fn(async()=>detail)},handlers=createSkillHandlers(service as never,{chooseDirectory:vi.fn(async()=>"/chosen")});await handlers.install({});expect(service.installFromDirectory).toHaveBeenCalledWith("/chosen");});
 it("rejects renderer paths",async()=>{const handlers=createSkillHandlers({} as never,{chooseDirectory:vi.fn()});await expect(handlers.install({path:"/renderer"})).rejects.toThrow();});
 it("returns null when canceled",async()=>expect(createSkillHandlers({} as never,{chooseDirectory:vi.fn(async()=>null)}).install({})).resolves.toBeNull());
 it("redacts unknown DTO fields",async()=>{const handlers=createSkillHandlers({getSkill:vi.fn(()=>({...detail,packagePath:"/secret"}))} as never,{chooseDirectory:vi.fn()});expect(await handlers.get({skillId:"security-review"})).not.toHaveProperty("packagePath");});
 it("validates remove IDs",async()=>{const removeSkill=vi.fn();const handlers=createSkillHandlers({removeSkill} as never,{chooseDirectory:vi.fn()});await expect(handlers.remove({skillId:"BAD"})).rejects.toThrow();expect(removeSkill).not.toHaveBeenCalled();});
});

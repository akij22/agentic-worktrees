import { skillDetailSchema, skillIdSchema, skillSummarySchema } from "../../shared/skills/schemas";
import { skillGetRequestSchema, skillInstallRequestSchema, skillRemoveRequestSchema } from "../../shared/ipc/schemas";
import type { SkillService } from "../skills/skill-service";

export interface SkillHandlerDependencies { chooseDirectory():Promise<string|null> }
export function createSkillHandlers(service:SkillService, dependencies:SkillHandlerDependencies){
  return {
    list: async()=>skillSummarySchema.array().parse(service.listSkills()),
    get: async(raw:unknown)=>{ const {skillId}=skillGetRequestSchema.parse(raw); const detail=service.getSkill(skillId); if(!detail)throw new Error("Skill is not installed."); return skillDetailSchema.parse(detail); },
    install: async(raw:unknown)=>{ skillInstallRequestSchema.parse(raw); const directory=await dependencies.chooseDirectory(); if(!directory)return null; return skillDetailSchema.parse(await service.installFromDirectory(directory)); },
    remove: async(raw:unknown)=>{ const {skillId}=skillRemoveRequestSchema.parse(raw); skillIdSchema.parse(skillId); await service.removeSkill(skillId); },
  };
}

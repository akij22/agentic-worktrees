import type { SkillSummaryDto } from "../../../../shared/skills/schemas";

export function isSkillSelectable(skill: SkillSummaryDto, agentKind: "codex" | "opencode"): boolean {
  return skill.installationState === "installed" && skill.compatibility[agentKind] === "supported";
}

export function SkillCommandMenu({skills,selectedIndex,agentKind,onSelect,onHover}:{skills:SkillSummaryDto[];selectedIndex:number;agentKind:"codex"|"opencode";onSelect(skill:SkillSummaryDto):void;onHover(index:number):void}){return <div role="listbox" aria-label="Installed skills" className="absolute bottom-[calc(100%-0.25rem)] left-4 right-4 z-30 rounded-lg border border-border bg-popover p-1.5 shadow-xl">{skills.map((skill,index)=><button key={skill.id} role="option" aria-selected={index===selectedIndex} disabled={!isSkillSelectable(skill,agentKind)} onMouseEnter={()=>{if(isSkillSelectable(skill,agentKind))onHover(index);}} onMouseDown={event=>event.preventDefault()} onClick={()=>{if(isSkillSelectable(skill,agentKind))onSelect(skill);}} className={`w-full rounded-md px-3 py-2 text-left ${index===selectedIndex?"bg-accent":"hover:bg-muted"}`}><strong className="text-sm">{skill.name}</strong><span className="ml-2 font-mono text-[10px] text-primary">/skill:{skill.id}</span><span className="mt-1 block text-xs text-muted-foreground">{skill.description}</span></button>)}</div>}

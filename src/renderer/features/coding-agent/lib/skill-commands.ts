export interface ActiveSkillCommand { query:string; arguments:string }
export function findActiveSkillCommand(draft:string):ActiveSkillCommand|undefined { const match=/^\/skill:([a-z0-9-]*)(?:\s([\s\S]*))?$/.exec(draft); if(!match||(!match[1]&&match[2]!==undefined))return undefined; return {query:match[1]??"",arguments:match[2]??""}; }

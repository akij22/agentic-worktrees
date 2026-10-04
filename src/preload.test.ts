import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipcRenderer } from "electron";
import { IPC_CHANNELS } from "./shared/ipc/channels";
import type { Api } from "./shared/ipc/api";
const mocks=vi.hoisted(()=>({api:null as unknown,listeners:new Map<string,(e:unknown,p:unknown)=>void>(),remove:vi.fn()}));
vi.mock("electron",()=>({contextBridge:{exposeInMainWorld:vi.fn((_n:string,v:unknown)=>{mocks.api=v})},ipcRenderer:{invoke:vi.fn(),on:vi.fn((c:string,l:(e:unknown,p:unknown)=>void)=>mocks.listeners.set(c,l)),removeListener:mocks.remove}}));
const detail={id:"agentic-worktrees.web-search",name:"Web Search",version:"1.0.0",sdkVersion:"^0.1.0",description:"Search",category:"search",author:{name:"Agentic Worktrees"},license:"MIT",compatibility:{codex:"supported",opencode:"supported"},permissions:{network:[],secrets:[]},settings:[],state:"ready",secretConfigured:false,installationState:"installed",source:"npm",packageName:"@agentic-worktrees/web-search",trust:"official",reviewStatus:"official-reviewed",activeRunCount:0,providedTools:["web_search"],permissionDigest:"digest"} as const;
const installRequest={inspectionId:"i",acceptedPackageName:"@agentic-worktrees/web-search",acceptedVersion:"1.0.0",acceptedIntegrity:"sha",acceptedPermissionDigest:"p"};
const updateRequest={...installRequest,packageName:"@agentic-worktrees/web-search",acceptedDowngrade:false,acceptedActiveRunCount:0};
const removal={inspectionId:"remove-i",packageName:"@agentic-worktrees/web-search",capabilityId:"agentic-worktrees.web-search",activeVersion:"1.0.0",activeIntegrity:"sha",activeContentDigest:"digest",activeRunCount:0,expiresAt:"2026-09-02T00:00:00.000Z"};
const removeRequest={inspectionId:"remove-i",packageName:"@agentic-worktrees/web-search",acceptedActiveVersion:"1.0.0",acceptedActiveRunCount:0};
const update={packageName:"@agentic-worktrees/web-search",capabilityId:"agentic-worktrees.web-search",currentVersion:"1.0.0",candidateVersion:"1.1.0",downgrade:false,activeRunCount:0};
const inspection={inspectionId:"i",packageName:"@agentic-worktrees/web-search",requestedSpec:"@agentic-worktrees/web-search",resolvedVersion:"1.0.0",integrity:"sha",contentDigest:"digest",trust:"official",reviewStatus:"official-reviewed",releaseNotes:"",capability:detail,permissionDigest:"p",expiresAt:"2026-09-02T00:00:00.000Z"};

it("decodes typed session admission failures and preserves the public Send API",async()=>{
 vi.resetModules();vi.mocked(ipcRenderer.invoke).mockReset();await import("./preload");
 const api=(mocks.api as Api).codingAgent;
 vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ok:false,error:{code:"assignment_waiting_for_idle",message:"Waiting for active sessions before applying resource changes.",retryable:false}});
 await expect(api.sendMessage({runId:"run",content:"Keep this draft"})).rejects.toMatchObject({code:"assignment_waiting_for_idle",message:"Waiting for active sessions before applying resource changes."});
 vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ok:true,value:null});
 await expect(api.sendMessage({runId:"run",content:"Accepted"})).resolves.toBeUndefined();
});

describe("marketplace preload",()=>{let api:Api["marketplace"];beforeEach(async()=>{vi.resetModules();mocks.listeners.clear();mocks.remove.mockClear();vi.mocked(ipcRenderer.invoke).mockReset();await import("./preload");api=(mocks.api as Api).marketplace;});
 it("maps every operation with exact payloads and valid returned values",async()=>{
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce([]);await expect(api.list()).resolves.toEqual([]);expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.MARKETPLACE_LIST,{});
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce(inspection);await expect(api.inspect({sourceSpec:"@agentic-worktrees/web-search"})).resolves.toMatchObject({inspectionId:"i"});expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.MARKETPLACE_INSPECT,{sourceSpec:"@agentic-worktrees/web-search"});
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce(detail);await expect(api.install(installRequest)).resolves.toMatchObject({id:detail.id});expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.MARKETPLACE_INSTALL,installRequest);
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce([update]);await expect(api.checkUpdates({packageName:"@agentic-worktrees/web-search"})).resolves.toEqual([update]);expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.MARKETPLACE_CHECK_UPDATES,{packageName:"@agentic-worktrees/web-search"});
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce(detail);await expect(api.update(updateRequest)).resolves.toMatchObject({id:detail.id});expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.MARKETPLACE_UPDATE,updateRequest);
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce(removal);await expect(api.inspectRemoval({packageName:removal.packageName})).resolves.toEqual(removal);expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.MARKETPLACE_INSPECT_REMOVAL,{packageName:removal.packageName});
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce(undefined);await expect(api.remove(removeRequest)).resolves.toBeUndefined();expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.MARKETPLACE_REMOVE,removeRequest);
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce(undefined);await expect(api.cancel({operationId:"op"})).resolves.toBeUndefined();expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.MARKETPLACE_CANCEL,{operationId:"op"});
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce(undefined);await expect(api.retryPendingMigrations()).resolves.toBeUndefined();expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.MARKETPLACE_RETRY_PENDING_MIGRATIONS,{});
 });
 it("validates progress and removes the exact event listener",()=>{const listener=vi.fn(),off=api.onPackageChanged(listener),registered=mocks.listeners.get(IPC_CHANNELS.MARKETPLACE_PACKAGE_CHANGED)!;const event={operationId:"op",action:"install",stage:"installing",status:"completed",updatedAt:"2026-09-02T00:00:00.000Z"};registered({},event);expect(listener).toHaveBeenCalledWith(event);expect(()=>registered({}, {...event,packageRoot:"/secret"})).toThrow();off();expect(mocks.remove).toHaveBeenCalledWith(IPC_CHANNELS.MARKETPLACE_PACKAGE_CHANGED,registered);});
 it("rejects malformed successful responses instead of exposing them",async()=>{vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({localPath:"/private"});await expect(api.list()).rejects.toThrow();});
});

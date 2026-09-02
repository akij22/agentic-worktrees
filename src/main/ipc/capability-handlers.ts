import { capabilityActivateRequestSchema, capabilityChangedEventSchema, capabilityConfigureRequestSchema, capabilityDeactivateRequestSchema, capabilityDetailSchema, capabilityGetRequestSchema, capabilityListRequestSchema, capabilitySessionStateSchema, capabilitySummarySchema } from "../../shared/ipc/schemas";
import type { CapabilityService } from "../capabilities/capability-service";

export function createCapabilityHandlers(service: CapabilityService) {
  return {
    list(raw: unknown) { const request = capabilityListRequestSchema.parse(raw ?? {}); return capabilitySummarySchema.array().parse(service.listCapabilities(request.runId)); },
    get(raw: unknown) { const request = capabilityGetRequestSchema.parse(raw); return capabilityDetailSchema.parse(service.getCapability(request.capabilityId, request.runId)); },
    async configure(raw: unknown) { return capabilityDetailSchema.parse(await service.configureCapability(capabilityConfigureRequestSchema.parse(raw))); },
    async activate(raw: unknown) { const request = capabilityActivateRequestSchema.parse(raw); return capabilitySessionStateSchema.parse(await service.activateCapability(request.runId, request.capabilityId)); },
    async deactivate(raw: unknown) { const request = capabilityDeactivateRequestSchema.parse(raw); return capabilitySessionStateSchema.parse(await service.deactivateCapability(request.runId, request.capabilityId)); },
    event(raw: unknown) { return capabilityChangedEventSchema.parse(raw); },
  };
}

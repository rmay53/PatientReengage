export type RoleKey = "admin" | "approver" | "viewer";

export interface Actor {
  id: string;
  email: string;
  role: RoleKey;
  locationId: string | null;
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export type Capability =
  | "view_counts" // segments page and audit log
  | "view_patients" // patient names, records, queue, inbox, outbox
  | "upload"
  | "draft"
  | "approve"
  | "handle_inbox"
  | "admin";

const CAPABILITIES: Record<RoleKey, Capability[]> = {
  admin: ["view_counts", "view_patients", "upload", "draft", "approve", "handle_inbox", "admin"],
  approver: ["view_counts", "view_patients", "upload", "draft", "approve", "handle_inbox"],
  viewer: ["view_counts"],
};

export function can(actor: Actor, capability: Capability): boolean {
  return CAPABILITIES[actor.role].includes(capability);
}

export function assertCan(actor: Actor, capability: Capability) {
  if (!can(actor, capability)) throw new ForbiddenError();
}

/**
 * Location ids this actor may see patient-level data for.
 * null means every location (admin). Approvers are limited to their own
 * location; an approver with no location sees nothing.
 */
export function locationScope(actor: Actor): string[] | null {
  if (actor.role === "admin") return null;
  if (actor.role === "approver") return actor.locationId ? [actor.locationId] : [];
  // Viewers see counts only; for counts they see every location.
  return null;
}

export function assertLocation(actor: Actor, locationId: string) {
  const scope = locationScope(actor);
  if (scope && !scope.includes(locationId)) throw new ForbiddenError("That record belongs to another location.");
}

/** Prisma `where` fragment restricting patients to the actor's locations. */
export function patientScopeWhere(actor: Actor): { locationId?: { in: string[] } } {
  assertCan(actor, "view_patients");
  const scope = locationScope(actor);
  return scope ? { locationId: { in: scope } } : {};
}

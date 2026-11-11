// Allocation and delivery are active; obsolete administration remains locked.
export const DELIVERY_ENABLED = true;
export const LEGACY_ADMIN_ENABLED = false;
export const DISTRIBUTION_ONLY = !DELIVERY_ENABLED;
export const APP_HOME_ROUTE = '/distribution';
export const MODULE_DISABLED_MESSAGE = 'Temporalmente inhabilitado';
export class ModuleUnavailableError extends Error {
  constructor() { super(MODULE_DISABLED_MESSAGE); this.status=423; this.code='MODULE_DISABLED'; }
}
export function requireDeliveryEnabled() { if (!DELIVERY_ENABLED) throw new ModuleUnavailableError(); }
export function requireLegacyAdminEnabled() { if (!LEGACY_ADMIN_ENABLED) throw new ModuleUnavailableError(); }

// Temporary phase: allocation remains active; collection and legacy modules are locked.
export const DISTRIBUTION_ONLY = true;
export const APP_HOME_ROUTE = DISTRIBUTION_ONLY ? '/distribution' : '/dashboard';
export const MODULE_DISABLED_MESSAGE = 'Temporalmente inhabilitado';
export class ModuleUnavailableError extends Error {
  constructor() { super(MODULE_DISABLED_MESSAGE); this.status=423; this.code='MODULE_DISABLED'; }
}
export function requireDeliveryEnabled() {
  if (DISTRIBUTION_ONLY) throw new ModuleUnavailableError();
}

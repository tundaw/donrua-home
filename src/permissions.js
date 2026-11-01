const HOUSE_MANAGER_ROLES = new Set(['truongnha']);

export function normalizeRole(role) {
  return String(role || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export function canManageHouse(role) {
  return HOUSE_MANAGER_ROLES.has(normalizeRole(role));
}

export function canManageCleaning(role) {
  return canManageHouse(role);
}

export function canManageAttendance(role) {
  return canManageHouse(role);
}

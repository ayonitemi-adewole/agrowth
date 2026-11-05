import type { Role } from './types';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  cycle_manager: 'Cycle manager',
  field_agent: 'Field agent',
  compliance_officer: 'Compliance officer',
  auditor: 'Auditor',
  investor: 'Investor',
  programme_manager: 'Programme manager',
  vendor: 'Vendor',
  offtaker: 'Offtaker',
};

export const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];

/*
 * These mirror the database's permission functions (is_registry_reader etc.) so the
 * app only shows buttons that will work. The database is still the one that enforces them.
 */
const has = (role: Role | undefined, allowed: Role[]) => !!role && allowed.includes(role);

export const can = {
  readRegistry: (r?: Role) =>
    has(r, [
      'admin',
      'cycle_manager',
      'field_agent',
      'compliance_officer',
      'auditor',
      'programme_manager',
    ]),
  enrol: (r?: Role) => has(r, ['admin', 'field_agent']),
  editCooperatives: (r?: Role) =>
    has(r, ['admin', 'field_agent', 'cycle_manager', 'programme_manager']),
  reviewKyc: (r?: Role) => has(r, ['admin', 'compliance_officer']),
  manageUsers: (r?: Role) => has(r, ['admin']),
};

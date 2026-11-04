/**
 * Every user has exactly one role. Edition-specific roles (investor, programme manager)
 * share the same core; the buyer enables whichever edition they license.
 */
export enum Role {
  Admin = 'admin',
  CycleManager = 'cycle_manager',
  FieldAgent = 'field_agent',
  ComplianceOfficer = 'compliance_officer',
  Auditor = 'auditor',
  Investor = 'investor',
  ProgrammeManager = 'programme_manager',
  Vendor = 'vendor',
  Offtaker = 'offtaker',
}

/** Roles that only an admin can create; everyone else self-registers as an investor. */
export const STAFF_ROLES: Role[] = [
  Role.Admin,
  Role.CycleManager,
  Role.FieldAgent,
  Role.ComplianceOfficer,
  Role.Auditor,
  Role.ProgrammeManager,
  Role.Vendor,
  Role.Offtaker,
];

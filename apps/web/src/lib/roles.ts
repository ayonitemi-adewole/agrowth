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
  trustee: 'Trustee',
};

export const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];

/*
 * These mirror the database's permission functions (is_registry_reader etc.) so the
 * app only shows buttons that will work. The database is still the one that enforces them.
 */
const has = (role: Role | undefined, allowed: Role[]) => !!role && allowed.includes(role);

const REGISTRY_READERS: Role[] = [
  'admin',
  'cycle_manager',
  'field_agent',
  'compliance_officer',
  'auditor',
  'programme_manager',
];

export const can = {
  /** Anyone working the platform (not investors, vendors or offtakers). */
  useStaffApp: (r?: Role) => has(r, [...REGISTRY_READERS, 'trustee']),
  /** Who can sign in at all: staff, vendors at their shop counter, and investors. */
  useApp: (r?: Role) => has(r, [...REGISTRY_READERS, 'trustee', 'vendor', 'investor']),
  /** The investor portal: marketplace, pledges, portfolio, KYC. */
  invest: (r?: Role) => has(r, ['investor']),
  /** See a cycle's investor listing: investors, and staff previewing it. */
  viewListings: (r?: Role) => has(r, [...REGISTRY_READERS, 'trustee', 'investor']),
  /** Investor KYC records: compliance reviews them, the trustee pays out to them. */
  readInvestors: (r?: Role) => has(r, ['admin', 'auditor', 'compliance_officer', 'trustee']),
  reviewInvestors: (r?: Role) => has(r, ['admin', 'compliance_officer']),
  editInvestorSettings: (r?: Role) => has(r, ['admin']),
  readVendors: (r?: Role) => has(r, [...REGISTRY_READERS, 'trustee']),
  editVendors: (r?: Role) => has(r, ['admin', 'field_agent', 'cycle_manager', 'programme_manager']),
  reviewVendors: (r?: Role) => has(r, ['admin', 'compliance_officer']),
  linkVendorAccounts: (r?: Role) => has(r, ['admin']),
  redeemVouchers: (r?: Role) => has(r, ['vendor']),
  voidRedemptions: (r?: Role) =>
    has(r, ['admin', 'cycle_manager', 'programme_manager', 'compliance_officer']),
  readRegistry: (r?: Role) => has(r, REGISTRY_READERS),
  enrol: (r?: Role) => has(r, ['admin', 'field_agent']),
  editCooperatives: (r?: Role) =>
    has(r, ['admin', 'field_agent', 'cycle_manager', 'programme_manager']),
  reviewKyc: (r?: Role) => has(r, ['admin', 'compliance_officer']),
  manageUsers: (r?: Role) => has(r, ['admin']),
  readCycles: (r?: Role) => has(r, [...REGISTRY_READERS, 'trustee']),
  manageCycles: (r?: Role) => has(r, ['admin', 'cycle_manager', 'programme_manager']),
  reviewCycles: (r?: Role) => has(r, ['admin', 'compliance_officer']),
  actAsTrustee: (r?: Role) => has(r, ['trustee']),
  doFieldVisits: (r?: Role) => has(r, ['admin', 'field_agent']),
  recordHarvest: (r?: Role) =>
    has(r, ['admin', 'cycle_manager', 'programme_manager', 'field_agent']),
  readLedger: (r?: Role) => has(r, ['admin', 'auditor', 'compliance_officer', 'trustee']),
};

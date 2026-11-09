/**
 * The demo portfolio: who works on the platform, which cooperatives and farmers are enrolled,
 * and the funding cycles they're in, one at every stage of the lifecycle.
 *
 * Every date is an offset in days from the day the seed runs, so the demo looks current
 * whenever it's seeded. Amounts are in naira here and converted to kobo when posted.
 */
import type { Role } from './api.ts';

export interface StaffSpec {
  key: StaffKey;
  role: Role;
  fullName: string;
  email: string;
}

export type StaffKey =
  | 'admin'
  | 'agentNorth'
  | 'agentBenue'
  | 'compliance'
  | 'manager'
  | 'programmeManager'
  | 'trustee'
  | 'auditor'
  | 'vendor';

export const STAFF: StaffSpec[] = [
  { key: 'admin', role: 'admin', fullName: 'Ngozi Adeyemi', email: 'admin@agrowth.test' },
  {
    key: 'manager',
    role: 'cycle_manager',
    fullName: 'Tolu Akinwale',
    email: 'manager@agrowth.test',
  },
  {
    key: 'agentNorth',
    role: 'field_agent',
    fullName: 'Damola Ogunleye',
    email: 'agent@agrowth.test',
  },
  {
    key: 'agentBenue',
    role: 'field_agent',
    fullName: 'Terver Iorliam',
    email: 'agent.benue@agrowth.test',
  },
  {
    key: 'compliance',
    role: 'compliance_officer',
    fullName: 'Fatima Bello',
    email: 'compliance@agrowth.test',
  },
  {
    key: 'programmeManager',
    role: 'programme_manager',
    fullName: 'Hadiza Abdullahi',
    email: 'programme@agrowth.test',
  },
  { key: 'trustee', role: 'trustee', fullName: 'Kemi Adebayo', email: 'trustee@agrowth.test' },
  { key: 'auditor', role: 'auditor', fullName: 'Ibrahim Musa', email: 'auditor@agrowth.test' },
  // Counter staff at Zaria Agro Inputs, who redeem farmers' input vouchers.
  { key: 'vendor', role: 'vendor', fullName: 'Bala Sule', email: 'vendor@agrowth.test' },
];

export interface VendorSpec {
  name: string;
  kind: 'agro_dealer' | 'service_provider';
  registrationNumber: string;
  phone: string;
  email: string;
  state: string;
  lga: string;
  address: string;
  bank: string;
  account: string;
  /** Who registers it. Compliance approves it unless it's `pending`. */
  registeredBy: StaffKey;
  pending?: boolean;
  /** The vendor whose counter the demo vendor account works at. */
  counter?: boolean;
}

const vendor = (
  name: string,
  registrationNumber: string,
  n: number,
  state: string,
  lga: string,
  address: string,
  bank: string,
  account: string,
  registeredBy: StaffKey,
  extra: Partial<VendorSpec> = {},
): VendorSpec => ({
  name,
  kind: 'agro_dealer',
  registrationNumber,
  phone: `+23480355501${String(n).padStart(2, '0')}`,
  email: `sales@${name.toLowerCase().replace(/[^a-z]+/g, '')}.example`,
  state,
  lga,
  address,
  bank,
  account,
  registeredBy,
  ...extra,
});

/** Government Edition programmes. Dates are days from the day the seed runs. */
export interface ProgrammeSpec {
  key: string;
  code: string;
  name: string;
  sponsor: string;
  description: string;
  kind: 'input_loan' | 'grant';
  budget: number;
  commodities: string[];
  states: string[];
  lgas: string[];
  maxHectares: number | null;
  inputPackage: string;
  packagePerHa: number;
  repaymentPct: number;
  starts: number;
  ends: number;
}

export const PROGRAMMES: ProgrammeSpec[] = [
  {
    key: 'kano-wheat',
    code: 'KN-WHEAT-ICP',
    name: 'Kano Dry-Season Wheat Input Credit',
    sponsor: 'Kano State Ministry of Agriculture (sample programme)',
    description:
      'Input credit for irrigated dry-season wheat. Farmers repay the inputs in grain through the contracted mill; any surplus is theirs.',
    kind: 'input_loan',
    budget: 60_000_000,
    commodities: ['wheat'],
    states: ['Kano'],
    lgas: ['Kura', 'Garun Mallam', 'Bunkure'],
    maxHectares: 5,
    inputPackage:
      'Per hectare: 120 kg heat-tolerant seed, 4 bags NPK 20-10-10, 2 bags urea, herbicide, ploughing and irrigation pumping.',
    packagePerHa: 1_100_000,
    repaymentPct: 100,
    starts: -400,
    ends: 400,
  },
];

/**
 * Investor accounts in the Investor Edition portal. A cycle funder whose name matches one of
 * these invests through the portal (KYC, pledge, trustee-confirmed payment) instead of being
 * keyed in by the trustee, so their statement and payouts trace back to them.
 */
export interface InvestorSpec {
  fullName: string;
  email: string;
  declared: 'retail' | 'high_net_worth' | 'institutional';
  income: number;
  /** Crowdfunding elsewhere in the last 12 months. */
  elsewhere: number;
  bank: string;
  account: string;
  /** False leaves the KYC in compliance's review queue. */
  verified: boolean;
  /** A pledge made when the seed finishes, still in cooling-off: cycle key and amount. */
  pendingPledge?: { cycle: string; amount: number };
  /** A pledge whose cooling-off is already over: waiting to be paid (online, on the demo). */
  readyPledge?: { cycle: string; amount: number };
}

export const INVESTORS: InvestorSpec[] = [
  {
    fullName: 'Adaeze Okoro',
    email: 'investor@agrowth.test',
    declared: 'high_net_worth',
    income: 180_000_000,
    elsewhere: 4_000_000,
    bank: 'Access Bank',
    account: '0691234570',
    verified: true,
    readyPledge: { cycle: 'soy-open', amount: 500_000 },
  },
  {
    fullName: 'Funmilayo Adeleke',
    email: 'investor.retail@agrowth.test',
    declared: 'retail',
    income: 18_000_000,
    elsewhere: 300_000,
    bank: 'GTBank',
    account: '0123456781',
    verified: true,
    pendingPledge: { cycle: 'soy-open', amount: 750_000 },
  },
  {
    fullName: 'Emeka Obi',
    email: 'investor.new@agrowth.test',
    declared: 'high_net_worth',
    income: 95_000_000,
    elsewhere: 0,
    bank: 'Zenith Bank',
    account: '2081234567',
    verified: false,
  },
];

/** Agro-dealers where farmers redeem input vouchers. */
export const VENDORS: VendorSpec[] = [
  vendor(
    'Zaria Agro Inputs Ltd',
    'RC-1458823',
    1,
    'Kaduna',
    'Zaria',
    '14 Sokoto Road, Zaria',
    'Access Bank',
    '0123456789',
    'agentNorth',
    { counter: true },
  ),
  vendor(
    'Samaru Farm Supplies',
    'RC-2290417',
    2,
    'Kaduna',
    'Zaria',
    'Samaru Market, Zaria',
    'GTBank',
    '0234567812',
    'agentNorth',
  ),
  vendor(
    'Kura Agro Centre',
    'RC-1873360',
    3,
    'Kano',
    'Kura',
    'Kura Motor Park Road',
    'Jaiz Bank',
    '0012398765',
    'manager',
  ),
  vendor(
    'Benue Agro Dealers Ltd',
    'RC-1655092',
    4,
    'Benue',
    'Makurdi',
    '22 Old Otukpo Road, Makurdi',
    'Fidelity Bank',
    '5012398760',
    'agentBenue',
  ),
  vendor(
    'Ikara Farm Centre',
    'RC-3012784',
    5,
    'Kaduna',
    'Ikara',
    'Ikara Central Market',
    'First Bank',
    '3023498761',
    'agentNorth',
    { pending: true },
  ),
];

export type CoopKey = 'zaria' | 'kura' | 'makurdi' | 'ikara';

export interface CoopSpec {
  key: CoopKey;
  name: string;
  registrationNumber: string;
  phone: string;
  state: string;
  stateCode: string;
  lga: string;
  wards: string[];
  agent: StaffKey;
  /** South-west corner of the farm cluster. Farms are laid out in a grid from here. */
  origin: [lon: number, lat: number];
  /** Farmers in enrolment order: first name, last name, gender. */
  farmers: [string, string, 'female' | 'male'][];
}

export const COOPERATIVES: CoopSpec[] = [
  {
    key: 'zaria',
    name: 'Zaria Maize Growers Cooperative',
    registrationNumber: 'KD/COOP/2019/0087',
    phone: '+2348031234567',
    state: 'Kaduna',
    stateCode: 'KD',
    lga: 'Zaria',
    wards: ['Dutsen Abba', 'Kufena', 'Tudun Wada'],
    agent: 'agentNorth',
    origin: [7.605, 11.075],
    farmers: [
      ['Amina', 'Ibrahim', 'female'],
      ['Musa', 'Bello', 'male'],
      ['Hauwa', 'Sani', 'female'],
      ['Abdullahi', 'Yusuf', 'male'],
      ['Zainab', 'Lawal', 'female'],
      ['Sani', 'Abubakar', 'male'],
      ['Halima', 'Danjuma', 'female'],
      ['Usman', 'Garba', 'male'],
      ['Rabi', 'Suleiman', 'female'],
      ['Yakubu', 'Aliyu', 'male'],
      ['Safiya', 'Umar', 'female'],
    ],
  },
  {
    key: 'kura',
    name: 'Kura Rice and Wheat Farmers Union',
    registrationNumber: 'KN/COOP/2017/0118',
    phone: '+2348062345678',
    state: 'Kano',
    stateCode: 'KN',
    lga: 'Kura',
    wards: ['Kosawa', 'Dalili', 'Karfi'],
    agent: 'agentNorth',
    origin: [8.435, 11.76],
    farmers: [
      ['Garba', 'Muhammad', 'male'],
      ['Aisha', 'Shehu', 'female'],
      ['Bashir', 'Idris', 'male'],
      ['Maryam', 'Adamu', 'female'],
      ['Kabiru', 'Haruna', 'male'],
      ['Fatima', 'Nuhu', 'female'],
      ['Ahmed', 'Sule', 'male'],
      ['Hadiza', 'Isa', 'female'],
      ['Nasiru', 'Tanko', 'male'],
      ['Bilkisu', 'Ladan', 'female'],
    ],
  },
  {
    key: 'makurdi',
    name: 'Makurdi Soybean Producers Cooperative',
    registrationNumber: 'BN/COOP/2020/0307',
    phone: '+2348073456789',
    state: 'Benue',
    stateCode: 'BN',
    lga: 'Makurdi',
    wards: ['North Bank I', 'Agan', 'Fiidi'],
    agent: 'agentBenue',
    origin: [8.61, 7.78],
    farmers: [
      ['Terhemba', 'Akaa', 'male'],
      ['Mnena', 'Iorfa', 'female'],
      ['Aondona', 'Tyav', 'male'],
      ['Doosuur', 'Iyorchia', 'female'],
      ['Sesugh', 'Ager', 'male'],
      ['Member', 'Orduen', 'female'],
      ['Terkula', 'Ikyaa', 'male'],
      ['Nguavese', 'Gbaden', 'female'],
      ['Torkuma', 'Agber', 'male'],
      ['Mwuese', 'Anyam', 'female'],
      ['Iveren', 'Shimawua', 'female'],
      ['Msughter', 'Utim', 'male'],
      ['Ngodoo', 'Kwaghga', 'female'],
      ['Fanen', 'Ityo', 'male'],
    ],
  },
  {
    key: 'ikara',
    name: 'Ikara Sorghum Growers Association',
    registrationNumber: 'KD/COOP/2021/0215',
    phone: '+2348084567890',
    state: 'Kaduna',
    stateCode: 'KD',
    lga: 'Ikara',
    wards: ['Furana', 'Saya Saya', 'Paki'],
    agent: 'agentNorth',
    origin: [8.25, 11.2],
    farmers: [
      ['Danladi', 'Audu', 'male'],
      ['Jummai', 'Bala', 'female'],
      ['Shuaibu', 'Mohammed', 'male'],
      ['Asabe', 'Yahaya', 'female'],
      ['Ishaku', 'Dogo', 'male'],
      ['Saratu', 'Abdu', 'female'],
      ['Haruna', 'Maikano', 'male'],
      ['Lami', 'Joseph', 'female'],
    ],
  },
];

export type Stage =
  | 'draft'
  | 'pending_approval'
  | 'open_for_funding'
  | 'funded'
  | 'in_progress'
  | 'harvested'
  | 'settled';

export interface Payee {
  kind: 'input_vendor' | 'service_provider' | 'farmer_cash';
  name: string;
  account: string;
  purpose: string;
  /** Share of the milestone. Cash to farmers must stay at or under 20%. */
  share: number;
}

export interface MilestoneSpec {
  name: string;
  description: string;
  share: number;
  /** Planned date, days from today. */
  day: number;
  payees: Payee[];
  visitNotes: string;
}

export interface CycleSpec {
  key: string;
  stage: Stage;
  coop: CoopKey;
  /** How many of the cooperative's farmers (taken in order) are in this cycle. */
  farmers: number;
  crop: string;
  cropCode: string;
  fundingSource: 'investor' | 'programme' | 'blended';
  budgetPerHa: number;
  yields: [low: number, expected: number, high: number];
  prices: [low: number, expected: number, high: number];
  feePct: number;
  funderSharePct: number;
  /** Days from today. */
  deadline: number;
  start: number;
  harvest: number;
  description: string;
  buyer: { name: string; contact: string };
  insurer: { name: string; prefix: string; cover: 'area_yield' | 'weather_index' | 'multi_peril' };
  milestones: MilestoneSpec[];
  /** Funder name, share of the target, day received. */
  funders: [string, number, number][];
  funderKind?: 'investor' | 'programme';
  /** For harvested and settled cycles. */
  /** The programme (by key) the cycle belongs to. */
  programme?: string;
  /** Last season's cycle on the same farms as this one (by key), instead of new farmers. */
  sameFarmsAs?: string;
  harvestResult?: {
    /** A farm (by position) that delivered only this share of the yield. */
    shortfall?: { position: number; share: number };
    yieldPerHa: number;
    pricePerTonne: number;
    deliveryDays: [first: number, last: number];
    receiptDay: number;
    /** An insurance claim that tops the cycle's cash up to this multiple of its capital. */
    insuranceTopUpTo?: number;
    insuranceDay?: number;
    rejectedLoad?: boolean;
    voidedLoad?: boolean;
  };
  /** Return the first submission with this note before approving. */
  returnedWith?: string;
  /** Pay the first milestone's input line as farmers' input vouchers instead of to a vendor. */
  voucherInputs?: boolean;
  /** For draft cycles: what's still missing. */
  withoutInsurance?: boolean;
  /** Farmers (by position in the cycle) whose KYC is still pending. */
  pendingKyc?: number[];
}

// Payees ------------------------------------------------------------------------------------

const cash = (purpose: string, share = 0.1): Payee => ({
  kind: 'farmer_cash',
  name: 'Cooperative labour fund',
  account: 'Zenith Bank 1023456789',
  purpose,
  share,
});

const maizeMilestones = (days: [number, number, number]): MilestoneSpec[] => [
  {
    name: 'Land preparation and planting',
    description: 'Ploughing, harrowing, certified seed and basal NPK.',
    share: 0.4,
    day: days[0],
    visitNotes: 'Land ploughed and harrowed; seed and NPK delivered to the farm.',
    payees: [
      {
        kind: 'input_vendor',
        name: 'Zaria Agro Inputs Ltd',
        account: 'Access Bank 0123456789',
        purpose: 'Certified seed and NPK 15:15:15',
        share: 0.65,
      },
      {
        kind: 'service_provider',
        name: 'Samaru Tractor Hire',
        account: 'GTBank 0234567891',
        purpose: 'Ploughing and harrowing',
        share: 0.25,
      },
      cash('Planting labour allowance'),
    ],
  },
  {
    name: 'Mid-season inputs',
    description: 'Urea top-dressing, herbicide and crop protection.',
    share: 0.35,
    day: days[1],
    visitNotes: 'Crop at knee height, even stand; urea and herbicide on site.',
    payees: [
      {
        kind: 'input_vendor',
        name: 'Zaria Agro Inputs Ltd',
        account: 'Access Bank 0123456789',
        purpose: 'Urea and herbicide',
        share: 0.8,
      },
      {
        kind: 'service_provider',
        name: 'Kufena Spray Services',
        account: 'First Bank 3012345678',
        purpose: 'Herbicide application',
        share: 0.1,
      },
      cash('Weeding labour allowance'),
    ],
  },
  {
    name: 'Harvest and logistics',
    description: 'Harvest labour, shelling, bags and haulage to the buyer.',
    share: 0.25,
    day: days[2],
    visitNotes: 'Cobs dry and ready; bags and sheller booked.',
    payees: [
      {
        kind: 'service_provider',
        name: 'Arewa Haulage Services',
        account: 'UBA 2045678901',
        purpose: 'Haulage to the buyer',
        share: 0.45,
      },
      {
        kind: 'input_vendor',
        name: 'Zaria Agro Inputs Ltd',
        account: 'Access Bank 0123456789',
        purpose: 'Bags and shelling',
        share: 0.35,
      },
      cash('Harvest labour allowance', 0.2),
    ],
  },
];

const soyMilestones = (days: [number, number, number]): MilestoneSpec[] => [
  {
    name: 'Land preparation and planting',
    description: 'Ridging, inoculated seed and single super phosphate.',
    share: 0.45,
    day: days[0],
    visitNotes: 'Ridges made; inoculated seed and SSP delivered.',
    payees: [
      {
        kind: 'input_vendor',
        name: 'Benue Agro Dealers Ltd',
        account: 'Access Bank 0456789012',
        purpose: 'Inoculated seed and SSP',
        share: 0.6,
      },
      {
        kind: 'service_provider',
        name: 'Makurdi Mechanisation Co.',
        account: 'Fidelity Bank 5012345678',
        purpose: 'Ploughing and ridging',
        share: 0.3,
      },
      cash('Planting labour allowance'),
    ],
  },
  {
    name: 'Crop protection',
    description: 'Herbicide, insecticide and weeding.',
    share: 0.3,
    day: days[1],
    visitNotes: 'Canopy closing; weeds under control.',
    payees: [
      {
        kind: 'input_vendor',
        name: 'Benue Agro Dealers Ltd',
        account: 'Access Bank 0456789012',
        purpose: 'Herbicide and insecticide',
        share: 0.85,
      },
      cash('Weeding labour allowance', 0.15),
    ],
  },
  {
    name: 'Harvest and logistics',
    description: 'Harvest labour, threshing and haulage to the processor.',
    share: 0.25,
    day: days[2],
    visitNotes: 'Pods mature and drying; thresher booked.',
    payees: [
      {
        kind: 'service_provider',
        name: 'Makurdi Mechanisation Co.',
        account: 'Fidelity Bank 5012345678',
        purpose: 'Threshing',
        share: 0.4,
      },
      {
        kind: 'service_provider',
        name: 'Benue Valley Logistics',
        account: 'UBA 2056789012',
        purpose: 'Haulage to the processor',
        share: 0.4,
      },
      cash('Harvest labour allowance', 0.2),
    ],
  },
];

const riceMilestones = (days: [number, number, number]): MilestoneSpec[] => [
  {
    name: 'Nursery and transplanting',
    description: 'Puddling, certified FARO-44 seed, NPK and transplanting.',
    share: 0.4,
    day: days[0],
    visitNotes: 'Basins puddled and flooded; seedlings transplanted in rows.',
    payees: [
      {
        kind: 'input_vendor',
        name: 'Kano Seed and Fertiliser Ltd',
        account: 'Access Bank 0678901234',
        purpose: 'FARO-44 seed and NPK',
        share: 0.6,
      },
      {
        kind: 'service_provider',
        name: 'Kura Irrigation Services',
        account: 'Jaiz Bank 0012345678',
        purpose: 'Puddling and water fees',
        share: 0.3,
      },
      cash('Transplanting labour allowance'),
    ],
  },
  {
    name: 'Top-dressing and water',
    description: 'Urea top-dressing, herbicide and irrigation water.',
    share: 0.35,
    day: days[1],
    visitNotes: 'Tillering well; water levels maintained.',
    payees: [
      {
        kind: 'input_vendor',
        name: 'Kano Seed and Fertiliser Ltd',
        account: 'Access Bank 0678901234',
        purpose: 'Urea and herbicide',
        share: 0.6,
      },
      {
        kind: 'service_provider',
        name: 'Kura Irrigation Services',
        account: 'Jaiz Bank 0012345678',
        purpose: 'Irrigation water',
        share: 0.3,
      },
      cash('Bird scaring and weeding', 0.1),
    ],
  },
  {
    name: 'Harvest and haulage',
    description: 'Harvesting, threshing, bags and haulage to the mill.',
    share: 0.25,
    day: days[2],
    visitNotes: 'Panicles golden; harvest crew and thresher booked.',
    payees: [
      {
        kind: 'service_provider',
        name: 'Kura Threshing Services',
        account: 'Sterling Bank 0712345678',
        purpose: 'Threshing',
        share: 0.4,
      },
      {
        kind: 'service_provider',
        name: 'Arewa Haulage Services',
        account: 'UBA 2045678901',
        purpose: 'Haulage to the mill',
        share: 0.4,
      },
      cash('Harvest labour allowance', 0.2),
    ],
  },
];

const wheatMilestones = (days: [number, number, number]): MilestoneSpec[] => [
  {
    name: 'Land preparation and sowing',
    description: 'Ploughing, heat-tolerant seed and basal fertiliser.',
    share: 0.45,
    day: days[0],
    visitNotes: 'Land ploughed and levelled; seed and fertiliser on site.',
    payees: [
      {
        kind: 'input_vendor',
        name: 'Kano Seed and Fertiliser Ltd',
        account: 'Access Bank 0678901234',
        purpose: 'Heat-tolerant seed and NPK',
        share: 0.6,
      },
      {
        kind: 'service_provider',
        name: 'Kura Irrigation Services',
        account: 'Jaiz Bank 0012345678',
        purpose: 'Ploughing and levelling',
        share: 0.3,
      },
      cash('Sowing labour allowance'),
    ],
  },
  {
    name: 'Irrigation and top-dressing',
    description: 'Irrigation water, urea and weed control.',
    share: 0.3,
    day: days[1],
    visitNotes: 'Even emergence; irrigation schedule on track.',
    payees: [
      {
        kind: 'service_provider',
        name: 'Kura Irrigation Services',
        account: 'Jaiz Bank 0012345678',
        purpose: 'Irrigation water',
        share: 0.5,
      },
      {
        kind: 'input_vendor',
        name: 'Kano Seed and Fertiliser Ltd',
        account: 'Access Bank 0678901234',
        purpose: 'Urea and herbicide',
        share: 0.4,
      },
      cash('Weeding labour allowance'),
    ],
  },
  {
    name: 'Harvest and haulage',
    description: 'Combine hire, bags and haulage to the mill.',
    share: 0.25,
    day: days[2],
    visitNotes: 'Grain hard and dry; combine booked.',
    payees: [
      {
        kind: 'service_provider',
        name: 'Kura Threshing Services',
        account: 'Sterling Bank 0712345678',
        purpose: 'Combine harvesting',
        share: 0.5,
      },
      {
        kind: 'service_provider',
        name: 'Arewa Haulage Services',
        account: 'UBA 2045678901',
        purpose: 'Haulage to the mill',
        share: 0.35,
      },
      cash('Harvest labour allowance', 0.15),
    ],
  },
];

const sorghumMilestones = (days: [number, number, number]): MilestoneSpec[] => [
  {
    name: 'Land preparation and planting',
    description: 'Ploughing, improved seed and NPK.',
    share: 0.4,
    day: days[0],
    visitNotes: 'Land ploughed; seed and NPK delivered.',
    payees: [
      {
        kind: 'input_vendor',
        name: 'Ikara Farm Centre',
        account: 'Access Bank 0789012345',
        purpose: 'Improved seed and NPK',
        share: 0.6,
      },
      {
        kind: 'service_provider',
        name: 'Samaru Tractor Hire',
        account: 'GTBank 0234567891',
        purpose: 'Ploughing',
        share: 0.3,
      },
      cash('Planting labour allowance'),
    ],
  },
  {
    name: 'Mid-season inputs',
    description: 'Urea, herbicide and bird control.',
    share: 0.35,
    day: days[1],
    visitNotes: 'Good stand; urea applied.',
    payees: [
      {
        kind: 'input_vendor',
        name: 'Ikara Farm Centre',
        account: 'Access Bank 0789012345',
        purpose: 'Urea and herbicide',
        share: 0.85,
      },
      cash('Weeding labour allowance', 0.15),
    ],
  },
  {
    name: 'Harvest and logistics',
    description: 'Harvest labour, threshing and haulage to the buyer.',
    share: 0.25,
    day: days[2],
    visitNotes: 'Heads mature; threshing booked.',
    payees: [
      {
        kind: 'service_provider',
        name: 'Arewa Haulage Services',
        account: 'UBA 2045678901',
        purpose: 'Haulage to the buyer',
        share: 0.5,
      },
      {
        kind: 'service_provider',
        name: 'Ikara Threshing Co-op',
        account: 'First Bank 3023456789',
        purpose: 'Threshing',
        share: 0.3,
      },
      cash('Harvest labour allowance', 0.2),
    ],
  },
];

const BUYERS = {
  maize: { name: 'Northern Mills Ltd', contact: 'procurement@northernmills.example' },
  soy: { name: 'Benue Oilseed Processors Ltd', contact: 'sourcing@benueoilseed.example' },
  rice: { name: 'Kura Rice Mills Ltd', contact: 'paddy@kuraricemills.example' },
  wheat: { name: 'Arewa Flour Mills Ltd', contact: 'grain@arewaflour.example' },
  sorghum: { name: 'Savanna Maltings Ltd', contact: 'buying@savannamaltings.example' },
};

const SHIELD = { name: 'Harvest Shield Insurance', prefix: 'HSI', cover: 'area_yield' as const };
const SAVANNA = {
  name: 'Savanna Mutual Assurance',
  prefix: 'SMA',
  cover: 'weather_index' as const,
};

// Cycles, one per stage ------------------------------------------------------------------------

export const CYCLES: CycleSpec[] = [
  {
    key: 'maize-settled',
    stage: 'settled',
    coop: 'zaria',
    farmers: 6,
    crop: 'maize',
    cropCode: 'MAIZE',
    fundingSource: 'investor',
    budgetPerHa: 950_000,
    yields: [2, 3, 4],
    prices: [380_000, 450_000, 520_000],
    feePct: 2,
    funderSharePct: 30,
    deadline: -196,
    start: -186,
    harvest: -44,
    description:
      'Rain-fed white maize on six family farms in Zaria, sold forward to Northern Mills at a floor price.',
    buyer: BUYERS.maize,
    insurer: SHIELD,
    milestones: maizeMilestones([-182, -130, -50]),
    funders: [
      ['Kestrel Agri Fund I', 0.35, -230],
      ['Adaeze Okoro', 0.3, -224],
      ['Chidi Nwosu', 0.2, -215],
      ['Bola Hassan', 0.15, -201],
    ],
    harvestResult: {
      yieldPerHa: 3.2,
      pricePerTonne: 470_000,
      deliveryDays: [-40, -31],
      receiptDay: -18,
    },
    returnedWith: "Please attach the cooperative chairman's signed consent before approval.",
  },
  {
    key: 'soy-settled-insured',
    stage: 'settled',
    coop: 'makurdi',
    farmers: 5,
    crop: 'soybean',
    cropCode: 'SOY',
    fundingSource: 'investor',
    budgetPerHa: 700_000,
    yields: [1.2, 1.8, 2.4],
    prices: [650_000, 750_000, 850_000],
    feePct: 1.5,
    funderSharePct: 30,
    deadline: -180,
    start: -170,
    harvest: -52,
    description:
      'Soybean for Benue Oilseed Processors. A six-week August dry spell cut yields by two thirds; the area-yield policy paid out and funders got their capital back.',
    buyer: BUYERS.soy,
    insurer: SHIELD,
    milestones: soyMilestones([-166, -112, -58]),
    funders: [
      ['Northstar Farmland Partners', 0.45, -214],
      ['Ifeoma Eze', 0.4, -205],
      ['Segun Bakare', 0.15, -188],
    ],
    harvestResult: {
      yieldPerHa: 0.5,
      pricePerTonne: 780_000,
      deliveryDays: [-46, -41],
      receiptDay: -26,
      insuranceTopUpTo: 1.03,
      insuranceDay: -11,
    },
  },
  {
    key: 'rice-harvested',
    stage: 'harvested',
    coop: 'kura',
    farmers: 6,
    crop: 'rice',
    cropCode: 'RICE',
    fundingSource: 'investor',
    budgetPerHa: 1_200_000,
    yields: [3.5, 4.5, 5.5],
    prices: [450_000, 520_000, 600_000],
    feePct: 2,
    funderSharePct: 20,
    deadline: -176,
    start: -158,
    harvest: -18,
    description:
      'Irrigated FARO-44 paddy on the Kano River scheme, sold to Kura Rice Mills. Harvest is in and paid for; settlement is next.',
    buyer: BUYERS.rice,
    insurer: SAVANNA,
    milestones: riceMilestones([-152, -95, -24]),
    funders: [
      ['Riverbend Agri Fund I', 0.5, -205],
      ['Ngozi Nnaji', 0.25, -196],
      // Through the portal: her payout has a bank account on file, to pay through Paystack.
      ['Adaeze Okoro', 0.25, -181],
    ],
    harvestResult: {
      yieldPerHa: 4.7,
      pricePerTonne: 520_000,
      deliveryDays: [-15, -5],
      receiptDay: -2,
      rejectedLoad: true,
      voidedLoad: true,
    },
  },
  {
    key: 'maize-in-progress',
    stage: 'in_progress',
    coop: 'zaria',
    farmers: 5,
    crop: 'maize',
    cropCode: 'MAIZE',
    fundingSource: 'investor',
    budgetPerHa: 1_100_000,
    yields: [3, 4, 5],
    prices: [400_000, 460_000, 530_000],
    feePct: 2,
    funderSharePct: 30,
    deadline: -18,
    start: -10,
    harvest: 112,
    description:
      'Irrigated dry-season maize. Planting funds were released after every farm passed its visit; the mid-season release is on hold until one farm is properly re-visited.',
    buyer: BUYERS.maize,
    insurer: SAVANNA,
    milestones: maizeMilestones([-8, 4, 100]),
    voucherInputs: true,
    funders: [
      ['Kestrel Agri Fund I', 0.5, -41],
      ['Adaeze Okoro', 0.25, -33],
      ['Tunde Lawal', 0.25, -20],
    ],
  },
  {
    key: 'wheat-programme-settled',
    stage: 'settled',
    coop: 'kura',
    farmers: 0,
    sameFarmsAs: 'wheat-programme-funded',
    programme: 'kano-wheat',
    crop: 'wheat',
    cropCode: 'WHEAT',
    fundingSource: 'programme',
    funderKind: 'programme',
    budgetPerHa: 1_100_000,
    yields: [2.5, 3.5, 4.5],
    prices: [520_000, 620_000, 720_000],
    feePct: 1,
    funderSharePct: 0,
    deadline: -366,
    start: -356,
    harvest: -231,
    description:
      'Last dry season, the same four farms under the state wheat programme. Three farms beat the estimate; one lost much of its crop to a failed pump and is being followed up.',
    buyer: BUYERS.wheat,
    insurer: SHIELD,
    milestones: wheatMilestones([-363, -310, -240]),
    funders: [
      ['Kano Dry-Season Wheat Input Credit', 0.8, -380],
      ['Kura LGA Counterpart Fund', 0.2, -370],
    ],
    harvestResult: {
      yieldPerHa: 3.6,
      pricePerTonne: 640_000,
      deliveryDays: [-228, -220],
      receiptDay: -205,
      shortfall: { position: 2, share: 0.35 },
    },
  },
  {
    key: 'wheat-programme-funded',
    programme: 'kano-wheat',
    stage: 'funded',
    coop: 'kura',
    farmers: 4,
    crop: 'wheat',
    cropCode: 'WHEAT',
    fundingSource: 'programme',
    funderKind: 'programme',
    budgetPerHa: 1_100_000,
    yields: [2.5, 3.5, 4.5],
    prices: [550_000, 650_000, 750_000],
    feePct: 1,
    funderSharePct: 0,
    deadline: -4,
    start: 9,
    harvest: 134,
    description:
      'Input credit for dry-season wheat under a state programme. The programme recovers its capital; every naira of profit goes to the farmers.',
    buyer: BUYERS.wheat,
    insurer: SHIELD,
    milestones: wheatMilestones([2, 55, 125]),
    funders: [
      ['Kano Dry-Season Wheat Input Credit', 0.8, -21],
      ['Kura LGA Counterpart Fund', 0.2, -6],
    ],
  },
  {
    key: 'soy-open',
    stage: 'open_for_funding',
    coop: 'makurdi',
    farmers: 5,
    crop: 'soybean',
    cropCode: 'SOY',
    fundingSource: 'investor',
    budgetPerHa: 750_000,
    yields: [1.2, 1.8, 2.4],
    prices: [680_000, 780_000, 880_000],
    feePct: 1.5,
    funderSharePct: 30,
    deadline: 45,
    start: 165,
    harvest: 330,
    description:
      'Next season’s soybean for Benue Oilseed Processors, raising early so inputs can be bought before prices rise.',
    buyer: BUYERS.soy,
    insurer: SHIELD,
    milestones: soyMilestones([168, 225, 320]),
    funders: [
      ['Northstar Farmland Partners', 0.35, -9],
      ['Ifeoma Eze', 0.2, -2],
    ],
  },
  {
    key: 'sorghum-pending',
    stage: 'pending_approval',
    coop: 'ikara',
    farmers: 5,
    crop: 'sorghum',
    cropCode: 'SORGHUM',
    fundingSource: 'blended',
    budgetPerHa: 550_000,
    yields: [1.5, 2.2, 3],
    prices: [380_000, 430_000, 500_000],
    feePct: 2,
    funderSharePct: 25,
    deadline: 75,
    start: 195,
    harvest: 350,
    description:
      'Malting sorghum for Savanna Maltings, blending a programme first-loss tranche with investor capital.',
    buyer: BUYERS.sorghum,
    insurer: SAVANNA,
    milestones: sorghumMilestones([198, 250, 345]),
    funders: [],
  },
  {
    key: 'soy-draft',
    stage: 'draft',
    coop: 'makurdi',
    farmers: 4,
    crop: 'soybean',
    cropCode: 'SOY',
    fundingSource: 'investor',
    budgetPerHa: 750_000,
    yields: [1.2, 1.8, 2.4],
    prices: [680_000, 780_000, 880_000],
    feePct: 1.5,
    funderSharePct: 30,
    deadline: 100,
    start: 170,
    harvest: 335,
    description: 'Outgrower expansion: four new farmers joining the Makurdi cooperative.',
    buyer: BUYERS.soy,
    insurer: SHIELD,
    milestones: soyMilestones([172, 230, 325]),
    funders: [],
    withoutInsurance: true,
    pendingKyc: [2],
  },
];

/**
 * Farmers enrolled and mapped but not in any cycle yet: the last ones of the Ikara list.
 * The first of these is rejected at KYC, the rest are still pending.
 */
export const UNASSIGNED_REJECTED = 1;

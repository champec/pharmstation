export interface LogColumn {
  label: string
  width: string
}

export interface LogDefinition {
  slug: string
  title: string
  category: string
  description: string
  instructions: string
  columns: LogColumn[]
  rows: number
  headerFields: string[]
}

export const logDefinitions: LogDefinition[] = [
  {
    slug: 'near-miss-log',
    title: 'Near-miss log',
    category: 'Patient safety',
    description: 'Record dispensing near misses, contributing factors and preventative actions.',
    instructions: 'Record events promptly. Do not include patient-identifiable information. Review themes regularly with the pharmacy team.',
    headerFields: ['Pharmacy name', 'Month / year', 'Reviewed by', 'Review date'],
    rows: 12,
    columns: [
      { label: 'Date / time', width: '0.8fr' },
      { label: 'Medicine / process', width: '1.3fr' },
      { label: 'What happened', width: '1.7fr' },
      { label: 'Contributing factors', width: '1.5fr' },
      { label: 'Action taken', width: '1.5fr' },
      { label: 'Initials', width: '0.6fr' },
    ],
  },
  {
    slug: 'visitor-log',
    title: 'Visitor log',
    category: 'Premises',
    description: 'Record contractors and visitors entering non-public areas of the pharmacy.',
    instructions: 'Visitors should sign in on arrival, wear identification where required, and sign out before leaving.',
    headerFields: ['Pharmacy name', 'Site address', 'Responsible person', 'Week commencing'],
    rows: 18,
    columns: [
      { label: 'Date', width: '0.7fr' },
      { label: 'Visitor name', width: '1.4fr' },
      { label: 'Company', width: '1.2fr' },
      { label: 'Purpose of visit', width: '1.8fr' },
      { label: 'Time in', width: '0.7fr' },
      { label: 'Time out', width: '0.7fr' },
      { label: 'Staff initials', width: '0.7fr' },
    ],
  },
  {
    slug: 'fridge-temperature-log',
    title: 'Fridge temperature log',
    category: 'Medicines storage',
    description: 'Daily minimum, maximum and current temperature checks with excursion actions.',
    instructions: 'Check on every working day. Reset the min/max thermometer after recording. Investigate readings outside 2–8°C immediately.',
    headerFields: ['Pharmacy name', 'Fridge ID / location', 'Month / year', 'Target range: 2–8°C'],
    rows: 31,
    columns: [
      { label: 'Day', width: '0.45fr' },
      { label: 'Current °C', width: '0.8fr' },
      { label: 'Minimum °C', width: '0.8fr' },
      { label: 'Maximum °C', width: '0.8fr' },
      { label: 'Reset ✓', width: '0.6fr' },
      { label: 'Initials', width: '0.65fr' },
      { label: 'Excursion / action taken', width: '2.4fr' },
    ],
  },
  {
    slug: 'cleaning-log',
    title: 'Pharmacy cleaning log',
    category: 'Premises',
    description: 'Routine cleaning checks for dispensary, consultation and staff areas.',
    instructions: 'Complete after each scheduled clean. Record any defects, spillages or follow-up work in the notes column.',
    headerFields: ['Pharmacy name', 'Week commencing', 'Cleaning schedule version', 'Manager'],
    rows: 16,
    columns: [
      { label: 'Date / time', width: '0.8fr' },
      { label: 'Area', width: '1.2fr' },
      { label: 'Task completed', width: '2fr' },
      { label: 'Product used', width: '1.2fr' },
      { label: 'Notes / defects', width: '1.6fr' },
      { label: 'Initials', width: '0.6fr' },
    ],
  },
  {
    slug: 'staff-training-log',
    title: 'Staff training log',
    category: 'Team',
    description: 'Track briefings, training completion, competency checks and renewal dates.',
    instructions: 'Keep supporting certificates or competency records in the appropriate staff file.',
    headerFields: ['Pharmacy name', 'Staff member / team', 'Role', 'Review period'],
    rows: 14,
    columns: [
      { label: 'Date', width: '0.7fr' },
      { label: 'Training / briefing', width: '2fr' },
      { label: 'Provider / method', width: '1.3fr' },
      { label: 'Outcome / competency', width: '1.6fr' },
      { label: 'Renewal due', width: '0.9fr' },
      { label: 'Staff initials', width: '0.7fr' },
      { label: 'Manager initials', width: '0.8fr' },
    ],
  },
]
export interface ResourceCategory {
  id: 'service-forms' | 'patient-leaflets' | 'printable-logs' | 'operational-tools'
  title: string
  description: string
  status: string
}

export interface PrintableForm {
  slug: string
  title: string
  service: string
  description: string
}

export const resourceCategories: ResourceCategory[] = [
  {
    id: 'service-forms',
    title: 'Service forms',
    description: 'Printable contingency forms for Pharmacy First and other NHS pharmacy services.',
    status: '10 forms available',
  },
  {
    id: 'patient-leaflets',
    title: 'Patient information leaflets',
    description: 'Find concise, print-friendly medicine leaflets from the electronic medicines compendium.',
    status: '9,000+ medicines',
  },
  {
    id: 'printable-logs',
    title: 'Printable logs',
    description: 'Near miss, visitor, fridge temperature and other practical pharmacy logs.',
    status: '5 logs available',
  },
  {
    id: 'operational-tools',
    title: 'Operational tools',
    description: 'Useful contacts, temporary closure notices and customizable sildenafil consultation cards.',
    status: '3 tools available',
  },
]

export const printableForms: PrintableForm[] = [
  {
    slug: 'pharmacy-first-blank',
    title: 'Pharmacy First blank consultation form',
    service: 'Pharmacy First',
    description: 'General contingency form covering emergency supply, minor ailments and clinical pathways.',
  },
  {
    slug: 'acute-otitis-media',
    title: 'Acute otitis media',
    service: 'Pharmacy First',
    description: 'Consultation and clinical pathway record for acute otitis media.',
  },
  {
    slug: 'acute-sinusitis',
    title: 'Acute sinusitis',
    service: 'Pharmacy First',
    description: 'Consultation and clinical pathway record for acute sinusitis.',
  },
  {
    slug: 'acute-sore-throat',
    title: 'Acute sore throat',
    service: 'Pharmacy First',
    description: 'Consultation and clinical pathway record for acute sore throat.',
  },
  {
    slug: 'impetigo',
    title: 'Impetigo',
    service: 'Pharmacy First',
    description: 'Consultation and clinical pathway record for impetigo.',
  },
  {
    slug: 'infected-insect-bites',
    title: 'Infected insect bites',
    service: 'Pharmacy First',
    description: 'Consultation and clinical pathway record for infected insect bites.',
  },
  {
    slug: 'shingles',
    title: 'Shingles',
    service: 'Pharmacy First',
    description: 'Consultation and clinical pathway record for shingles.',
  },
  {
    slug: 'uncomplicated-uti',
    title: 'Uncomplicated UTI',
    service: 'Pharmacy First',
    description: 'Consultation and clinical pathway record for uncomplicated urinary tract infection.',
  },
  {
    slug: 'emergency-supply',
    title: 'Emergency supply record form',
    service: 'Emergency supply',
    description: 'Patient, medicine, declaration and exemption record for an emergency supply.',
  },
  {
    slug: 'hypertension-case-finding',
    title: 'Hypertension case-finding consultation form',
    service: 'Hypertension',
    description: 'Clinic blood pressure, ABPM follow-up, referral outcome and healthy living record.',
  },
]

export const commonPilLeaflets = [
  {
    name: 'Nitrofurantoin MR 100 mg capsules',
    detail: 'Modified-release capsules',
    url: 'https://www.medicines.org.uk/emc/product/15362/xpil/print',
  },
  {
    name: 'Flucloxacillin 500 mg capsules',
    detail: 'Patient information leaflet',
    url: 'https://www.medicines.org.uk/emc/files/pil.12636.pdf',
  },
  {
    name: 'Phenoxymethylpenicillin',
    detail: 'Patient information leaflet',
    url: 'https://www.medicines.org.uk/emc/files/pil.10628.pdf',
  },
  {
    name: 'Amoxicillin',
    detail: 'Patient information leaflet',
    url: 'https://www.medicines.org.uk/emc/files/pil.526.pdf',
  },
  {
    name: 'Colchicine',
    detail: 'Patient information leaflet',
    url: 'https://www.medicines.org.uk/emc/files/pil.6415.pdf',
  },
  {
    name: 'Clarithromycin',
    detail: 'Patient information leaflet',
    url: 'https://www.medicines.org.uk/emc/files/pil.7072.pdf',
  },
]

export function getPrintablePilUrl(emcUrl: string) {
  const productMatch = emcUrl.match(/\/emc\/product\/(\d+)/)
  return productMatch
    ? `https://www.medicines.org.uk/emc/product/${productMatch[1]}/xpil/print`
    : emcUrl
}
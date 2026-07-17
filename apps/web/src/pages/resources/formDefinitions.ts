export interface FormDefinition {
  slug: string
  title: string
  service: string
  kind: 'pharmacy-first' | 'emergency-supply' | 'hypertension'
  assessment?: string[]
  treatments?: string[]
}

export const formDefinitions: FormDefinition[] = [
  {
    slug: 'pharmacy-first-blank',
    title: 'Pharmacy First blank consultation form',
    service: 'Pharmacy First',
    kind: 'pharmacy-first',
    assessment: ['Gateway criteria met', 'Presenting complaint and symptoms', 'Clinical pathway selected', 'Red flags identified'],
    treatments: ['Advice only', 'Clinical pathway supply', 'OTC sale', 'Local commissioned service', 'Onward referral'],
  },
  {
    slug: 'acute-otitis-media',
    title: 'Acute otitis media',
    service: 'Pharmacy First',
    kind: 'pharmacy-first',
    assessment: ['Acute onset with otoscopic findings', 'Systemically unwell, serious illness or high-risk comorbidity', 'Otorrhoea or eardrum perforation', 'Child under 2 with bilateral infection', 'Severe symptoms or symptoms over 3 days', 'Severity: mild / moderate / severe', 'Red flags identified'],
    treatments: ['Phenazone/lidocaine ear drops', 'Amoxicillin', 'Clarithromycin (penicillin allergy)', 'Erythromycin (pregnancy)', 'Pain relief and watchful waiting'],
  },
  {
    slug: 'acute-sinusitis',
    title: 'Acute sinusitis',
    service: 'Pharmacy First',
    kind: 'pharmacy-first',
    assessment: ['Marked deterioration after an initial milder phase', 'Fever above 38°C', 'Unremitting purulent nasal discharge', 'Severe localised unilateral pain, especially dental or jaw', 'Red flags identified'],
    treatments: ['Fluticasone nasal spray', 'Mometasone nasal spray', 'Phenoxymethylpenicillin', 'Clarithromycin', 'Doxycycline', 'Erythromycin (pregnancy)', 'Self-care and pain relief'],
  },
  {
    slug: 'acute-sore-throat',
    title: 'Acute sore throat',
    service: 'Pharmacy First',
    kind: 'pharmacy-first',
    assessment: ['FeverPAIN assessment completed', 'FeverPAIN score', 'Symptom duration recorded', 'Associated symptoms reviewed', 'Red flags identified'],
    treatments: ['Phenoxymethylpenicillin', 'Clarithromycin (penicillin allergy)', 'Erythromycin (pregnancy)', 'Self-care only'],
  },
  {
    slug: 'impetigo',
    title: 'Impetigo',
    service: 'Pharmacy First',
    kind: 'pharmacy-first',
    assessment: ['Localised non-bullous impetigo (fewer than 4 lesions)', 'Widespread non-bullous impetigo (4 or more lesions)', 'Bullous impetigo excluded', 'Red flags identified'],
    treatments: ['Hydrogen peroxide 1% cream', 'Fusidic acid cream', 'Flucloxacillin', 'Clarithromycin (penicillin allergy)', 'Erythromycin (pregnancy)', 'Hygiene and self-care advice'],
  },
  {
    slug: 'infected-insect-bites',
    title: 'Infected insect bites',
    service: 'Pharmacy First',
    kind: 'pharmacy-first',
    assessment: ['Signs of infection present', 'Severity assessed', 'Local wound reviewed', 'Red flags identified'],
    treatments: ['Flucloxacillin', 'Clarithromycin (penicillin allergy)', 'Erythromycin (pregnancy)', 'Local wound care and pain relief'],
  },
  {
    slug: 'shingles',
    title: 'Shingles',
    service: 'Pharmacy First',
    kind: 'pharmacy-first',
    assessment: ['Rash onset within 72 hours', 'Rash onset within 1 week', 'Immunosuppressed', 'Non-truncal involvement', 'Moderate or severe pain or rash', 'Continued vesicle formation', 'Age 50 or over / age 70 or over', 'Red flags identified'],
    treatments: ['Aciclovir', 'Valaciclovir', 'Pain management and wound care'],
  },
  {
    slug: 'uncomplicated-uti',
    title: 'Uncomplicated UTI',
    service: 'Pharmacy First',
    kind: 'pharmacy-first',
    assessment: ['Dysuria', 'New nocturia', 'Cloudy urine', 'Urgency', 'Frequency', 'Visible haematuria', 'Suprapubic pain or tenderness', 'Symptoms mild / moderate / severe', 'Red flags identified'],
    treatments: ['Nitrofurantoin for 3 days', 'Hydration and pain relief', 'Return for reassessment if no improvement within 48 hours'],
  },
  { slug: 'emergency-supply', title: 'Emergency supply record form', service: 'Emergency supply', kind: 'emergency-supply' },
  { slug: 'hypertension-case-finding', title: 'Hypertension case-finding consultation form', service: 'Hypertension', kind: 'hypertension' },
]
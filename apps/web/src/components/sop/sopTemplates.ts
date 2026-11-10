// Starter SOPs for a new pharmacy. Each one is a sensible outline written for
// community pharmacy in England. The pharmacy must review and adapt it (names,
// local arrangements, current guidance) before publishing. The first section
// says so.

export interface SOPTemplateSection {
  title: string
  html: string
}

export interface SOPTemplate {
  id: string
  title: string
  description: string
  sections: SOPTemplateSection[]
}

const adapt: SOPTemplateSection = {
  title: 'About this SOP',
  html:
    '<p><strong>Starter template.</strong> Review every section against current GPhC standards and NHS guidance, ' +
    'add your pharmacy’s own names, places and arrangements, and remove anything that does not apply before you publish.</p>' +
    '<p><strong>Responsible for this SOP:</strong> [name, role]<br><strong>Applies to:</strong> [roles]</p>',
}

const list = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
const steps = (items: string[]) => `<ol>${items.map((i) => `<li>${i}</li>`).join('')}</ol>`

export const SOP_TEMPLATES: SOPTemplate[] = [
  {
    id: 'dispensing',
    title: 'Dispensing process',
    description: 'From receiving a prescription to handing it out, including the accuracy check.',
    sections: [
      adapt,
      {
        title: '1. Receiving the prescription',
        html: steps([
          'Check the prescription is legally valid: patient details, prescriber signature (or valid electronic signature), date and that it is in date.',
          'Confirm the patient’s name, address and date of birth, and whether they pay or are exempt (check and record the evidence of exemption).',
          'Tell the patient roughly how long it will take, and ask about allergies or new medicines if relevant.',
        ]),
      },
      {
        title: '2. Clinical check',
        html:
          '<p>The pharmacist checks each item is appropriate for the patient: dose, interactions, allergies, contraindications and changes from previous supplies. ' +
          'Record any interventions and contact the prescriber when needed.</p>',
      },
      {
        title: '3. Assembly and labelling',
        html: steps([
          'Pick each item against the prescription, checking name, strength, form and quantity.',
          'Check expiry dates. Never use a split pack without checking the contents.',
          'Generate and attach the label; include the required warnings and the pharmacy details.',
          'Initial the “dispensed by” box.',
        ]),
      },
      {
        title: '4. Accuracy check',
        html:
          '<p>A second person (pharmacist or accredited checking technician) checks every item against the prescription and initials the “checked by” box. ' +
          'Where only one person is available, take a mental break before self-checking and record that it was self-checked.</p>',
      },
      {
        title: '5. Handing out',
        html: steps([
          'Confirm the patient’s identity (name and address, or date of birth).',
          'Check the number of bags and items with the patient.',
          'Offer counselling, and make sure new medicines are explained by the pharmacist.',
          'Refer any query you cannot answer to the pharmacist.',
        ]),
      },
      {
        title: '6. Near misses and errors',
        html: '<p>Record near misses in the near-miss log. Handle dispensing errors under the incidents SOP.</p>',
      },
    ],
  },
  {
    id: 'responsible-pharmacist',
    title: 'Responsible pharmacist',
    description: 'Signing in as RP, absence rules, the RP notice and what may happen without an RP.',
    sections: [
      adapt,
      {
        title: '1. Taking charge',
        html: steps([
          'Before the pharmacy opens (or when you take over), sign in to the RP record with your name, GPhC number and the time.',
          'Display your RP notice (name, registration number, that you are in charge) where the public can see it.',
          'Check these SOPs are available and that you are familiar with them.',
        ]),
      },
      {
        title: '2. Absence',
        html:
          '<p>The RP may be absent for up to 2 hours in total between midnight and midnight, and must remain contactable and able to return promptly. ' +
          'Record the time you leave and return in the RP record. Arrange for another pharmacist to be contactable if you cannot be.</p>',
      },
      {
        title: '3. What can and cannot happen while the RP is absent',
        html: list([
          'No P medicines may be sold and no prescriptions handed out (unless already checked and ready, as your SOPs allow).',
          'Dispensing assembly may continue if the pharmacy’s procedures allow, but the final clinical check waits for a pharmacist.',
          'GSL sales may continue.',
        ]),
      },
      {
        title: '4. Handing over and signing out',
        html: '<p>Sign out of the RP record with the time. Hand over anything outstanding to the next RP (handover notes).</p>',
      },
    ],
  },
  {
    id: 'controlled-drugs',
    title: 'Controlled drugs',
    description: 'Ordering, receipt, storage, supply, register entries, balance checks and destruction.',
    sections: [
      adapt,
      {
        title: '1. Ordering and receipt',
        html: steps([
          'Order Schedule 2 CDs with the correct requisition where required.',
          'On delivery, check the items against the invoice and put them in the CD cabinet straight away.',
          'Enter every Schedule 2 CD received in the CD register on the day of receipt (or the next day at the latest).',
        ]),
      },
      {
        title: '2. Storage',
        html: '<p>Store Schedule 2 and relevant Schedule 3 CDs in the locked CD cabinet. The RP controls the keys. Keep out-of-date and patient-returned CDs separate and clearly marked.</p>',
      },
      {
        title: '3. Supply',
        html: steps([
          'Check the prescription meets the CD prescription requirements, and that it is within 28 days of the appropriate date.',
          'Record the supply in the CD register on the day, including who collected and whether ID was seen.',
          'Ask for ID from anyone collecting Schedule 2 CDs, and record it.',
        ]),
      },
      {
        title: '4. Balance checks',
        html: '<p>Check running balances against physical stock at least weekly and record the check. Investigate and record any discrepancy straight away and tell the superintendent or CD accountable officer if it can’t be resolved.</p>',
      },
      {
        title: '5. Destruction',
        html: '<p>Out-of-date stock CDs are destroyed only in the presence of an authorised witness. Patient-returned CDs are recorded in the returns register and destroyed with a witness under local arrangements. Use denaturing kits.</p>',
      },
    ],
  },
  {
    id: 'fridge',
    title: 'Fridge temperature monitoring',
    description: 'Daily checks, what to do when the fridge is out of range, and cold-chain deliveries.',
    sections: [
      adapt,
      {
        title: '1. Daily checks',
        html: steps([
          'Every working day, read the current, minimum and maximum temperatures and record them.',
          'The safe range is +2 °C to +8 °C. Reset the min/max after each reading.',
          'Initial the record.',
        ]),
      },
      {
        title: '2. Out of range',
        html: steps([
          'Tell the pharmacist straight away. Do not use the affected stock until a decision is made.',
          'Quarantine the stock in a working fridge, labelled “do not use”.',
          'Record how long and how far out of range it was, and get advice from the manufacturer or supplier.',
          'Record the outcome and any stock destroyed.',
        ]),
      },
      {
        title: '3. Deliveries',
        html: '<p>Put fridge lines away as soon as they arrive. Check cold-chain packaging is intact.</p>',
      },
    ],
  },
  {
    id: 'complaints',
    title: 'Complaints and feedback',
    description: 'Handling a complaint in the pharmacy, recording it and learning from it.',
    sections: [
      adapt,
      {
        title: '1. Receiving a complaint',
        html: steps([
          'Listen, be polite and apologise for the experience. Do not argue.',
          'If you can resolve it on the spot, do so and record it.',
          'Otherwise pass it to the pharmacist or manager. Take the person’s contact details.',
        ]),
      },
      {
        title: '2. Recording and responding',
        html: '<p>Record every complaint (date, details, who handled it). Acknowledge written complaints within 3 working days and give a full response when the investigation is complete. Tell the person how to escalate if they are not satisfied.</p>',
      },
      {
        title: '3. Learning',
        html: '<p>Review complaints regularly with the team and record any changes made.</p>',
      },
    ],
  },
  {
    id: 'incidents',
    title: 'Dispensing errors and incidents',
    description: 'What to do when an error reaches a patient, and how near misses are recorded.',
    sections: [
      adapt,
      {
        title: '1. When an error reaches a patient',
        html: steps([
          'Put the patient’s safety first: get the correct medicine to them and check whether any wrong medicine was taken.',
          'Tell the pharmacist straight away. Contact the prescriber or NHS 111 if there is a risk of harm.',
          'Apologise and be open with the patient (duty of candour).',
          'Record the incident and report it through the national patient safety reporting route.',
        ]),
      },
      {
        title: '2. Near misses',
        html: '<p>A near miss is an error found before the medicine leaves the pharmacy. Record it in the near-miss log with the cause. Review the log each month and agree actions.</p>',
      },
      {
        title: '3. Review',
        html: '<p>Discuss incidents with the team without blame, and record what changes are made to prevent a repeat.</p>',
      },
    ],
  },
]

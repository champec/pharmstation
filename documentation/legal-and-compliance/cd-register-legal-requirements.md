# Legal Requirements for CD Registers, and how PharmStation meets them

**Last updated:** 2 November 2026
**Version:** 1.1
**Status:** Working check by the product team. Confirm against the current text of the
Misuse of Drugs Regulations 2001 (legislation.gov.uk) and GPhC / RPS guidance before
quoting any of this in sales material or to an inspector.

This page lists what the law expects of a controlled drugs (CD) register in a community
pharmacy in England, and records where PharmStation meets each point, where it relies on
the pharmacy's own procedure, and what is still open. Use it before claiming the digital
register is "compliant".

## Sources

- Misuse of Drugs Regulations 2001, regulations 19 and 20 and Schedule 6 (as amended,
  including the 2005 and 2008 amendments that allow computerised registers and running
  balances).
- Medicines (Pharmacy) (Responsible Pharmacist) Regulations 2008 (RP record).
- Department of Health "Safer management of controlled drugs" guidance and RPS
  guidance on running balances and patient-returned CDs.

## Register format

| Requirement | How PharmStation handles it | Status |
| --- | --- | --- |
| Separate part of the register for each class of drug, and a separate page for each strength and form, with class, strength and form at the head | One ledger per drug, form and strength. Exports print each ledger as its own section on a new page, headed with class, form and strength | Met |
| Entries in chronological order | Entries are numbered in order by the database function `ps_make_register_entry` under a row lock | Met |
| Entry made on the day of the transaction or the next day | Date of transaction and time entered are both stored and exported. A "Late entry" warning shows when the date is before yesterday | Met, with warning |
| No cancellation, obliteration or alteration; corrections by dated marginal note or footnote | Entries are immutable. Corrections are separate correction entries with a reason; notes are append-only annotations with author and time. Both appear in exports | Met |
| Computerised register: every entry attributable to the person who made it | `entered_by` and `authorised_by` stored on each entry and shown in exports | Met |
| Computerised register: capable of being audited | Immutable entries, correction trail, annotation trail | Met |
| Computerised register: safeguards against unauthorised access | Supabase auth with row level security per organisation. No staff MFA yet | Partly met: add MFA for owners and managers |
| Computerised register: accessible from the premises and capable of being printed | Web app. **Print / PDF** and **CSV** export on the CD register (all drugs, any date range), each drug ledger, the returns register, the RP log and custom logs | Met (added Nov 2026) |
| Kept for 2 years from the date of the last entry | Data is not deleted. Retention depends on the hosted database and its backups | Met, subject to hosting. Keep London cutover and backup plan on track |
| Backups | Supabase managed backups (plan dependent). CSV export lets the pharmacy keep its own copy | Partly met: document the backup schedule in the customer terms |

## Entry contents (Schedule 6)

### Receipts (drugs obtained)

| Field | Stored | Status |
| --- | --- | --- |
| Date supply received | `date_of_transaction` | Met |
| Name and address of the supplier | Name in `supplier_name`. **Address is not stored** | Gap: add a supplier address (or store the known-contact id) on receipts |
| Quantity received | `quantity_received` | Met |
| Running balance (good practice) | `running_balance` | Met |

### Supplies (drugs supplied)

| Field | Stored | Status |
| --- | --- | --- |
| Date supplied | `date_of_transaction` | Met |
| Name and address of the person or firm supplied | `patient_name`, `patient_address`. Address is optional in the UI; a "No patient address" warning now shows when it is blank | Met, with warning |
| Details of authority to possess: prescriber name and address | `prescriber_name`, `prescriber_address`, `prescriber_registration`. "No prescriber address" warning when blank | Met, with warning |
| Quantity supplied | `quantity_deducted` | Met |
| Person collecting: patient, patient's representative or healthcare professional, and if a healthcare professional their name and address | "Collected by" choice and details on both entry forms. Saved into the entry's own notes (immutable, exported) because there is no dedicated column yet | Met for now; add `collector_type` and `collector_details` columns to `ps_register_entries` |
| Was proof of identity requested of the patient or representative | `was_id_requested` | Met. The full OUT form did not save this until Nov 2026 (fixed) |
| Was proof of identity of the person collecting provided | `was_id_provided` | Met. Same fix as above |

## Other registers

| Register | Legal basis | PharmStation |
| --- | --- | --- |
| Responsible pharmacist record | RP Regulations 2008: name, GPhC number, date and time became and ceased to be RP. Kept 5 years | RP log with corrections trail, print, and CSV export of every entry including corrections |
| Patient-returned CDs | Not a statutory register, but expected by guidance and inspectors | Returns register with receipt, destruction, pharmacist and witness signatures; print (with signatures) and CSV |
| Custom logs (fridge, cleaning, date checks) | GPhC standards for safe and effective premises | Log builder; print and CSV for any date range, with missing required days shown as "Not recorded" |

## Open items before saying "compliant" in sales material

1. Add supplier address to receipt entries.
2. Move "Collected by" from notes into its own columns.
3. Staff MFA for owners and managers.
4. Finish the London data cutover and write the backup and retention schedule into the
   customer terms.
5. Hands-on walkthrough of an entry, a correction, a return and an export with a
   practising pharmacist before the first demo.

Until these are done, describe the register as "built to the Misuse of Drugs Regulations
requirements for computerised registers" rather than "fully compliant".

---

## Related Documents

- [Misuse of Drugs Regulations](./misuse-of-drugs-regulations.md)
- [CD Register Entry Format](../pharmacy-knowledge/cd-register-entry-format.md)
- [What is a CD Register](../pharmacy-knowledge/what-is-a-cd-register.md)
- [Record Retention Requirements](./record-retention-requirements.md)

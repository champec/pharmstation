# NHS Notify Onboarding — Draft Answers

Programme: Find the Right Service (FtRS) / PharmStation
Owner: Champe Chilufya (GPhC: 2226350)
Date: 9 May 2026

Summary
- Integration mode: API (preferred)
- Purpose: Direct care messaging to support pharmacy consultations and referral follow-up (one-to-one and event-triggered)
- Legal basis: Contractual necessity and direct care provision on behalf of pharmacy customers; lawful basis: "Provision of health or social care" (GDPR Article 9(2)(h)) and legitimate interest where appropriate. DPIA updated to include Notify usage.

Q.1 Are you sending messages to support direct care? 
- Yes. Messages will be sent to support direct care (appointment reminders, referral updates, medication collection notices).

Q.2 How do you want to integrate with NHS Notify?
- API

Q.3 Which use case best describes how you plan to use NHS Notify?
- To message patients on a one-to-one basis
- Also: When an event is triggered in the service (e.g., referral accepted, referral rejected, medication ready for collection)

Q.4 Examples of message types
- Prescription ready for collection (SMS)
- Referral received / referral accepted (SMS + NHS App if available)
- Appointment reminders for pharmacy consultations (SMS / Email)
- Urgent safety recall notifications to patients registered at a pharmacy (SMS)

Q.5 Outcomes and benefits
- Reduce missed appointments and increase completion of pharmacy consultations
- Improve patient experience with timely updates about referrals and prescriptions
- Reduce administrative overhead for pharmacies by automating routine notifications

Q.6 Do you currently send messages via NHS App / Email / SMS / Letters?
- No (PharmStation does not currently send messages through NHS channels; messages are sent by partner pharmacies via their own systems). Integration will enable PharmStation to send messages on behalf of pharmacies.

Q.6.1 Estimated volumes
- NHS App: 0 (initial)
- Email: 100–200 per month (initial pilot across multiple pharmacies)
- SMS: 500 per month (pilot)
- Letters: 0

Q.7 Planned start date
- Target start: 01 Sep 2026 (pilot)

Q.8 Is the start date a hard deadline?
- No

Q.9 Planned stop date
- Ongoing service (no fixed end date)

Q.10 How many people do you plan to message during this period?
- Pilot: 5,000 unique recipients over the first 6 months (estimate across pilot pharmacies)

Q.11 How often do you plan to send messages?
- Event-driven (on referral / dispensing events); estimate average 2 messages per patient per month during pilot

Q.12 Which channels do you want to send messages with?
- NHS App: No (initially)
- Email: Yes
- SMS: Yes
- Letters: No

Q.13 Will people expect messages from your organisation?
- Yes — messages are part of the pharmacy service and are triggered by an action the patient has taken (consultation, prescription, referral).
- For patients who have not opted in or are surprised, we will provide clear instructions in the message and include a contact link/phone number to manage queries. The pharmacy customer will be the point of contact for clinical queries.

Q.14 Do you understand and accept the terms for using NHS Notify?
- Yes — PharmStation understands and accepts the Accessible Information Standard, PDS use, requirement for Equality Impact Assessment, Caldicott Guardian consultation, and DPIA updates.

Notes / Next steps
- Update DPIA to explicitly include NHS Notify integration and share with internal Caldicott Guardian
- Implement records of consent/notification where required by local pharmacy policy
- Implement logging and audit of all outgoing messages in `ps_nhs_notify_log` table
- Schedule trial pilot with 1–3 pharmacies after passing PDS/DoS/NHS Notify assurance and DSPT publication


---

Commit guidance: paste the contents into the portal 'How you plan to use NHS Notify' form and adjust volumes/dates as needed. Once you confirm volumes and dates, I'll commit this file and push to git.
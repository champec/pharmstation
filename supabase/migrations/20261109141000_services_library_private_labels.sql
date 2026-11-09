-- Services library: the private minor-illness consultations were labelled as
-- NHS Pharmacy First, the private blood pressure check said "Free NHS", and a
-- private copy of the NHS-only New Medicine Service could be added while NHS
-- services are locked. Relabel them as private and retire the private NMS.
-- (Applied on London 9 Nov 2026.)
update ps_service_library set category = 'minor_illness',
  description = case name
    when 'Ear Infection Consultation' then 'Private consultation for earache and ear infection, with treatment where appropriate.'
    when 'Impetigo Consultation' then 'Private consultation for impetigo, with treatment where appropriate.'
    when 'Infected Insect Bite Consultation' then 'Private consultation for infected insect bites, with treatment where appropriate.'
    when 'Shingles Consultation' then 'Private consultation for shingles, with treatment where appropriate.'
    when 'Sinusitis Consultation' then 'Private consultation for sinusitis, with treatment where appropriate.'
    when 'Sore Throat Consultation' then 'Private sore throat consultation with FeverPAIN scoring and treatment where appropriate.'
    else description
  end
 where coalesce(is_nhs_service, false) = false and category = 'pharmacy_first';

update ps_service_library set description = 'Private blood pressure check with two readings and advice.'
 where coalesce(is_nhs_service, false) = false and name = 'Blood Pressure Check';

update ps_service_library set is_active = false
 where coalesce(is_nhs_service, false) = false and name = 'New Medicine Service (NMS)';

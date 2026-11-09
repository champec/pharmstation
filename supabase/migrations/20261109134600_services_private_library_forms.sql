-- Services: consultation forms for the private (non-NHS) library services.
--
-- Until now only the NHS library services had a canonical form, so a
-- pharmacy that added "Blood Pressure Check" or "Travel Vaccination" from the
-- library got a service with no consultation form. NHS services are locked
-- until approval, so private services are what pharmacies actually use.
--
-- Each private library service gets one default form. Forms are attached to
-- the library service (service_id), so every pharmacy that has subscribed,
-- or subscribes later, sees it. Idempotent: a service that already has a live
-- form is left alone.

do $$
declare
  svc record;
  v_form uuid;
  v_fields jsonb;
  f jsonb;
  i int;
  -- Shared opening and closing sections.
  v_open jsonb := '[
    ["H_CONSULT","heading","Consultation",false,null],
    ["CONSULTATION_METHOD","select","How was the consultation done?",true,["In the pharmacy","Telephone","Video"]],
    ["CONSENT","boolean","Patient (or carer) consents to the consultation",true,null],
    ["ALLERGIES","text","Allergies (write None known if none)",true,null],
    ["CURRENT_MEDICINES","textarea","Current medicines",false,null],
    ["PREGNANT_BREASTFEEDING","select","Pregnant or breastfeeding?",false,["No","Pregnant","Breastfeeding","Not applicable"]]
  ]';
  v_close jsonb := '[
    ["H_CLOSE","heading","Advice and sign-off",false,null],
    ["SAFETY_NETTING","boolean","Safety-netting advice given (when to seek help)",true,null],
    ["LEAFLET_GIVEN","boolean","Written information or leaflet given",false,null],
    ["PATIENT_SIGNATURE","signature","Patient signature",false,null]
  ]';
begin
  for svc in
    select l.id, l.name
      from ps_service_library l
     where coalesce(l.is_nhs_service, false) = false
       and coalesce(l.is_active, true)
       and not exists (
         select 1 from ps_service_forms f
          where f.service_id = l.id and f.archived_at is null)
  loop
    v_fields := case svc.name
      when 'Blood Pressure Check' then '[
        ["H_READINGS","heading","Readings",false,null],
        ["INFO_BP","info","Sit the patient for 5 minutes, arm supported at heart level. Take two readings a minute apart.",false,null],
        ["SYSTOLIC_1","number","First reading, systolic (mmHg)",true,null],
        ["DIASTOLIC_1","number","First reading, diastolic (mmHg)",true,null],
        ["SYSTOLIC_2","number","Second reading, systolic (mmHg)",false,null],
        ["DIASTOLIC_2","number","Second reading, diastolic (mmHg)",false,null],
        ["PULSE","number","Pulse (beats per minute)",false,null],
        ["IRREGULAR_PULSE","boolean","Pulse irregular?",false,null],
        ["ARM","select","Arm used",false,["Left","Right"]],
        ["RESULT_BAND","select","Result",true,["Normal (below 135/85)","High normal","High (135/85 to 179/119)","Very high (180/120 or above)","Low (below 90/60)"]],
        ["SYMPTOMS","multiselect","Symptoms reported",false,["None","Headache","Chest pain","Shortness of breath","Blurred vision","Dizziness","Confusion"]]
      ]'
      when 'COVID-19 Vaccination' then '[
        ["H_ELIGIBILITY","heading","Eligibility",false,null],
        ["ELIGIBLE_REASON","text","Reason for vaccination",false,null],
        ["PREVIOUS_REACTION","boolean","Previous reaction to a COVID-19 vaccine?",true,null],
        ["FEVERISH_TODAY","boolean","Unwell or feverish today?",true,null],
        ["LAST_DOSE_DATE","date","Date of last COVID-19 dose",false,null],
        ["H_VACCINE","heading","Vaccine given",false,null],
        ["VACCINE_BRAND","text","Vaccine brand",true,null],
        ["BATCH_NUMBER","text","Batch number",true,null],
        ["EXPIRY_DATE","date","Expiry date",true,null],
        ["SITE","select","Injection site",true,["Left deltoid","Right deltoid","Left thigh","Right thigh"]],
        ["OBSERVED","boolean","Patient observed after vaccination with no reaction",false,null]
      ]'
      when 'Flu Vaccination' then '[
        ["H_ELIGIBILITY","heading","Eligibility",false,null],
        ["EGG_ALLERGY","boolean","Severe egg allergy (anaphylaxis)?",true,null],
        ["PREVIOUS_REACTION","boolean","Previous reaction to a flu vaccine?",true,null],
        ["FEVERISH_TODAY","boolean","Unwell or feverish today?",true,null],
        ["ANTICOAGULANT","boolean","Taking an anticoagulant or has a bleeding disorder?",false,null],
        ["H_VACCINE","heading","Vaccine given",false,null],
        ["VACCINE_BRAND","text","Vaccine brand",true,null],
        ["BATCH_NUMBER","text","Batch number",true,null],
        ["EXPIRY_DATE","date","Expiry date",true,null],
        ["SITE","select","Injection site",true,["Left deltoid","Right deltoid"]],
        ["GP_INFORMED","boolean","GP to be informed",false,null]
      ]'
      when 'Travel Vaccination' then '[
        ["H_TRIP","heading","Trip",false,null],
        ["DESTINATIONS","text","Countries being visited",true,null],
        ["DEPARTURE_DATE","date","Departure date",true,null],
        ["TRIP_LENGTH","text","Length of stay",false,null],
        ["TRIP_TYPE","multiselect","Type of travel",false,["Holiday","Business","Visiting family","Backpacking","Rural or remote areas"]],
        ["PREVIOUS_VACCINES","textarea","Previous travel vaccines and dates",false,null],
        ["H_VACCINE","heading","Vaccines given",false,null],
        ["VACCINES_GIVEN","table","Vaccines given today",true,{"columns":[{"key":"vaccine","label":"Vaccine","type":"text"},{"key":"batch","label":"Batch","type":"text"},{"key":"expiry","label":"Expiry","type":"date"},{"key":"site","label":"Site","type":"select","values":["Left deltoid","Right deltoid","Left thigh","Right thigh","Oral"]}],"minRows":1}],
        ["NEXT_DOSE_DATE","date","Next dose due",false,null],
        ["MALARIA_ADVICE","boolean","Malaria and bite-prevention advice given",false,null]
      ]'
      when 'Emergency Contraception' then '[
        ["H_ASSESS","heading","Assessment",false,null],
        ["HOURS_SINCE_UPSI","number","Hours since unprotected sex",true,null],
        ["LMP_DATE","date","First day of last period",false,null],
        ["OTHER_UPSI","boolean","Other unprotected sex this cycle?",false,null],
        ["WEIGHT_OVER_70","boolean","Weight over 70kg or BMI over 26?",false,null],
        ["ENZYME_INDUCERS","boolean","Taking enzyme-inducing medicines?",true,null],
        ["UNDER_16","boolean","Under 16? (Fraser competence and safeguarding checked)",true,null],
        ["COPPER_IUD_DISCUSSED","boolean","Copper IUD offered as most effective option",true,null],
        ["PRODUCT","select","Product supplied",false,["Levonorgestrel 1.5mg","Levonorgestrel 3mg (double dose)","Ulipristal 30mg","None, referred"]],
        ["STI_ADVICE","boolean","STI testing and ongoing contraception advice given",false,null]
      ]'
      when 'Medication Review' then '[
        ["H_REVIEW","heading","Review",false,null],
        ["REVIEW_REASON","text","Reason for review",false,null],
        ["MEDICINES_REVIEWED","table","Medicines reviewed",false,{"columns":[{"key":"medicine","label":"Medicine","type":"text"},{"key":"issue","label":"Issue found","type":"text"},{"key":"action","label":"Action","type":"select","values":["No change","Advice given","Refer to GP","Stop (with GP)","Dose change (with GP)"]}],"minRows":1}],
        ["ADHERENCE","select","How well does the patient take their medicines?",true,["Takes as prescribed","Sometimes misses doses","Often misses doses","Has stopped some medicines"]],
        ["SIDE_EFFECTS","textarea","Side effects reported",false,null],
        ["ISSUES_FOUND","textarea","Problems found and actions agreed",false,null],
        ["GP_FEEDBACK","boolean","Feedback sent to GP",false,null]
      ]'
      when 'New Medicine Service (NMS)' then '[
        ["H_NEW","heading","New medicine",false,null],
        ["NEW_MEDICINE","text","New medicine",true,null],
        ["CONDITION","select","Condition",true,["Asthma or COPD","Type 2 diabetes","Hypertension","Hypercholesterolaemia","Atrial fibrillation","Coronary heart disease","Heart failure","Other"]],
        ["STAGE","select","Stage",true,["Engagement","Intervention","Follow-up"]],
        ["TAKING_AS_PRESCRIBED","boolean","Taking the medicine as prescribed?",true,null],
        ["PROBLEMS","textarea","Problems, side effects or concerns",false,null],
        ["ADVICE","textarea","Advice and agreed actions",false,null],
        ["REFER_GP","boolean","Referred to GP",false,null]
      ]'
      when 'Smoking Cessation' then '[
        ["H_SMOKING","heading","Smoking history",false,null],
        ["CIGS_PER_DAY","number","Cigarettes per day",true,null],
        ["YEARS_SMOKING","number","Years smoking",false,null],
        ["QUIT_DATE","date","Agreed quit date",true,null],
        ["CO_READING","number","Carbon monoxide reading (ppm)",false,null],
        ["VISIT","select","Visit",true,["First visit","Week 1","Week 2","Week 3","Week 4","Week 12","Other follow-up"]],
        ["STILL_SMOKING","boolean","Smoked since the last visit?",false,null],
        ["PRODUCT","multiselect","Stop-smoking aids",false,["Patch","Gum","Lozenge","Inhalator","Mouth spray","Nasal spray","Vape","None"]]
      ]'
      when 'Ear Infection Consultation' then '[
        ["H_SYMPTOMS","heading","Symptoms",false,null],
        ["EAR","select","Which ear?",true,["Left","Right","Both"]],
        ["DURATION_DAYS","number","Days with symptoms",true,null],
        ["SYMPTOMS","multiselect","Symptoms",true,["Pain","Discharge","Itch","Hearing loss","Fever","Feeling of fullness"]],
        ["TEMPERATURE","number","Temperature (°C)",false,null],
        ["RED_FLAGS","multiselect","Red flags",false,["None","Swelling behind the ear","Severe systemic illness","Facial weakness","Neck stiffness","Foreign body"]],
        ["OTOSCOPY","textarea","Otoscope findings",false,null]
      ]'
      when 'Impetigo Consultation' then '[
        ["H_SYMPTOMS","heading","Symptoms",false,null],
        ["LOCATION","text","Where are the lesions?",true,null],
        ["LESION_COUNT","select","How many lesions?",true,["1 or 2","3 or more","Widespread"]],
        ["BULLOUS","boolean","Bullous (blisters)?",false,null],
        ["SYSTEMIC","boolean","Unwell, fever or swollen glands?",true,null],
        ["RECURRENT","boolean","Had impetigo more than once this year?",false,null],
        ["SCHOOL_WORK_ADVICE","boolean","Advised to stay off school or work until crusted or 48 hours after treatment",true,null]
      ]'
      when 'Infected Insect Bite Consultation' then '[
        ["H_SYMPTOMS","heading","Symptoms",false,null],
        ["LOCATION","text","Where is the bite?",true,null],
        ["HOURS_SINCE_BITE","number","Hours since bite",false,null],
        ["SIGNS","multiselect","Signs",true,["Redness","Swelling","Heat","Pain","Pus","Spreading redness"]],
        ["SPREADING","boolean","Redness spreading or tracking up the limb?",true,null],
        ["SYSTEMIC","boolean","Fever or feeling very unwell?",true,null],
        ["TICK_BITE","boolean","Tick bite (Lyme disease risk)?",false,null]
      ]'
      when 'Shingles Consultation' then '[
        ["H_SYMPTOMS","heading","Symptoms",false,null],
        ["RASH_LOCATION","text","Where is the rash?",true,null],
        ["DAYS_SINCE_RASH","number","Days since the rash appeared",true,null],
        ["EYE_INVOLVED","boolean","Rash on the forehead, nose tip or near the eye?",true,null],
        ["IMMUNOSUPPRESSED","boolean","Immunosuppressed?",true,null],
        ["PAIN_SCORE","number","Pain score (0 to 10)",false,null],
        ["CONTACT_ADVICE","boolean","Advised to avoid pregnant, newborn or immunosuppressed contacts",true,null]
      ]'
      when 'Sinusitis Consultation' then '[
        ["H_SYMPTOMS","heading","Symptoms",false,null],
        ["DURATION_DAYS","number","Days with symptoms",true,null],
        ["SYMPTOMS","multiselect","Symptoms",true,["Blocked nose","Facial pain or pressure","Discoloured discharge","Reduced smell","Fever","Toothache"]],
        ["DOUBLE_SICKENING","boolean","Got better then worse again?",false,null],
        ["RED_FLAGS","multiselect","Red flags",false,["None","Swelling around the eye","Double vision","Severe frontal headache","Confusion","Neck stiffness"]],
        ["TEMPERATURE","number","Temperature (°C)",false,null]
      ]'
      when 'Sore Throat Consultation' then '[
        ["H_FEVERPAIN","heading","FeverPAIN score",false,null],
        ["INFO_FEVERPAIN","info","Score one point for each. 0 to 1: no antibiotic. 2 to 3: consider a delayed antibiotic. 4 or more: consider an antibiotic.",false,null],
        ["FEVER_24H","boolean","Fever in the last 24 hours",true,null],
        ["PURULENCE","boolean","Pus on the tonsils",true,null],
        ["ATTEND_RAPIDLY","boolean","Came within 3 days of symptoms starting",true,null],
        ["INFLAMED_TONSILS","boolean","Severely inflamed tonsils",true,null],
        ["NO_COUGH","boolean","No cough or runny nose",true,null],
        ["FEVERPAIN_SCORE","number","FeverPAIN score (0 to 5)",true,null],
        ["RED_FLAGS","multiselect","Red flags",false,["None","Difficulty breathing","Drooling or unable to swallow","Stridor","Severe systemic illness"]]
      ]'
      else '[
        ["H_DETAILS","heading","Details",false,null],
        ["PRESENTING_COMPLAINT","textarea","Reason for visit",true,null],
        ["ASSESSMENT","textarea","Assessment",false,null]
      ]'
    end::jsonb;

    v_fields := v_open || v_fields || v_close;

    insert into ps_service_forms (service_id, name, is_default, version)
    values (svc.id, svc.name || ' consultation', true, 1)
    returning id into v_form;

    i := 0;
    for f in select value from jsonb_array_elements(v_fields) loop
      i := i + 1;
      insert into ps_service_form_fields (form_id, field_key, field_type, label, is_required, options, display_order)
      values (
        v_form,
        f ->> 0,
        f ->> 1,
        f ->> 2,
        (f ->> 3)::boolean,
        case when jsonb_typeof(f -> 4) = 'null' then null else f -> 4 end,
        i
      );
    end loop;
  end loop;
end $$;

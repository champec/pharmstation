# Prescription Scanner

AI-powered prescription recognition and extraction for accurate medication dispensing.

## Overview

The Prescription Scanner automates the extraction of prescription information from written and printed prescriptions. It recognizes drug names, dosages, frequencies, and patient information to improve accuracy and reduce manual data entry errors.

## What Goes Here

This directory contains:

- **Prescription Recognition**: Text extraction from prescription documents
- **Drug Name Detection**: Recognizing medications from handwritten and printed text
- **Dosage Parsing**: Extracting strength and quantity information
- **Patient Information**: Extracting patient details and identification
- **Validation Logic**: Cross-referencing against drug databases
- **Safety Checks**: Detecting potential drug interactions and contraindications
- **Compliance**: Verifying controlled substance requirements

## Key Features

### Prescription Parsing
- **Patient Information**: Name, age, ID, contact details
- **Doctor Information**: Name, credentials, contact
- **Drug Name**: Both branded and generic names
- **Strength/Dosage**: Dose amount and unit
- **Frequency**: How often to take (e.g., "every 8 hours")
- **Duration**: Length of treatment
- **Quantity**: Number of doses/tablets
- **Refills**: Number of refill authorizations
- **Special Instructions**: Special administration notes

### Recognition Capabilities
- **Handwritten Recognition**: Scans handwritten prescriptions
- **Printed Recognition**: Processes printed prescriptions
- **Prescription Forms**: Handles standard pharmaceutical forms
- **Electronic Prescriptions**: Imports e-prescriptions
- **Multi-language**: Supports multiple languages

### Safety Features
- **Drug Database Matching**: Validates against formulary
- **Interaction Checking**: Detects potential drug interactions
- **Contraindication Detection**: Identifies patient-specific warnings
- **Dosage Validation**: Checks against safe dosage ranges
- **Allergy Checking**: Cross-references patient allergies
- **Controlled Substance Tracking**: Enforces special handling for Schedule II-V drugs

### Compliance
- **DEA Compliance**: Follows prescription regulations
- **State Requirements**: Handles state-specific requirements
- **Documentation**: Generates required records
- **Audit Trail**: Logs all prescription processing

## Usage Examples

### Basic Prescription Scanning
```typescript
import { PrescriptionScanner } from '@pharmstation/ai/prescription';

const scanner = new PrescriptionScanner(apiKey);

// Scan from image
const prescription = await scanner.scan(prescriptionImage);

// Returns:
{
  patientName: 'John Doe',
  patientDOB: '1980-05-15',
  patientAge: 44,
  patientId: 'PAT-001',
  
  doctorName: 'Dr. Jane Smith',
  doctorPhone: '555-0100',
  doctorDEA: 'AS1234567',
  
  drugName: 'Amoxicillin',
  genericName: 'amoxicillin',
  strength: '500mg',
  form: 'capsule',
  quantity: 30,
  
  frequency: 'Every 8 hours',
  duration: '7 days',
  refills: 2,
  
  specialInstructions: 'Take with food',
  
  isControlled: false,
  
  confidence: 0.94,
  extractedAt: '2024-01-15T14:30:00Z'
}
```

### Comprehensive Validation
```typescript
// Get patient medication history
const patientHistory = await fetchPatientHistory(prescription.patientId);

// Check for interactions
const interactions = await scanner.checkDrugInteractions({
  newDrug: prescription.drugName,
  patientMedications: patientHistory.medications,
  patientAllergies: patientHistory.allergies,
  patientAge: prescription.patientAge
});

if (interactions.conflicts.length > 0) {
  console.log('Potential interactions found:');
  interactions.conflicts.forEach(conflict => {
    console.log(`- ${conflict.severity}: ${conflict.description}`);
  });
}

// Check dosage appropriateness
const dosageCheck = await scanner.validateDosage({
  drug: prescription.drugName,
  strength: prescription.strength,
  patientAge: prescription.patientAge,
  patientWeight: patientHistory.weight,
  indicatedFor: prescription.indication
});

if (!dosageCheck.isAppropriate) {
  console.log('Dosage warning:', dosageCheck.warning);
}
```

### Processing with Patient Context
```typescript
// Get patient information
const patient = await fetchPatientData(prescription.patientId);

// Process prescription with full context
const result = await scanner.processWithContext(prescriptionImage, {
  patient,
  checkInteractions: true,
  checkContraindications: true,
  validateDosage: true,
  generateDispensingLabel: true
});

// Generate dispensing information
const dispensingInfo = {
  medication: result.drugName,
  strength: result.strength,
  quantity: result.quantity,
  instructions: result.dispensingInstructions,
  warnings: result.warnings,
  label: result.label
};
```

### Batch Processing Multiple Prescriptions
```typescript
const prescriptionImages = [image1, image2, image3];

const results = await scanner.processBatch(prescriptionImages, {
  validateAll: true,
  checkInteractions: true,
  parallel: true,
  maxConcurrent: 5
});

const { successful, failed, warnings } = results;

console.log(`Processed ${successful.length}`);
console.log(`Failed: ${failed.length}`);
console.log(`Warnings: ${warnings.length}`);
```

### Controlled Substance Handling
```typescript
const prescription = await scanner.scan(image);

if (prescription.isControlled) {
  // Check DEA limits
  const deaLimits = await checkDEALimits(
    prescription.patientId,
    prescription.drugName
  );
  
  if (deaLimits.exceeded) {
    console.log('DEA prescription limit exceeded');
    // Cannot dispense without special authorization
  }
  
  // Generate required documentation
  const deaForm = await generateDEAForm({
    prescription,
    pharmacist: currentPharmacist,
    dispensingDate: new Date()
  });
}
```

### Electronic Prescription Import
```typescript
// Import from e-prescription system
const ePrescription = await scanner.importEPrescription(prescriptionData);

// Verify signature and authenticity
const verified = await scanner.verifyEPrescriptionSignature(ePrescription);

if (verified) {
  const prescription = await scanner.parseEPrescription(ePrescription);
}
```

## Output Structure

```typescript
interface ExtractedPrescription {
  // Patient information
  patientName: string;
  patientDOB: string; // ISO date
  patientAge?: number;
  patientId?: string;
  patientPhone?: string;
  patientAddress?: string;
  
  // Doctor information
  doctorName: string;
  doctorPhone?: string;
  doctorDEA?: string; // For controlled substances
  doctorAddress?: string;
  doctorSignature?: boolean;
  
  // Medication information
  drugName: string;
  drugNameConfidence: number;
  
  genericName?: string;
  brandName?: string;
  strength: string;
  strengthConfidence: number;
  
  form?: string; // tablet, capsule, liquid, etc.
  quantity: number;
  quantityConfidence: number;
  
  // Dosage information
  frequency: string; // e.g., "Every 8 hours", "Three times daily"
  frequencyConfidence: number;
  
  duration: string; // e.g., "7 days"
  durationConfidence: number;
  
  // Additional info
  refills?: number;
  specialInstructions?: string;
  indication?: string; // What it's prescribed for
  
  // Controlled substance info
  isControlled: boolean;
  scheduleLevel?: 'II' | 'III' | 'IV' | 'V';
  requiresSignature?: boolean;
  requiresIdVerification?: boolean;
  
  // Quality metrics
  overallConfidence: number;
  requiresManualReview: boolean;
  
  // Processing info
  processedAt: string;
  processingTime: number;
}

interface ValidationResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  interactions: DrugInteraction[];
  contraindications: Contraindication[];
  dosageIssues: DosageIssue[];
  safetyAlerts: SafetyAlert[];
}
```

## Drug Database Integration

```typescript
// Query drug information
const drugInfo = await scanner.getDrugInfo('Amoxicillin');
// Returns: {
//   name: 'Amoxicillin',
//   genericName: 'amoxicillin',
//   commonBrands: ['Amoxil'],
//   strengthOptions: ['250mg', '500mg', '875mg'],
//   forms: ['capsule', 'tablet', 'suspension'],
//   isControlled: false,
//   interactsWith: [...],
//   contraindications: [...],
//   sideEffects: [...]
// }

// Get alternatives
const alternatives = await scanner.getAlternatives(drugName, {
  sametherapeutic: true,
  lowerCost: true
});
```

## Configuration

```typescript
interface ScannerOptions {
  // Recognition
  handwritingSupport?: boolean;
  language?: string;
  
  // Validation
  checkInteractions?: boolean;
  checkContraindications?: boolean;
  validateDosage?: boolean;
  checkDEALimits?: boolean;
  
  // Patient context
  patientAlergies?: string[];
  patientMedications?: string[];
  patientAge?: number;
  
  // Output
  generateLabel?: boolean;
  generateWarnings?: boolean;
  
  // Thresholds
  minConfidence?: number; // Default: 0.85
  
  // Processing
  async?: boolean;
  timeout?: number;
}
```

## Error Handling

```typescript
import {
  PrescriptionScanError,
  UnreadablePrescriptionError,
  ValidationError
} from '@pharmstation/ai/prescription';

try {
  const prescription = await scanner.scan(image);
} catch (error) {
  if (error instanceof UnreadablePrescriptionError) {
    // Document too poor quality
    console.log('Please provide a clearer image');
  } else if (error instanceof ValidationError) {
    // Extracted data failed validation
    console.log('Prescription data invalid:', error.details);
  } else if (error instanceof PrescriptionScanError) {
    console.log('Scan failed:', error.message);
  }
}
```

## Testing

Mock implementations for testing:

```typescript
import { createMockPrescriptionScanner } from '@pharmstation/ai/prescription/testing';

const scanner = createMockPrescriptionScanner();
const result = await scanner.scan(mockImage);
// Returns realistic test data
```

## Limitations

- Handwritten prescriptions require clear handwriting
- Must be recent (not expired)
- Requires patient information for full validation
- Some medications may not be in database
- Multi-drug prescriptions require separate scans

## Related Documentation

- [AI Package Overview](../README.md)
- [Validation Rules](../../core/src/validation/README.md)
- [Supabase Integration](../../supabase-client/README.md)

## Best Practices

1. **Manual Review**: Always have pharmacist review AI results
2. **Validation**: Run full validation including drug interactions
3. **Patient Verification**: Always verify patient identity
4. **Documentation**: Log all prescription processing
5. **Safety First**: When in doubt, escalate to pharmacist
6. **Updates**: Keep drug database current
7. **Compliance**: Ensure adherence to all regulations
8. **Training**: Train staff on using the scanner

## Compliance Notes

- Follows FDA regulations for prescription processing
- Complies with DEA requirements for controlled substances
- HIPAA compliant for patient data handling
- State-specific prescription requirements supported
- Audit trails maintained for all operations

# @pharmstation/ai

AI-powered features including invoice scanning, prescription recognition, chatbot integration, and intelligent reconciliation.

## Overview

This package integrates advanced AI capabilities into PharmStation to automate manual processes, reduce data entry errors, and provide intelligent assistance. It leverages modern machine learning APIs and models for document analysis and natural language understanding.

## What Goes Here

This package includes:

- **Invoice Scanner**: OCR and extraction of supplier invoices
- **Prescription Scanner**: Recognition and extraction of prescription data
- **Genie Chatbot**: Intelligent assistant for user queries
- **Reconciliation Assistant**: AI-powered matching and reconciliation logic

## Key Features & Responsibilities

### Invoice Scanner (`src/invoice-scanner/`)
- Optical Character Recognition (OCR) for invoice PDFs and images
- Automatic extraction of key invoice fields
- Product line item detection and parsing
- Price and tax calculation verification
- Supplier information extraction
- Invoice numbering and date detection

### Prescription Scanner (`src/prescription/`)
- Handwritten and printed prescription recognition
- Patient information extraction
- Drug name and dosage detection
- Frequency and duration parsing
- Pharmacist notes extraction
- Validation against controlled substance lists

### Genie Chatbot (`src/genie/`)
- Natural language understanding for user queries
- Intent detection and routing
- Contextual conversation management
- Multi-language support
- Fallback to human agents when needed
- Learning from successful interactions

### Reconciliation Assistant (`src/reconciliation/`)
- Intelligent matching of received vs. ordered items
- Automatic discrepancy detection
- Suggested resolutions based on patterns
- Historical reconciliation analysis
- Bulk reconciliation operations

## Usage Examples

### Invoice Scanner
```typescript
import { createInvoiceScanner } from '@pharmstation/ai/invoice-scanner';

const scanner = createInvoiceScanner(apiKey);

// Scan an invoice image
const result = await scanner.scan(imageFile);
// Returns: {
//   invoiceNumber: 'INV-2024-001',
//   invoiceDate: '2024-01-15',
//   supplierName: 'ABC Pharmaceuticals',
//   supplierId: 'supplier-001',
//   lineItems: [
//     { productName: 'Aspirin', quantity: 100, unitPrice: 1.50, total: 150.00 },
//     { productName: 'Ibuprofen', quantity: 50, unitPrice: 2.00, total: 100.00 }
//   ],
//   subtotal: 250.00,
//   tax: 25.00,
//   total: 275.00,
//   confidence: 0.95
// }

// Validate extracted data
const validated = await scanner.validate(result);

// Match with purchase orders
const matched = await scanner.matchPurchaseOrder(result, purchaseOrders);
```

### Prescription Scanner
```typescript
import { createPrescriptionScanner } from '@pharmstation/ai/prescription';

const scanner = createPrescriptionScanner(apiKey);

// Scan a prescription image
const prescription = await scanner.scan(prescriptionImage);
// Returns: {
//   patientName: 'John Doe',
//   patientDOB: '1980-05-15',
//   doctorName: 'Dr. Smith',
//   drugName: 'Amoxicillin',
//   strength: '500mg',
//   quantity: 30,
//   frequency: 'Every 8 hours',
//   duration: '7 days',
//   refills: 2,
//   isControlled: false,
//   confidence: 0.92
// }

// Validate against formulary
const isValid = await scanner.validateAgainstFormulary(prescription);

// Check for drug interactions
const interactions = await scanner.checkInteractions(
  prescription,
  patientMedicationHistory
);

// Generate dispensing instructions
const instructions = await scanner.generateDispensingInstructions(prescription);
```

### Genie Chatbot
```typescript
import { createGenieBot } from '@pharmstation/ai/genie';

const genie = createGenieBot(apiKey);

// Start conversation
const conversation = await genie.startConversation({
  userId: 'user-001',
  context: { pharmacyId: 'pharm-001' }
});

// Send user message
const response = await conversation.send({
  message: 'What inventory items are expiring soon?'
});
// Returns: {
//   reply: 'I found 5 items expiring in the next 30 days...',
//   suggestedActions: ['View expiring items', 'Create purchase order'],
//   intent: 'query_inventory',
//   confidence: 0.87
// }

// Handle different intents
if (response.intent === 'query_inventory') {
  // Load and display inventory data
} else if (response.intent === 'create_order') {
  // Show order creation form
} else if (response.intent === 'escalate') {
  // Route to human agent
}

// Continue conversation
const followUp = await conversation.send({
  message: 'Show me the details'
});

// End conversation
await conversation.close();
```

### Reconciliation Assistant
```typescript
import { createReconciliationAssistant } from '@pharmstation/ai/reconciliation';

const assistant = createReconciliationAssistant(apiKey);

// Analyze discrepancies
const analysis = await assistant.analyzeDiscrepancies({
  ordered: purchaseOrderItems,
  received: receivedItems
});
// Returns: {
//   matches: 45,
//   discrepancies: [
//     {
//       orderedItem: { productId: 'prod-001', quantity: 100 },
//       receivedItem: { productId: 'prod-001', quantity: 95 },
//       discrepancy: 'quantity_mismatch',
//       severity: 'medium',
//       suggestedAction: 'Contact supplier regarding short shipment'
//     }
//   ]
// }

// Get suggested resolutions
const suggestions = await assistant.suggestResolutions(analysis);

// Apply AI-recommended reconciliation
const reconciled = await assistant.autoReconcile(analysis, {
  acceptThreshold: 0.8,
  autoApplySuggestions: false
});

// Learn from resolution for future suggestions
await assistant.logResolution({
  analysis,
  userAction,
  outcome
});
```

## Tech Stack

- **OCR Engine**: Tesseract.js or Google Cloud Vision API
- **Prescription Recognition**: Custom model or specialized OCR
- **LLM Integration**: OpenAI GPT / Anthropic Claude / other providers
- **Message Queue**: For async processing of large files
- **Vector Database**: For semantic similarity matching
- **Language**: TypeScript
- **ML Framework**: TensorFlow.js or ONNX Runtime

## Key Algorithms

### Invoice Extraction
1. Document preprocessing (binarization, deskewing)
2. Structure detection (header, line items, totals)
3. Field extraction (regex + ML-based)
4. Validation against known suppliers
5. Correction using fuzzy matching

### Prescription Parsing
1. Handwriting recognition (if applicable)
2. Section identification
3. Entity extraction (drugs, dosages, frequencies)
4. Validation against drug databases
5. Patient safety checks

### Conversational AI
1. Intent classification
2. Entity extraction
3. Context management
4. Response generation
5. Confidence scoring

### Intelligent Matching
1. Similar product detection
2. Quantity variance analysis
3. Pattern recognition from history
4. Outlier detection
5. Suggestion ranking

## Error Handling

All operations include fallback strategies:

```typescript
import { AIError, FallbackMode } from '@pharmstation/ai';

try {
  const result = await scanner.scan(file);
} catch (error) {
  if (error instanceof AIError) {
    if (error.confidence < 0.7) {
      // Low confidence - require manual review
      const manualReview = await requestManualReview(file);
    } else if (error.retryable) {
      // Temporary error - retry
      const retried = await scanner.scan(file);
    } else {
      // Fatal error - escalate
      await escalateToHuman(file, error);
    }
  }
}
```

## Configuration

```typescript
const config = {
  // API credentials
  apiKey: 'your-api-key',
  
  // Quality settings
  minConfidence: 0.75,
  allowManualCorrection: true,
  
  // Processing
  async: true,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  
  // Features
  enableOCR: true,
  enableValidation: true,
  enableAutoCorrection: false,
  
  // Logging
  logResults: true,
  logMetrics: true
};
```

## Performance Considerations

- Batch processing for multiple documents
- Caching of recognition results
- Progressive enhancement (low res → high res)
- Async processing for large files
- Rate limiting for API calls

## Directory Structure

```
packages/ai/
├── README.md
├── package.json
├── src/
│   ├── invoice-scanner/      # Invoice OCR
│   ├── prescription/         # Prescription scanning
│   ├── genie/               # Chatbot integration
│   ├── reconciliation/       # Reconciliation AI
│   └── index.ts             # Main export
├── dist/                    # Compiled output (generated)
└── tsconfig.json           # TypeScript configuration
```

## Related Documentation

- [Invoice Scanner Details](./src/invoice-scanner/README.md)
- [Prescription Scanner Details](./src/prescription/README.md)
- [Genie Chatbot Details](./src/genie/README.md)
- [Reconciliation Assistant Details](./src/reconciliation/README.md)
- [Core Package](../core/README.md)
- [Supabase Client Package](../supabase-client/README.md)

## Testing

Includes mock implementations for development:

```typescript
import { createMockInvoiceScanner } from '@pharmstation/ai/invoice-scanner/testing';

const mockScanner = createMockInvoiceScanner();
const result = await mockScanner.scan(mockFile);
```

## Contributing Guidelines

When adding AI features:
1. Include comprehensive error handling
2. Provide confidence scores for all ML outputs
3. Support manual review and correction
4. Document limitations and edge cases
5. Write integration tests
6. Consider privacy and data security
7. Log all AI decisions for audit trails
8. Update this README with new capabilities

## Privacy & Security

- All data is encrypted in transit
- AI models run in secure environments
- Compliance with HIPAA/GDPR requirements
- Audit logging of all AI operations
- User consent for data processing
- Option to process locally without cloud APIs

## Best Practices

1. **Confidence Scoring**: Always check confidence levels
2. **Human Review**: Critical operations require human validation
3. **Error Handling**: Graceful fallback when AI fails
4. **Monitoring**: Track AI accuracy metrics
5. **Updates**: Regularly update models and vocabularies
6. **Testing**: Comprehensive test coverage
7. **Documentation**: Clear usage examples

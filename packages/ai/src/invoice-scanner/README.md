# Invoice Scanner

AI-powered invoice scanning and extraction using OCR and machine learning.

## Overview

The Invoice Scanner automates the process of extracting data from supplier invoices, reducing manual data entry errors and processing time. It handles various invoice formats (PDFs, images) and automatically extracts key information.

## What Goes Here

This directory contains:

- **OCR Engine**: Text recognition from invoice images
- **Structure Detection**: Identifying invoice layout and sections
- **Field Extraction**: Pulling out key data (invoice number, date, totals)
- **Line Item Parsing**: Extracting product details
- **Validation Logic**: Checking extracted data for consistency
- **Matching Engine**: Linking invoices to purchase orders

## Key Features

### Document Processing
- **PDF Support**: Direct PDF processing
- **Image Support**: JPG, PNG, TIFF formats
- **Multi-page**: Handles multi-page invoices
- **Preprocessing**: Automatic correction of skew, rotation, resolution
- **Language Support**: Multiple languages for OCR

### Data Extraction
- Invoice number and date
- Supplier information
- Tax identification numbers
- Line item details (product, quantity, price)
- Subtotal, tax, and total amounts
- Payment terms and due date
- Delivery information
- Notes and special instructions

### Quality Metrics
- Confidence scores for all extracted fields
- Field-level quality assessment
- Overall invoice quality score
- Suggestions for manual review

### Validation
- Arithmetic validation (quantity × price = total)
- Format validation (dates, numbers, phone numbers)
- Supplier verification against registered suppliers
- Product code validation
- Currency consistency

## Usage Examples

### Basic Scanning
```typescript
import { InvoiceScanner } from '@pharmstation/ai/invoice-scanner';

const scanner = new InvoiceScanner(apiKey);

// Scan from file
const invoice = await scanner.scanFile(invoiceFile);

// Scan from URL
const invoice = await scanner.scanUrl('https://example.com/invoice.pdf');

// Scan from base64
const invoice = await scanner.scanBase64(base64Data);
```

### Detailed Extraction
```typescript
const result = await scanner.extract(file, {
  includeLineItems: true,
  includeMetadata: true,
  validateArithmetic: true,
  matchSupplier: true
});

console.log({
  invoiceNumber: result.invoiceNumber,
  invoiceDate: result.invoiceDate,
  supplierName: result.supplierName,
  lineItems: [
    {
      productName: 'Paracetamol 500mg',
      quantity: 100,
      unitPrice: 2.50,
      total: 250.00,
      productCode: 'PARA-500',
      batchNumber: 'BATCH-001'
    }
  ],
  totals: {
    subtotal: result.subtotal,
    taxRate: result.taxRate,
    taxAmount: result.taxAmount,
    total: result.total
  },
  confidence: result.overallConfidence
});
```

### Processing with Purchase Order Matching
```typescript
const invoice = await scanner.extract(file);

// Match with purchase orders
const purchaseOrders = await fetchPurchaseOrders(invoice.supplierId);
const match = await scanner.matchWithPO(invoice, purchaseOrders);

// Results include:
// - Matched PO ID
// - Quantity discrepancies
// - Price discrepancies
// - Missing items
// - Extra items in invoice

if (match.discrepancies.length > 0) {
  console.log('Found discrepancies:', match.discrepancies);
  // Requires manual review
} else {
  // Can auto-process
  await autoCreateRPLog(invoice);
}
```

### Batch Processing
```typescript
// Process multiple invoices
const files = [invoice1, invoice2, invoice3];

const results = await scanner.processBatch(files, {
  parallel: true,
  maxConcurrent: 3,
  returnOnError: false
});

const { successful, failed } = results;

console.log(`Processed ${successful.length}, failed ${failed.length}`);
```

### Manual Correction Workflow
```typescript
const extracted = await scanner.extract(file);

// User makes corrections
const corrected = {
  ...extracted,
  invoiceNumber: 'INV-2024-001' // corrected value
};

// Learn from correction
await scanner.recordCorrection({
  original: extracted,
  corrected,
  field: 'invoiceNumber',
  confidence: extracted.invoiceNumberConfidence
});
```

## Output Structure

```typescript
interface ExtractedInvoice {
  // Header information
  invoiceNumber: string;
  invoiceNumberConfidence: number;
  
  invoiceDate: string; // ISO date
  invoiceDateConfidence: number;
  
  dueDate?: string;
  
  // Supplier information
  supplierId?: string;
  supplierName: string;
  supplierNameConfidence: number;
  
  supplierAddress?: string;
  supplierPhone?: string;
  supplierTaxId?: string;
  
  // Receiver information
  receiverName?: string;
  receiverAddress?: string;
  
  // Line items
  lineItems: {
    productName: string;
    productNameConfidence: number;
    
    productCode?: string;
    quantity: number;
    quantityConfidence: number;
    
    unitPrice: number;
    unitPriceConfidence: number;
    
    unit?: string; // e.g., "box", "bottle"
    batchNumber?: string;
    expiryDate?: string;
    
    total: number;
    notes?: string;
  }[];
  
  // Totals
  subtotal: number;
  taxRate?: number;
  taxAmount: number;
  total: number;
  
  currency?: string;
  
  // Quality metrics
  overallConfidence: number;
  fieldsWithLowConfidence: string[];
  requiresManualReview: boolean;
  
  // Processing metadata
  processedAt: string;
  processingTime: number;
  rawText?: string; // For debugging
}
```

## Configuration Options

```typescript
interface ScannerOptions {
  // Language settings
  language?: string; // 'en', 'es', 'fr', etc.
  
  // Quality thresholds
  minConfidence?: number; // Default: 0.75
  markLowConfidenceFields?: boolean;
  
  // Processing options
  validateArithmetic?: boolean;
  validateFormats?: boolean;
  extractLineItems?: boolean;
  
  // Matching
  matchSupplier?: boolean;
  matchPurchaseOrder?: boolean;
  
  // Output
  includeRawText?: boolean;
  includeProcessingMetadata?: boolean;
  
  // Processing
  async?: boolean;
  timeout?: number; // milliseconds
}
```

## Performance

- **Single invoice**: ~2-5 seconds (depending on complexity)
- **Batch processing**: ~1 second per invoice (with parallelization)
- **File size limits**: Up to 50MB
- **Page limit**: Tested up to 100 pages

## Error Handling

```typescript
import { InvoiceScanError, InvalidFormatError } from '@pharmstation/ai/invoice-scanner';

try {
  const result = await scanner.extract(file);
} catch (error) {
  if (error instanceof InvalidFormatError) {
    // File format not supported
  } else if (error instanceof InvoiceScanError) {
    // Extraction failed
    if (error.code === 'UNREADABLE_DOCUMENT') {
      // Document quality too poor
    } else if (error.code === 'UNSUPPORTED_FORMAT') {
      // Invoice format not recognized
    }
  }
}
```

## Testing

Mock implementations for development:

```typescript
import { createMockInvoiceScanner } from '@pharmstation/ai/invoice-scanner/testing';

const scanner = createMockInvoiceScanner();
const result = await scanner.extract(mockFile);
// Returns realistic test data
```

## Limitations & Known Issues

- Handwritten invoices have lower accuracy
- Complex layouts may require manual review
- Non-standard formats may not be recognized
- Confidence varies by invoice quality
- OCR accuracy depends on language support

## Related Documentation

- [AI Package Overview](../README.md)
- [Validation Rules](../../core/src/validation/README.md)
- [Supabase Integration](../../supabase-client/README.md)

## Best Practices

1. **Quality Check**: Always verify confidence scores
2. **Manual Review**: Mark low-confidence results for review
3. **Error Handling**: Handle extraction failures gracefully
4. **Batch Processing**: Use for multiple documents
5. **Learning**: Record corrections to improve accuracy
6. **Validation**: Validate extracted data against business rules
7. **Logging**: Log all extraction attempts for auditing
8. **Testing**: Test with representative invoice samples

## Contributing

When improving the scanner:
1. Test with various invoice formats
2. Document new field extractions
3. Update test fixtures
4. Measure accuracy improvements
5. Consider language support
6. Update error codes if needed

# Models

Core data models and TypeScript interfaces for PharmStation domain entities.

## Overview

This directory contains all the primary data models used throughout the PharmStation system. These models define the structure of critical pharmacy operations and are shared across all packages.

## What Goes Here

### CD Register (Central Dispensary Register)
The CD Register tracks all medications dispensed from the pharmacy. This is a critical legal and operational record.

**Key Fields:**
- Medication name and identification
- Quantity dispensed
- Unit price and total cost
- Date and time of dispensing
- Patient/Customer information
- Pharmacist details
- Batch numbers and expiry dates

### RP Log (Receiving & Procurement Log)
The RP Log records all incoming stock from suppliers.

**Key Fields:**
- Supplier information
- Product details (name, code, batch)
- Quantity received
- Date received
- Unit cost and total cost
- Invoice reference
- Expiry date
- Storage location

### POM (Prescription Only Medicine) Types
Definitions for controlled and prescription-only medications requiring special handling and documentation.

**Key Fields:**
- POM classification level
- Regulatory restrictions
- Storage requirements
- Documentation needed
- Patient consent requirements

## Key Responsibilities

1. **Data Structure Definition**: Provide TypeScript interfaces that match the Supabase database schema
2. **Type Safety**: Ensure compile-time type checking across the application
3. **Default Values**: Define sensible defaults for new instances
4. **Serialization**: Support JSON serialization for API calls and storage

## Usage Examples

### CD Register Entry
```typescript
import { CDRegisterEntry, createCDRegisterEntry } from '@pharmstation/core/models';

const entry = createCDRegisterEntry({
  productId: 'prod-001',
  productName: 'Paracetamol 500mg',
  quantity: 10,
  unitPrice: 2.50,
  patientName: 'John Doe',
  pharmacistId: 'pharm-001',
  notes: 'Customer purchase'
});
```

### RP Log Entry
```typescript
import { RPLogEntry, createRPLogEntry } from '@pharmstation/core/models';

const rpEntry = createRPLogEntry({
  supplierId: 'supplier-001',
  productId: 'prod-001',
  productName: 'Aspirin 100mg',
  quantity: 500,
  unitCost: 1.00,
  invoiceNumber: 'INV-2024-001',
  expiryDate: new Date('2025-12-31'),
  batchNumber: 'BATCH-001'
});
```

### POM Product Definition
```typescript
import { POMProduct, POMClassification } from '@pharmstation/core/models';

const pomProduct: POMProduct = {
  id: 'pom-001',
  name: 'Morphine 10mg',
  classification: POMClassification.HIGH_CONTROL,
  requiresPatientConsent: true,
  storageTempMin: 15,
  storageTempMax: 25,
  requiresLocking: true
};
```

## Type Safety

All models use TypeScript interfaces to provide:
- IntelliSense support in IDEs
- Compile-time type checking
- Clear documentation of expected data structure
- Type guards for runtime validation

## Validation

While this directory defines the **structure**, validation logic lives in `../validation/`. The models work together with validators to ensure data integrity.

## Database Schema Alignment

These models should match the Supabase database schema exactly:
- Field names must correspond to table columns
- Types must align with PostgreSQL column types
- Required fields must match NOT NULL constraints
- Enums must match database enum types

## Related Documentation

- [Validation Documentation](../validation/README.md)
- [Supabase Client Package](../../supabase-client/README.md)
- [Types Package](../../types/README.md)

## Contributing Guidelines

When adding new models:
1. Use TypeScript interfaces for definitions
2. Include JSDoc comments explaining each field
3. Create factory functions (e.g., `createCDRegisterEntry()`) for consistent object creation
4. Define validation constraints alongside the model
5. Keep models pure data structures (no methods except serialization)
6. Update this README with new model descriptions

## Examples

See test files and integration tests in the supabase-client package for real-world usage examples.

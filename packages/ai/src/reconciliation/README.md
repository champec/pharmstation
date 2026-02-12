# Reconciliation Assistant

AI-powered intelligent matching and reconciliation for purchase orders and received inventory.

## Overview

The Reconciliation Assistant automates the matching of ordered items with received items, automatically detects discrepancies, and suggests resolutions. It learns from historical patterns to improve accuracy and reduce manual reconciliation work.

## What Goes Here

This directory contains:

- **Smart Matching**: Intelligent linking of ordered vs. received items
- **Discrepancy Detection**: Finding quantity, price, and quality issues
- **Pattern Analysis**: Learning from historical reconciliation data
- **Suggestion Engine**: Recommending resolutions based on patterns
- **Auto-Reconciliation**: Automatically resolving simple discrepancies
- **Reporting**: Reconciliation analytics and insights

## Key Features

### Intelligent Matching
- **Product Matching**: Links ordered items to received items by product code, name, or description
- **Fuzzy Matching**: Handles slight name variations and typos
- **Batch Matching**: Matches items by batch number and expiry date
- **Quantity Grouping**: Handles split shipments (1 order, multiple deliveries)
- **Supplier Context**: Uses supplier history to improve matching

### Discrepancy Detection
- **Quantity Mismatches**: Detecting short/over shipments
- **Price Discrepancies**: Identifying pricing errors
- **Quality Issues**: Noting damaged or substandard items
- **Missing Items**: Finding items ordered but not received
- **Extra Items**: Identifying unexpected items in shipment
- **Date Issues**: Detecting expired or near-expiry items

### Pattern Recognition
- **Supplier Patterns**: Tracks common issues with each supplier
- **Product Patterns**: Identifies products with frequent discrepancies
- **Seasonal Patterns**: Recognizes patterns across time periods
- **Historical Context**: Uses past reconciliation data
- **Outlier Detection**: Identifies unusual situations

### Smart Suggestions
- **Auto-Resolution Options**: Proposes solutions based on patterns
- **Confidence Scoring**: Indicates reliability of suggestions
- **Precedent Finding**: Shows similar past cases
- **Risk Assessment**: Warns about risky resolutions
- **Workflow Guidance**: Suggests next steps

## Usage Examples

### Analyzing Discrepancies
```typescript
import { ReconciliationAssistant } from '@pharmstation/ai/reconciliation';

const assistant = new ReconciliationAssistant(apiKey);

// Prepare data
const purchaseOrder = {
  id: 'PO-2024-001',
  items: [
    { productId: 'prod-001', productName: 'Aspirin 100mg', quantity: 1000, unitPrice: 1.50 },
    { productId: 'prod-002', productName: 'Ibuprofen 200mg', quantity: 500, unitPrice: 2.00 }
  ]
};

const receivedItems = [
  { productId: 'prod-001', productName: 'Aspirin 100mg', quantity: 950, batchNumber: 'BATCH-001' },
  { productId: 'prod-002', productName: 'Ibuprofen 200mg', quantity: 500, batchNumber: 'BATCH-002' },
  { productId: 'prod-003', productName: 'Vitamin C 500mg', quantity: 100, batchNumber: 'BATCH-003' }
];

// Analyze discrepancies
const analysis = await assistant.analyzeDiscrepancies(purchaseOrder, receivedItems);

console.log(analysis);
// {
//   matches: [
//     { orderedItem: ..., receivedItem: ..., exactMatch: true }
//   ],
//   discrepancies: [
//     {
//       type: 'quantity_mismatch',
//       orderedItem: { productId: 'prod-001', quantity: 1000 },
//       receivedItem: { productId: 'prod-001', quantity: 950 },
//       severity: 'medium',
//       shortage: 50,
//       financialImpact: 75.00,
//       confidence: 0.99
//     }
//   ],
//   extraItems: [
//     {
//       product: 'Vitamin C 500mg',
//       quantity: 100,
//       action: 'verify_with_supplier'
//     }
//   ],
//   summary: {
//     matchedItems: 2,
//     discrepancies: 1,
//     extraItems: 1,
//     totalImpact: 75.00,
//     requiresManualReview: false
//   }
// }
```

### Getting Suggested Resolutions
```typescript
// Get AI suggestions for resolution
const suggestions = await assistant.suggestResolutions(analysis, {
  suppressionThreshold: 0.1, // Ignore < 10% discrepancies
  autoResolveLowRisk: false // Don't auto-resolve yet
});

console.log(suggestions);
// {
//   recommendations: [
//     {
//       discrepancy: { type: 'quantity_mismatch', ... },
//       suggestion: 'Contact supplier regarding short shipment',
//       confidence: 0.95,
//       rationale: 'This supplier consistently ships 95% of ordered quantity',
//       historicalPrecedent: {
//         similarCases: 5,
//         successRate: 0.96,
//         averageResolutionTime: '3 days'
//       },
//       proposedActions: [
//         { action: 'send_invoice_inquiry', supplier: 'supplier-001' },
//         { action: 'create_debit_memo', amount: 75.00 },
//         { action: 'create_replacement_po', quantity: 50 }
//       ]
//     }
//   ],
//   riskAnalysis: {
//     acceptanceRisk: 'low',
//     returnRisk: 'very_low',
//     liabilityRisk: 'none'
//   }
// }
```

### Auto-Reconciliation
```typescript
// Automatically reconcile items with high confidence
const result = await assistant.autoReconcile(analysis, {
  minConfidence: 0.95,
  autoResolveThreshold: 0.05, // Auto-resolve < 5% discrepancies
  maxAutoResolveAmount: 1000 // Don't auto-resolve > $1000
});

console.log(result);
// {
//   autoResolved: 1,
//   requiresReview: 1,
//   couldNotMatch: 0,
//   results: [
//     {
//       discrepancy: ...,
//       resolution: 'ACCEPTED_SHORT_SHIPMENT',
//       action: 'CREATE_DEBIT_MEMO',
//       amount: 75.00,
//       confidence: 0.95,
//       rationale: 'Acceptable shortage based on historical pattern'
//     }
//   ]
// }
```

### Learning from Resolutions
```typescript
// Record how discrepancies were actually resolved
await assistant.recordResolution({
  poId: 'PO-2024-001',
  discrepancies: analysis.discrepancies,
  userResolutions: [
    {
      discrepancy: { type: 'quantity_mismatch', shortage: 50 },
      resolution: 'ACCEPTED_SHORT_SHIPMENT',
      actualAction: 'DEBIT_MEMO',
      notes: 'Supplier explanation: transportation damage'
    }
  ],
  outcome: 'resolved',
  timeToResolve: 120 // minutes
});

// Genie learns from this and improves future suggestions
```

### Supplier Analysis
```typescript
// Get supplier performance metrics
const supplierMetrics = await assistant.getSupplierMetrics('supplier-001');

console.log(supplierMetrics);
// {
//   supplierName: 'ABC Pharmaceuticals',
//   totalOrders: 150,
//   completedOrders: 148,
//   averageCompletionRate: 0.987,
//   commonIssues: [
//     { type: 'quantity_short', frequency: 0.12, avgAmount: 2.3 },
//     { type: 'price_variance', frequency: 0.05, avgAmount: 0.8 }
//   ],
//   averageResolutionTime: 2.3, // days
//   trustScore: 0.92,
//   recommendation: 'TRUSTED - Consider auto-resolving short shipments up to 2%'
// }
```

### Product Analysis
```typescript
// Get product-specific reconciliation insights
const productAnalysis = await assistant.getProductAnalysis('prod-001');

console.log(productAnalysis);
// {
//   productName: 'Aspirin 100mg',
//   totalOrderedQuantity: 50000,
//   totalReceivedQuantity: 49500,
//   averageCompletion: 0.99,
//   discrepancyPatterns: [
//     { type: 'quantity', avgAmount: 10, frequency: 0.05 }
//   ],
//   qualityIssues: 0,
//   recommendation: 'Generally reliable, small quantity variances are normal'
// }
```

### Batch Reconciliation
```typescript
// Reconcile multiple purchase orders at once
const poIds = ['PO-2024-001', 'PO-2024-002', 'PO-2024-003'];
const batchResults = await assistant.reconcileBatch(poIds, {
  parallel: true,
  autoResolve: true,
  minAutoResolveConfidence: 0.95
});

console.log(batchResults);
// {
//   processed: 3,
//   fullyResolved: 2,
//   needsReview: 1,
//   totalTime: 45, // seconds
//   summary: {
//     matchedItems: 285,
//     discrepancies: 3,
//     autoResolved: 2,
//     pendingreview: 1
//   }
// }
```

## Data Structures

### Discrepancy Model
```typescript
interface Discrepancy {
  id: string;
  type: DiscrepancyType; // 'quantity_mismatch', 'price_variance', etc.
  severity: 'critical' | 'high' | 'medium' | 'low';
  
  // Ordered vs received
  orderedItem: LineItem;
  receivedItem: LineItem;
  
  // The difference
  difference: {
    quantity?: number;
    price?: number;
    quality?: string;
  };
  
  // Impact
  financialImpact: number;
  inventoryImpact: number;
  
  // AI assessment
  confidence: number; // How sure we are about this discrepancy
  matchConfidence: number; // How sure we are about the match
  
  // Resolution
  suggestedResolution?: string;
  historyPattern?: string;
}
```

### Analysis Result
```typescript
interface ReconciliationAnalysis {
  poId: string;
  analysisTime: string;
  
  // Results
  matches: MatchedItem[];
  discrepancies: Discrepancy[];
  extraItems: ExtraItem[];
  missingItems: MissingItem[];
  
  // Metrics
  matchRate: number;
  discrepancyRate: number;
  totalItems: number;
  resolvedItems: number;
  
  // Summary
  summary: {
    totalImpact: number;
    requiresManualReview: boolean;
    estimatedResolutionTime: number; // minutes
  };
  
  // Confidence
  overallConfidence: number;
}
```

## Configuration

```typescript
interface ReconciliationConfig {
  // Matching
  useProductCode?: boolean;
  useBatchNumber?: boolean;
  fuzzyMatchThreshold?: number; // 0-1, default 0.85
  
  // Discrepancy Detection
  quantityTolerance?: number; // percentage, default 0.05 (5%)
  priceTolerance?: number; // percentage, default 0.02 (2%)
  
  // Auto-Resolution
  autoResolve?: boolean;
  minAutoResolveConfidence?: number; // default 0.95
  maxAutoResolveAmount?: number; // dollar amount
  
  // Learning
  enableLearning?: boolean;
  useHistoricalPatterns?: boolean;
  
  // Output
  includeMetrics?: boolean;
  includeSuggestions?: boolean;
}
```

## Error Handling

```typescript
import {
  ReconciliationError,
  NoMatchError,
  AnalysisError
} from '@pharmstation/ai/reconciliation';

try {
  const analysis = await assistant.analyzeDiscrepancies(po, received);
} catch (error) {
  if (error instanceof NoMatchError) {
    // Could not match received items to order
    console.log('No matches found - verify supplier information');
  } else if (error instanceof AnalysisError) {
    // Analysis failed
    console.log('Could not analyze discrepancies:', error.message);
  } else if (error instanceof ReconciliationError) {
    console.log('Reconciliation error:', error.message);
  }
}
```

## Analytics & Reporting

```typescript
// Get reconciliation statistics
const stats = await assistant.getStatistics({
  pharmacyId: 'pharm-001',
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-01-31')
});

console.log({
  totalReconciliations: stats.totalReconciliations,
  averageTimePerReconciliation: stats.avgTime,
  autoResolveRate: stats.autoResolveRate,
  manualReviewRate: stats.manualReviewRate,
  discrepancyRate: stats.discrepancyRate,
  averageFinancialImpact: stats.avgImpact,
  topSupplierIssues: stats.supplierIssues,
  topProductIssues: stats.productIssues
});
```

## Testing

Mock implementation for testing:

```typescript
import { createMockReconciliationAssistant } from '@pharmstation/ai/reconciliation/testing';

const assistant = createMockReconciliationAssistant();
const analysis = await assistant.analyzeDiscrepancies(mockPO, mockReceived);
```

## Best Practices

1. **Trust Levels**: Start with suggestions, work up to auto-resolution
2. **Validation**: Always validate auto-resolved discrepancies
3. **Learning**: Record actual resolutions to improve suggestions
4. **Monitoring**: Track accuracy of AI suggestions
5. **Review**: Manual review of critical/expensive items
6. **Supplier Relations**: Consider supplier history in decisions
7. **Documentation**: Keep audit trail of all resolutions
8. **Updates**: Regularly update supplier/product data

## Related Documentation

- [AI Package Overview](../README.md)
- [Invoice Scanner](../invoice-scanner/README.md)
- [Core Validation](../../core/src/validation/README.md)
- [Supabase Integration](../../supabase-client/README.md)

## Limitations

- Requires accurate product identifiers
- Performance depends on data quality
- May struggle with very similar products
- Limited to pattern matching with sufficient history
- Requires human oversight for critical decisions

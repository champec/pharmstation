# Genie Chatbot

Intelligent conversational AI assistant for PharmStation users.

## Overview

Genie is an intelligent chatbot that uses natural language understanding to assist pharmacy staff with common tasks, queries, and operations. It can answer questions about inventory, help with order processing, provide dosage information, and escalate complex issues to human agents.

## What Goes Here

This directory contains:

- **Intent Recognition**: Understanding user queries and intent
- **Entity Extraction**: Identifying key data in user messages
- **Context Management**: Maintaining conversation state
- **Response Generation**: Creating natural language responses
- **Action Execution**: Performing system actions based on intents
- **Human Escalation**: Routing complex issues to staff

## Key Features

### Natural Language Understanding
- **Intent Classification**: Determines what the user wants
- **Entity Recognition**: Extracts important information (drugs, quantities, dates)
- **Context Awareness**: Remembers previous messages in conversation
- **Confidence Scoring**: Indicates reliability of understanding
- **Multiple Languages**: Supports pharmacy staff in different regions

### Supported Intents
- **Inventory Queries**: "What's our stock of Aspirin?"
- **Order Management**: "Create a purchase order for..."
- **Dosage Lookup**: "What's the correct dosage for a 10-year-old?"
- **Drug Information**: "Tell me about side effects of..."
- **Alerts**: "What items are expiring soon?"
- **Transactions**: "Show me today's sales"
- **Help**: "How do I process an invoice?"

### Smart Actions
- Automatically fetches relevant data
- Generates suggested actions
- Provides quick action buttons
- Remembers user preferences
- Learns from interactions

### Integration
- Connected to all PharmStation systems
- Real-time access to inventory and sales
- Can create, read, update operations
- Escalates to appropriate department

## Usage Examples

### Starting a Conversation
```typescript
import { GenieBot } from '@pharmstation/ai/genie';

const genie = new GenieBot(apiKey);

// Create new conversation
const conversation = await genie.createConversation({
  userId: 'user-001',
  pharmacyId: 'pharm-001',
  context: {
    userRole: 'pharmacist',
    language: 'en'
  }
});
```

### Simple Queries
```typescript
// Ask about inventory
const response1 = await conversation.message('What is our stock of Paracetamol 500mg?');
// Response: "You have 250 units in stock, with 100 more arriving tomorrow."

// Ask about expiry
const response2 = await conversation.message('Show me items expiring this month');
// Response: "Found 5 items expiring in January: [list with quick-view buttons]"

// Ask about orders
const response3 = await conversation.message('Create a purchase order for 500 units of Aspirin');
// Response: "I'll help you create an order. Let me suggest suppliers... [options]"
```

### Detailed Conversation
```typescript
// Complex interaction
const response = await conversation.message('A customer came in looking for something for a 5-year-old with a fever');

// Genie understands:
// - Intent: medication recommendation
// - Context: pediatric patient
// - Symptom: fever
// - Returns: relevant products with dosing information

console.log(response);
// {
//   message: "For pediatric fever, we have several options:",
//   suggestions: [
//     { product: "Ibuprofen Suspension", indication: "Children 6mo+", dose: "10mg/kg" },
//     { product: "Paracetamol Suspension", indication: "Children 2mo+", dose: "15mg/kg" }
//   ],
//   warnings: ["Check for allergies", "Verify parent consent"],
//   actions: ["View product details", "Check stock", "Create sale"]
// }
```

### Multi-turn Conversation
```typescript
// First turn
const q1 = await conversation.message('Show me low stock items');
// Response lists low stock items

// Follow-up
const q2 = await conversation.message('Create orders for all of them');
// Response: "I'll create orders for 8 items. Should I use our preferred suppliers?"

// Continue
const q3 = await conversation.message('Yes, the preferred ones please');
// Response: "Creating orders... [shows progress] Done! 8 orders created."
```

### Complex Task Assistance
```typescript
// Help with reconciliation
const message = "I have an invoice from ABC Pharmaceuticals for 200 Aspirin tablets at $2.50 each but we only received 180 tablets";

const response = await conversation.message(message);
// Genie understands:
// - Supplier: ABC Pharmaceuticals
// - Product: Aspirin
// - Discrepancy: quantity mismatch (200 vs 180)
// - Financial impact: $50 difference

console.log(response);
// {
//   message: "I found a discrepancy. Let me help you resolve it.",
//   discrepancy: {
//     type: "quantity_short",
//     orderedQuantity: 200,
//     receivedQuantity: 180,
//     shortage: 20,
//     financialImpact: 50
//   },
//   suggestedActions: [
//     { action: "Contact supplier", info: "Report short shipment" },
//     { action: "Create debit memo", info: "Adjust payment" },
//     { action: "Create purchase order", info: "Reorder missing quantity" }
//   ]
// }
```

### Escalation to Human
```typescript
const message = "The customer is asking about a serious drug interaction with their existing medications";

const response = await conversation.message(message);
// Genie recognizes this is critical

console.log(response);
// {
//   message: "This requires immediate pharmacist review. Connecting you now...",
//   escalated: true,
//   assignedTo: "pharm-002", // Available pharmacist
//   priority: "high",
//   transferInfo: { agent: "Dr. Smith", phone: "555-0123" }
// }
```

## Intent Types

```typescript
enum Intent {
  // Inventory
  CHECK_STOCK = 'check_stock',
  LOW_STOCK_ALERT = 'low_stock_alert',
  EXPIRY_CHECK = 'expiry_check',
  
  // Ordering
  CREATE_PURCHASE_ORDER = 'create_purchase_order',
  VIEW_ORDERS = 'view_orders',
  TRACK_ORDER = 'track_order',
  
  // Transactions
  PROCESS_SALE = 'process_sale',
  PROCESS_RETURN = 'process_return',
  VIEW_SALES = 'view_sales',
  
  // Medication Info
  DOSAGE_LOOKUP = 'dosage_lookup',
  DRUG_INFO = 'drug_info',
  SIDE_EFFECTS = 'side_effects',
  INTERACTIONS_CHECK = 'interactions_check',
  CONTRAINDICATIONS = 'contraindications',
  
  // Reconciliation
  MATCH_INVOICE = 'match_invoice',
  RESOLVE_DISCREPANCY = 'resolve_discrepancy',
  
  // Help
  HELP_REQUEST = 'help_request',
  PROCESS_HELP = 'process_help',
  
  // Escalation
  ESCALATE = 'escalate',
  
  // Other
  UNKNOWN = 'unknown'
}
```

## Response Format

```typescript
interface GenieResponse {
  // The main message
  message: string;
  
  // Identified intent and confidence
  intent: Intent;
  confidence: number;
  
  // Extracted entities
  entities: {
    productName?: string;
    quantity?: number;
    date?: string;
    supplier?: string;
    [key: string]: any;
  };
  
  // Suggested actions for user
  suggestedActions: {
    label: string;
    action: string;
    icon?: string;
    priority?: 'high' | 'normal' | 'low';
  }[];
  
  // Data/recommendations
  data?: {
    items?: any[];
    summary?: string;
    warnings?: string[];
  };
  
  // Whether escalation is needed
  escalated?: boolean;
  escalationReason?: string;
  escalatedTo?: string;
  
  // Conversation continuation
  followUpSuggestions?: string[];
  contextId?: string;
}
```

## Configuration

```typescript
interface GenieConfig {
  // API settings
  apiKey: string;
  
  // Model settings
  model?: 'gpt-4' | 'gpt-3.5-turbo' | 'claude';
  temperature?: number; // 0-1, default 0.7
  maxTokens?: number; // default 1000
  
  // Features
  enableEscalation?: boolean;
  enableLearning?: boolean;
  enableActionExecution?: boolean;
  
  // Language
  language?: string; // default 'en'
  
  // Behavior
  minConfidence?: number; // default 0.6
  askForConfirmation?: boolean; // for actions
  
  // Context
  contextWindow?: number; // messages to remember (default 10)
  contextTTL?: number; // time to live in seconds
  
  // Logging
  logInteractions?: boolean;
  logMetrics?: boolean;
}
```

## Learning from Interactions

```typescript
// Genie learns to improve responses
await conversation.recordInteraction({
  userMessage: 'What should we order?',
  genieResponse: originalResponse,
  userAction: 'created_order',
  outcome: 'successful',
  feedback: 'helpful'
});

// Over time, Genie's responses improve based on patterns
```

## Error Handling

```typescript
import { GenieError, UnderstandingError, EscalationError } from '@pharmstation/ai/genie';

try {
  const response = await conversation.message(userInput);
} catch (error) {
  if (error instanceof UnderstandingError) {
    // Couldn't understand the query
    console.log('Could you rephrase that?');
  } else if (error instanceof EscalationError) {
    // Failed to escalate to human
    console.log('Unable to reach an agent');
  } else if (error instanceof GenieError) {
    // Other Genie error
    console.log('Something went wrong:', error.message);
  }
}
```

## Analytics & Reporting

```typescript
// Get conversation analytics
const analytics = await genie.getAnalytics({
  pharmacyId: 'pharm-001',
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-01-31')
});

console.log({
  totalConversations: analytics.totalConversations,
  averageMessagesPerConversation: analytics.avgMessages,
  intentDistribution: analytics.intents,
  escalationRate: analytics.escalations / analytics.totalConversations,
  userSatisfaction: analytics.avgSatisfaction
});
```

## Privacy & Security

- No user PII stored without consent
- Conversations encrypted in transit
- Audit logging of all interactions
- HIPAA compliant
- Data retention policies enforced

## Testing

Mock Genie for testing:

```typescript
import { createMockGenieBot } from '@pharmstation/ai/genie/testing';

const genie = createMockGenieBot();
const response = await genie.createConversation(...);
// Returns realistic test conversations
```

## Limitations

- Limited to English, Spanish, French (currently)
- May not understand very complex queries
- Requires good context setup for accuracy
- Not suitable for emergency medical advice
- Escalation requires available human agents

## Related Documentation

- [AI Package Overview](../README.md)
- [Prescription Scanner](../prescription/README.md)
- [Reconciliation Assistant](../reconciliation/README.md)

## Best Practices

1. **Provide Context**: Give Genie relevant context at conversation start
2. **Be Specific**: More specific queries get better results
3. **Verify Important Actions**: Confirm before executing major operations
4. **Escalate When Needed**: Don't force Genie to handle critical issues
5. **Feedback**: Help Genie learn by providing feedback on responses
6. **Monitor**: Track Genie's performance and accuracy
7. **Update**: Keep drug databases and product info current
8. **Testing**: Test new capabilities with real users

## Conversation Examples

### Example 1: Quick Lookup
```
User: "Do we have Ibuprofen 200mg in stock?"
Genie: "Yes, we have 500 units in stock."
User: "How much do we have at the branch?"
Genie: "The branch location has 150 units."
```

### Example 2: Complex Task
```
User: "Help me process this invoice from ABC Pharma"
Genie: "I can help with that. Do you have the invoice file?"
User: "Yeah, let me send the image" [uploads image]
Genie: "Got it! I've extracted the following: [details]. Does this look right?"
User: "Yes, all correct"
Genie: "Great! The invoice matches PO #1234. Shall I process it?"
User: "Yes please"
Genie: "Done! RP Log entry created. Anything else?"
```

## Contributing

When extending Genie:
1. Add new intents with clear definitions
2. Train with representative examples
3. Test extensively with staff
4. Monitor accuracy metrics
5. Update documentation
6. Collect user feedback
7. Iterate on responses

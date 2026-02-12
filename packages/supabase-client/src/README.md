# Supabase Client Integration

Database queries, authentication handlers, and realtime subscriptions for PharmStation.

## Overview

This directory contains all the integration code for Supabase, including:
- Database query builders and executors
- Authentication and authorization handlers
- Real-time subscription management
- Cloud storage operations
- Admin and batch operations

## What Goes Here

### Database Queries
- Pre-built queries for all tables
- Type-safe query builders
- Pagination helpers
- Filter and search utilities
- Transaction management
- Aggregation queries

### Authentication
- User registration and login
- Session management
- Email verification
- Password reset flows
- Role-based access control
- Token handling

### Real-time Features
- Broadcast subscriptions
- Presence tracking
- Change notifications
- Collaborative updates
- Messaging channels

### Storage Operations
- File uploads and downloads
- Image processing
- Document management
- Access control
- URL signing and sharing

## Key Query Categories

### CD Register Queries
```typescript
// List entries with filters
await client.cdRegister.list({ 
  pharmacyId: 'pharm-001',
  dateFrom: new Date('2024-01-01'),
  dateTo: new Date('2024-01-31'),
  limit: 100
});

// Get single entry with related data
const entry = await client.cdRegister.getWithDetails(entryId);

// Create entry
await client.cdRegister.create(data);

// Batch operations
await client.cdRegister.createBatch(entriesArray);
```

### RP Log Queries
```typescript
// Get receiving log entries
const entries = await client.rpLog.list({
  supplierId: 'supplier-001'
});

// Get supplies by date range
const supplies = await client.rpLog.listByDateRange(
  new Date('2024-01-01'),
  new Date('2024-01-31')
);
```

### Product Queries
```typescript
// Search products
const products = await client.products.search(query);

// Get expiry warnings
const soonExpiring = await client.products.getExpiryWarnings(days: 30);

// Get low stock alerts
const lowStock = await client.products.getLowStockItems();
```

### Inventory Queries
```typescript
// Get inventory levels
const inventory = await client.inventory.getByPharmacy(pharmacyId);

// Track stock movements
const history = await client.inventory.getHistory(productId);
```

## Authentication Flows

### Sign Up
```typescript
const { user, session, error } = await auth.signup({
  email: 'user@pharmacy.com',
  password: 'securePassword',
  userData: {
    firstName: 'John',
    lastName: 'Pharmacist',
    pharmacyId: 'pharm-001',
    role: 'pharmacist'
  }
});
```

### Sign In
```typescript
const { session, user, error } = await auth.signin({
  email: 'user@pharmacy.com',
  password: 'securePassword'
});
```

### Refresh Session
```typescript
const { session, error } = await auth.refreshSession();
```

### Sign Out
```typescript
await auth.signout();
```

## Real-time Subscriptions

### Table Changes
```typescript
realtime.on('cd_register', (payload) => {
  // Handle: INSERT, UPDATE, DELETE
}, filter);
```

### Presence
```typescript
const presence = realtime.onPresence('cd_register', (users) => {
  console.log('Active users:', users);
});
```

### Broadcast Messages
```typescript
realtime.broadcast('notifications', {
  type: 'inventory_alert',
  message: 'Low stock warning'
});
```

## Error Handling

All queries handle errors gracefully:

```typescript
try {
  const data = await client.cdRegister.list();
} catch (error) {
  if (error.code === 'PGRST116') {
    // Not found
  } else if (error.code === 'PGJWT') {
    // Auth error
  } else if (error.code === '42P01') {
    // Table doesn't exist
  }
}
```

## Performance Optimization

### Pagination
```typescript
const { data, count, hasMore } = await client.cdRegister.list({
  limit: 20,
  offset: 0
});
```

### Filtering
```typescript
const filtered = await client.cdRegister.list({
  filters: {
    pharmacyId: 'pharm-001',
    status: 'active'
  }
});
```

### Searching
```typescript
const results = await client.cdRegister.search({
  query: 'Aspirin',
  fields: ['productName', 'notes']
});
```

## Type Definitions

All queries are fully typed:

```typescript
interface CDRegisterQuery {
  pharmacyId: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}

interface CDRegisterEntry {
  id: string;
  pharmacyId: string;
  productId: string;
  // ... other fields
}
```

## Transaction Management

For multi-step operations:

```typescript
const transaction = await client.transaction();
try {
  await transaction.cdRegister.create(entry1);
  await transaction.rpLog.create(entry2);
  await transaction.commit();
} catch (error) {
  await transaction.rollback();
}
```

## Testing Utilities

Mock data and test helpers:

```typescript
import { createMockClient, mockData } from '@pharmstation/supabase-client/testing';

const client = createMockClient();
client.cdRegister.mockList(mockData.cdRegisterEntries);
```

## Related Documentation

- [Supabase Documentation](https://supabase.com/docs)
- [Core Package Models](../core/src/models/README.md)
- [Validation Rules](../core/src/validation/README.md)
- [Types Package](../types/README.md)

## Common Patterns

### Fetch with Related Data
```typescript
const entryWithDetails = await client.cdRegister
  .select('*, product:products(*), user:users(*)')
  .eq('id', entryId)
  .single();
```

### Filter with Multiple Conditions
```typescript
const entries = await client.cdRegister
  .gte('createdAt', dateFrom)
  .lte('createdAt', dateTo)
  .eq('pharmacyId', pharmacyId)
  .order('createdAt', { ascending: false })
  .limit(100);
```

### Aggregate Data
```typescript
const stats = await client.cdRegister
  .aggregate('count', 'id', 'quantity:sum')
  .eq('pharmacyId', pharmacyId)
  .groupBy('date');
```

## Contributing Guidelines

When adding new queries:
1. Match existing naming conventions
2. Include comprehensive error handling
3. Add TypeScript type definitions
4. Write integration tests
5. Document with JSDoc comments
6. Consider pagination for large datasets
7. Update this README
8. Add to test utilities

## Best Practices

1. **Type Safety**: Use TypeScript for all queries
2. **Error Handling**: Handle all possible error cases
3. **Performance**: Use pagination and filters
4. **Security**: Respect RLS policies
5. **Testing**: Write integration tests
6. **Monitoring**: Log important operations
7. **Documentation**: Keep examples current

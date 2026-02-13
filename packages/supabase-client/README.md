# @pharmstation/supabase-client

Supabase client wrapper providing queries, authentication, and realtime features for PharmStation.

## Overview

This package wraps the Supabase JavaScript client and provides a clean, type-safe interface for interacting with the PharmStation backend. It abstracts common patterns and provides reusable queries for all database operations.

## What Goes Here

This package includes:

- **Database Queries**: Pre-built, typed queries for all tables
- **Authentication**: Supabase Auth integration and user management
- **Realtime Subscriptions**: Real-time updates for collaborative features
- **File Storage**: Cloud storage operations for documents and images
- **Admin Operations**: Bulk operations and administrative tasks

## Key Features & Responsibilities

### Database Queries (`src/queries/`)
- **CD Register Queries**: Create, read, update, delete dispensary entries
- **RP Log Queries**: Receiving and procurement operations
- **Product Queries**: Product catalog and inventory
- **User Queries**: User management and profiles
- **Transaction Queries**: Complex multi-table operations

### Authentication (`src/auth/`)
- User sign-up and sign-in
- Password reset and email verification
- Session management
- Role-based access control
- Token refresh and expiration handling
- Multi-factor authentication setup

### Realtime (`src/realtime/`)
- Subscription management
- Real-time sync for collaborative editing
- Presence tracking
- Change notifications
- Broadcast channels for messaging

### Storage (`src/storage/`)
- File upload and download
- Image optimization
- Document storage
- Batch file operations
- Access control and signing

## Usage Examples

### Database Operations
```typescript
import { createSupabaseClient } from '@pharmstation/supabase-client';

const client = createSupabaseClient(supabaseUrl, supabaseKey);

// Fetch CD Register entries
const entries = await client.cdRegister.list({ limit: 100 });

// Create a new entry
const newEntry = await client.cdRegister.create({
  productId: 'prod-001',
  quantity: 10,
  // ... other fields
});

// Update an entry
const updated = await client.cdRegister.update(entryId, {
  quantity: 15,
  notes: 'Updated quantity'
});

// Delete an entry
await client.cdRegister.delete(entryId);
```

### Authentication
```typescript
import { createAuthClient } from '@pharmstation/supabase-client/auth';

const auth = createAuthClient(supabaseClient);

// Sign up
const { user, session } = await auth.signup({
  email: 'user@example.com',
  password: 'securePassword123',
  metadata: { pharmacyId: 'pharm-001' }
});

// Sign in
const { session } = await auth.signin({
  email: 'user@example.com',
  password: 'securePassword123'
});

// Get current user
const user = await auth.getCurrentUser();

// Sign out
await auth.signout();

// Reset password
await auth.resetPassword('user@example.com');
```

### Realtime Subscriptions
```typescript
import { createRealtimeClient } from '@pharmstation/supabase-client/realtime';

const realtime = createRealtimeClient(supabaseClient);

// Subscribe to CD Register changes
realtime.subscribe('cd_register', (event) => {
  if (event.type === 'INSERT') {
    console.log('New entry:', event.new);
  } else if (event.type === 'UPDATE') {
    console.log('Updated entry:', event.new);
  } else if (event.type === 'DELETE') {
    console.log('Deleted entry:', event.old);
  }
});

// Subscribe with filters
realtime.subscribe('cd_register', {
  filter: { pharmacyId: 'pharm-001' }
}, (event) => {
  // Handle events for specific pharmacy
});

// Presence tracking
realtime.subscribePresence('cd_register', (users) => {
  console.log('Users viewing:', users);
});

// Unsubscribe when done
realtime.unsubscribe('cd_register');
```

### File Storage
```typescript
import { createStorageClient } from '@pharmstation/supabase-client/storage';

const storage = createStorageClient(supabaseClient);

// Upload a file
const { path, fullPath } = await storage.upload('documents', {
  file: fileBlob,
  filename: 'invoice.pdf',
  metadata: { entryId: 'entry-001' }
});

// Download a file
const fileBlob = await storage.download('documents', 'invoice.pdf');

// Delete a file
await storage.delete('documents', 'invoice.pdf');

// Generate signed URL (for sharing)
const signedUrl = await storage.getSignedUrl('documents', 'invoice.pdf', {
  expiresIn: 3600 // 1 hour
});

// List files in bucket
const files = await storage.list('documents', {
  limit: 50,
  offset: 0
});
```

## Database Schema Integration

This package is tightly integrated with the Supabase schema:

### Tables
- `cd_register` - Central Dispensary Register
- `rp_log` - Receiving & Procurement Log
- `products` - Product catalog
- `users` - User accounts and profiles
- `entries` - Generic entry table
- `inventory` - Stock levels

### Functions
- `calculate_expiry_warning()` - Get products near expiry
- `get_low_stock_products()` - Inventory alerts
- `generate_reports()` - Report generation

### Views
- `cd_register_with_details` - Enriched CD Register view
- `inventory_summary` - Aggregated inventory view
- `user_permissions` - User access control

## Tech Stack

- **Supabase JavaScript Client**: @supabase/supabase-js
- **TypeScript**: Type-safe queries
- **Real-time Engine**: Supabase Realtime
- **Storage**: Supabase Storage (built on S3)
- **Database**: PostgreSQL via Supabase

## Directory Structure

```
packages/supabase-client/
├── README.md
├── package.json
├── src/
│   ├── index.ts              # Main client export
│   ├── queries/              # Database queries
│   ├── auth/                 # Authentication
│   ├── realtime/             # Real-time subscriptions
│   ├── storage/              # File storage
│   └── types/                # Type definitions
├── dist/                     # Compiled JavaScript (generated)
└── tsconfig.json             # TypeScript configuration
```

## Error Handling

All operations include proper error handling:

```typescript
import { SupabaseError } from '@pharmstation/supabase-client';

try {
  const entries = await client.cdRegister.list();
} catch (error) {
  if (error instanceof SupabaseError) {
    if (error.code === 'PGRST116') {
      // Not found error
    } else if (error.code === 'PGJWT') {
      // Authentication error
    } else {
      // Other database error
    }
  }
}
```

## Connection Management

```typescript
import { createSupabaseClient } from '@pharmstation/supabase-client';

// Client is a singleton in most cases
const client = createSupabaseClient(url, key);

// Check connection status
const isConnected = await client.health.check();

// Reconnect if needed
await client.health.reconnect();
```

## Related Documentation

- [Core Package](../core/README.md)
- [Models Documentation](../core/src/models/README.md)
- [Types Package](../types/README.md)
- [Supabase Documentation](https://supabase.com/docs)

## Environment Configuration

Required environment variables:

```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Testing

Includes test utilities for mocking Supabase:

```typescript
import { createMockSupabaseClient } from '@pharmstation/supabase-client/testing';

const mockClient = createMockSupabaseClient();
// Use in tests without hitting real database
```

## Performance Considerations

- Queries use appropriate pagination
- Indexes on frequently queried fields
- Caching for frequently accessed data
- Connection pooling for multiple instances
- Lazy loading of realtime subscriptions

## Contributing Guidelines

When adding queries:
1. Keep queries focused on single operations
2. Use TypeScript for full type safety
3. Include error handling
4. Add JSDoc comments
5. Write integration tests
6. Document any schema dependencies
7. Consider pagination for large result sets
8. Update this README with new features

## Best Practices

1. **Type Safety**: Always use TypeScript types
2. **Error Handling**: Handle all possible errors
3. **Performance**: Use appropriate pagination and filters
4. **Security**: Respect Row Level Security (RLS) policies
5. **Monitoring**: Log important operations
6. **Testing**: Write integration tests
7. **Documentation**: Keep docs up to date

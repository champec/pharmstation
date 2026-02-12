# Sync Engine

Offline-first synchronization engine for handling network disconnections and data consistency.

## Overview

The Sync Engine is a critical component that enables PharmStation to work reliably in environments with unreliable network connectivity. It provides automatic offline data queuing, background synchronization, and conflict resolution strategies.

## What Goes Here

### Sync Queue Management
- Persistent queue for pending operations
- Operation prioritization
- Retry logic with exponential backoff
- Queue persistence across app restarts

### Conflict Resolution
- Last-write-wins strategy
- Merge strategies for different data types
- Conflict detection and logging
- User notification of conflicts

### Offline Detection
- Network state monitoring
- Graceful degradation when offline
- Automatic reconnection handling
- Sync state indicators

### Batch Operations
- Grouping of related operations
- Atomic commit semantics
- Rollback on failure
- Transaction-like behavior

## Key Responsibilities

1. **Queue Management**: Maintain a reliable queue of pending operations
2. **Conflict Resolution**: Handle data conflicts when syncing
3. **Network Detection**: Monitor and respond to network state changes
4. **State Persistence**: Save sync state across sessions
5. **Error Recovery**: Implement robust retry and recovery strategies
6. **Performance**: Minimize battery and bandwidth usage

## How It Works

### Operation Flow

```
User Action
    ↓
[Validate] → [Queue] (If offline)
    ↓
[Store Locally]
    ↓
[Attempt Sync] (Automatic when online)
    ↓
[Resolve Conflicts]
    ↓
[Update Local & Remote]
    ↓
[Mark Complete]
```

### Sync States

1. **IDLE**: No pending operations
2. **SYNCING**: Currently synchronizing
3. **QUEUED**: Operations waiting to sync
4. **CONFLICT**: Conflict detected during sync
5. **ERROR**: Error during sync, will retry
6. **OFFLINE**: No network connection

## Usage Examples

### Basic Sync Engine Usage
```typescript
import { SyncEngine } from '@pharmstation/core/sync';

const syncEngine = new SyncEngine(supabaseClient, localDatabase);

// Sync when ready
await syncEngine.sync();

// Check if online
const isOnline = syncEngine.isOnline();

// Get sync status
const status = syncEngine.getStatus(); // 'idle' | 'syncing' | 'queued' | etc.
```

### Queuing Operations When Offline
```typescript
import { SyncQueue } from '@pharmstation/core/sync';

const queue = new SyncQueue(localStorage);

// Operations are automatically queued when offline
const operation = {
  type: 'CREATE',
  table: 'cd_register',
  data: cdEntry,
  timestamp: Date.now()
};

await queue.enqueue(operation);

// Operations are automatically synced when online
```

### Handling Conflicts
```typescript
import { ConflictResolver } from '@pharmstation/core/sync';

const resolver = new ConflictResolver();

// Configure conflict resolution strategy
resolver.setStrategy('cd_register', {
  strategy: 'LAST_WRITE_WINS',
  fieldOverrides: {
    'notes': 'MERGE_STRINGS'
  }
});

// Resolve conflicts automatically
const resolved = resolver.resolve(localVersion, remoteVersion);
```

### Monitoring Sync State
```typescript
import { SyncEngine } from '@pharmstation/core/sync';

const syncEngine = new SyncEngine(supabaseClient, localDatabase);

// Listen to sync state changes
syncEngine.on('state-change', (newState) => {
  console.log('Sync state:', newState);
  updateUI(newState);
});

// Get pending operations count
const pending = await syncEngine.getPendingCount();
console.log(`${pending} operations waiting to sync`);

// Get last sync time
const lastSync = syncEngine.getLastSyncTime();
```

### Error Handling and Retries
```typescript
import { SyncEngine, SyncError } from '@pharmstation/core/sync';

const syncEngine = new SyncEngine(supabaseClient, localDatabase);

// Configure retry strategy
syncEngine.setRetryPolicy({
  maxRetries: 5,
  initialDelay: 1000, // 1 second
  maxDelay: 30000,    // 30 seconds
  backoffMultiplier: 2
});

// Handle sync errors
syncEngine.on('sync-error', (error: SyncError) => {
  console.error('Sync failed:', error.message);
  // Operations remain in queue for retry
});
```

## Core Features

### 1. Persistent Queue
- Operations survive app restart
- Stored in local database or localStorage
- Automatic expiration of old entries
- Priority system for time-sensitive operations

### 2. Smart Batching
- Groups related operations
- Reduces network requests
- Maintains atomic semantics
- Improves sync performance

### 3. Conflict Detection
- Timestamp-based conflict detection
- Field-level conflict resolution
- Audit trail of conflicts
- User notification system

### 4. Network Awareness
- Automatically detects network state
- Stops sync attempts when offline
- Resumes automatically when online
- Works with different network types

### 5. Retry Strategy
- Exponential backoff for failures
- Jitter to prevent thundering herd
- Max retry limits to prevent stuck operations
- Dead letter queue for problematic operations

## Data Structure

### Queue Entry Format
```typescript
interface QueueEntry {
  id: string;           // Unique operation ID
  type: 'CREATE' | 'UPDATE' | 'DELETE'; // Operation type
  table: string;        // Target table name
  data: Record<string, any>; // Operation data
  timestamp: number;    // When operation was queued
  retries: number;      // Number of retry attempts
  lastError?: string;   // Last error message
  priority: number;     // 0 (low) to 10 (high)
}
```

## Performance Considerations

### Battery Usage
- Batches operations to reduce sync frequency
- Implements exponential backoff for retries
- Avoids unnecessary network requests
- Configurable sync intervals

### Bandwidth
- Compresses data before transmission
- Only syncs changed fields
- Caches remote data locally
- Efficient diff algorithms

### Storage
- Configurable retention of sync history
- Automatic cleanup of old entries
- Compression of archived data
- SQLite or IndexedDB as local store

## Related Documentation

- [Models Documentation](../models/README.md)
- [Validation Documentation](../validation/README.md)
- [Supabase Client Package](../../supabase-client/README.md)

## Configuration

### Development
```javascript
const syncEngine = new SyncEngine(client, db, {
  autoSync: true,
  syncInterval: 5000,  // 5 seconds
  maxRetries: 3,
  debug: true
});
```

### Production
```javascript
const syncEngine = new SyncEngine(client, db, {
  autoSync: true,
  syncInterval: 60000, // 60 seconds
  maxRetries: 5,
  debug: false
});
```

## Testing

Includes comprehensive test utilities:
- Mock network state changes
- Simulate sync failures
- Verify queue operations
- Test conflict resolution

## Contributing Guidelines

When working with the sync engine:
1. Always test offline scenarios
2. Consider battery and bandwidth impact
3. Document sync impacts of schema changes
4. Add monitoring for stuck operations
5. Update error handling for new error types
6. Add integration tests with real database

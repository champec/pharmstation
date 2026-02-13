# PharmStation User Flows

**Last Updated**: [TODO]  
**Version**: 1.0

## TODO: Add Content

This document should contain detailed user flows for key tasks in PharmStation.

### Suggested Sections

#### 1. User Flow: RP Sign-In

**Actor**: Responsible Pharmacist (Sarah or James)

**Steps**:
1. User opens PharmStation (web/mobile/desktop)
2. User is already logged in (session maintained)
3. User navigates to RP Log
4. User clicks "Sign In as RP"
5. System captures:
   - Pharmacist name (from user profile)
   - GPhC number (from user profile)
   - Date and time (automatic)
6. User confirms
7. System records entry
8. User sees confirmation "Signed in as RP at [time]"

**Variations**:
- First-time setup: User enters GPhC number once
- Mobile: One-tap sign-in widget

**Time**: <30 seconds

#### 2. User Flow: CD Register Entry (Receipt)

**Actor**: Responsible Pharmacist

**Steps**:
1. User has CD invoice in hand
2. User opens CD Register
3. User selects drug book (e.g., "Morphine Sulphate 10mg Tablets")
   - If new drug: User creates new book
4. User clicks "New Receipt"
5. User enters:
   - Date (defaults to today)
   - Supplier (autocomplete from previous)
   - Quantity received
   - Invoice number
6. System calculates new running balance
7. User confirms entry
8. System records with timestamp and user
9. User sees updated balance

**Keyboard Shortcuts**:
- Ctrl+N: New entry
- Tab: Navigate fields
- Enter: Confirm

**Time**: <2 minutes

#### 3. User Flow: CD Register Entry (Supply)

**Actor**: Responsible Pharmacist

**Steps**:
1. User has dispensed CD to patient
2. User opens CD Register
3. User selects drug book
4. User clicks "New Supply"
5. User enters:
   - Date (defaults to today)
   - Patient name
   - Patient address (autocomplete if repeat patient)
   - Prescriber name
   - Prescriber address
   - Quantity supplied
6. System calculates new running balance
7. User confirms entry
8. System records with timestamp and user
9. User sees updated balance

**Future Enhancement** (Phase 2):
- Scan prescription → AI suggests entry → User confirms

**Time**: <3 minutes

#### 4. User Flow: CD Register Correction

**Actor**: Responsible Pharmacist

**Steps**:
1. User identifies error in previous entry
2. User opens CD Register
3. User finds the incorrect entry
4. User clicks "Correct This Entry"
5. System shows:
   - Original entry (read-only, grayed out)
   - Correction form (editable)
6. User enters:
   - Corrected information
   - Reason for correction
7. User confirms correction
8. System:
   - Marks original as "Corrected - see entry #[new]"
   - Creates new entry "Correction of entry #[old]"
   - Recalculates running balance from point of correction
9. User sees both entries in audit trail

**Important**: Original entry never deleted or overwritten

**Time**: <3 minutes

#### 5. User Flow: Handover Note Creation

**Actor**: Any staff member

**Steps**:
1. User opens Handover Notes board
2. User double-clicks empty space on canvas
3. Note appears at clicked location
4. User types message
5. User optionally:
   - Changes color (priority indicator)
   - Assigns to team member
   - Sets due date
6. User clicks outside note to save
7. Note remains on board
8. Assigned user gets notification (if enabled)

**Time**: <1 minute

#### 6. User Flow: Export CD Register for Inspection

**Actor**: Pharmacy Owner (Sarah)

**Steps**:
1. Inspector announces inspection
2. User opens CD Register
3. User selects drug book to export
4. User clicks "Export/Print"
5. User selects:
   - Date range (or "All entries")
   - Format (PDF, Excel)
6. System generates document with:
   - All entries in chronological order
   - Running balances
   - Correction trails
   - Header with pharmacy details
7. User downloads/prints
8. User provides to inspector

**Time**: <2 minutes per drug book

#### 7. User Flow: New Pharmacy Onboarding

**Actor**: Pharmacy Owner

**Steps**:
1. User visits pharmstation.co.uk
2. User clicks "Sign Up"
3. User enters:
   - Pharmacy name
   - Pharmacy address
   - Pharmacy GPhC number (optional)
   - Owner name
   - Owner email
4. User creates password
5. System sends verification email
6. User verifies email
7. User completes profile:
   - Own GPhC number
   - Role (Owner/RP)
   - Phone number
8. User sees onboarding wizard:
   - Welcome tour
   - First RP sign-in tutorial
   - First CD entry tutorial
   - Invite team members
9. User completes first entry
10. User sees dashboard

**Time**: 15 minutes

#### 8. User Flow: Team Member Invitation

**Actor**: Pharmacy Owner

**Steps**:
1. User opens Settings → Team
2. User clicks "Invite Team Member"
3. User enters:
   - Email address
   - Name
   - Role (Pharmacist, Technician, Staff)
   - Permissions (what they can access)
4. User clicks "Send Invitation"
5. System sends email to team member
6. Team member clicks link
7. Team member creates password
8. Team member joins pharmacy workspace
9. Owner sees team member in team list

**Time**: 2 minutes

#### 9. User Flow: Genie Natural Language Search (Phase 2)

**Actor**: Any user

**Steps**:
1. User opens Genie panel (Ctrl+K)
2. User types question:
   - "Find all morphine entries in January"
   - "Show me CD balance discrepancies"
   - "When did Dr. Smith last prescribe tramadol?"
3. System:
   - Parses natural language
   - Searches relevant records
   - Highlights matches
4. System displays results with:
   - Relevant entries
   - Highlighted search terms
   - Quick actions (view detail, export)
5. User clicks result to view full entry

**Time**: <30 seconds

#### 10. User Flow Diagrams

For each flow, include:
- Start and end points
- Decision points
- Happy path
- Error handling
- Alternative paths

**Diagram Format**:
```
[Start] → [Action] → {Decision?} → [Action] → [End]
                         ↓
                    [Alt Action] → [End]
```

---

**Related Documents**:
- [User Personas](./user-personas.md)
- [Product Vision](./PRODUCT_VISION.md)

# Phase 1: MVP Features

**Last Updated**: [TODO]  
**Version**: 1.0

## TODO: Add Content

This document should contain detailed specifications for Phase 1 (MVP) features.

### Suggested Sections

#### 1. Phase 1 Overview
- Timeline: Months 1-6
- Goal: Launch with core registers that work perfectly
- Success criteria

#### 2. Feature List

**Core Registers**:
- Responsible Pharmacist (RP) Log
- Controlled Drug (CD) Register
- Patient Returns Log
- Private CD Register

**Supporting Features**:
- SOP Library (lightweight)
- Handover Notes board
- Compliance logs (fridge, cleaning, date checking, guest, near miss)

#### 3. Detailed Feature Specs

**For Each Feature**:
- User stories
- Acceptance criteria
- UI/UX requirements
- Data model
- Validation rules
- Export/print requirements
- Mobile considerations

#### 4. Out of Scope for Phase 1
- AI features (Genie) - Phase 2
- Mobile app - Phase 3
- Desktop app - Phase 3
- Service delivery features - Phase 4
- Advanced integrations

#### 5. Technical Requirements
- Must work offline
- Must sync when online
- Must maintain audit trail
- Cannot delete/overwrite records (except via correction workflow)

#### 6. Legal Compliance Checklist
- [ ] Meets Misuse of Drugs Regulations 2001
- [ ] Meets GPhC record-keeping standards
- [ ] Proper correction workflow (no deletion)
- [ ] Complete audit trail
- [ ] Export capability for inspections

#### 7. Testing Strategy
- Unit tests for validation rules
- Integration tests for sync
- E2E tests for core workflows
- User acceptance testing with beta pharmacies

#### 8. Launch Criteria
- All P0 features complete
- Beta testing with 20 pharmacies
- NPS score >40 from beta users
- No P0 bugs
- Export functionality verified by actual GPhC inspector (ideal)

---

**Related Documents**:
- [Product Vision](./PRODUCT_VISION.md)
- [Feature Roadmap](./feature-roadmap.md)

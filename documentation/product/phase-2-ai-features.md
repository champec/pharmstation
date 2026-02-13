# Phase 2: AI Features (Genie)

**Last Updated**: [TODO]  
**Version**: 1.0

## TODO: Add Content

This document should contain detailed specifications for Phase 2 AI features.

### Suggested Sections

#### 1. Phase 2 Overview
- Timeline: Months 7-12
- Goal: Add AI assistance to reduce manual work
- Genie as enhancement, not replacement

#### 2. Genie Feature List

**Natural Language Search**:
- Search across all records using plain English
- Pharmacy terminology understanding
- Fuzzy matching

**Scan-to-Entry**:
- Invoice scanning (CD receipts)
- Prescription scanning
- AI drafts entry → Human approves

**Task Suggestions**:
- Proactive compliance alerts
- Overdue task identification
- Discrepancy detection

**Reconciliation Assistant**:
- Guided CD reconciliation workflow
- Discrepancy investigation prompts

**Regulatory Q&A**:
- Answer pharmacy law questions
- Source: GPhC guidelines, MDR 2001

#### 3. AI Model Selection
- LLM for natural language (GPT-4, Claude, etc.)
- OCR for scanning (Tesseract, cloud services)
- Fine-tuning for pharmacy terminology

#### 4. Human-in-the-Loop Design
- AI never writes directly to registers
- Always requires human approval
- Clear indication of AI-suggested vs. human-entered

#### 5. Privacy and Security
- No patient data sent to third-party AI services (or proper consent/anonymization)
- On-device processing where possible
- Compliance with GDPR and NHS data standards

#### 6. Pricing Strategy
- Genie included in Professional tier (£79/mo)
- Drives upgrades from Starter tier

---

**Related Documents**:
- [Product Vision](./PRODUCT_VISION.md)
- [Genie Chatbot Design](../technical/genie-chatbot-design.md)
- [AI Invoice Processing](../technical/ai-invoice-processing.md)

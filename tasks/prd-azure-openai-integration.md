# Product Requirements Document: Azure OpenAI Integration

## Task List for: Azure OpenAI Integration Feature

**PRD Reference:** `memory-bank/productContext.md`

## Relevant Files & Test Strategy
*This section will be updated during implementation.*
- `src/utils/azureOpenAI.js` - Azure OpenAI service implementation (using openai package v5.9.2)
- `src/utils/gemini.js` - IPC handlers for Azure initialization
- `src/components/views/AdvancedView.js` - UI components for Azure configuration
- `src/components/app/CheatingDaddyApp.js` - Main app logic for provider switching
- `src/utils/renderer.js` - Renderer functions for Azure initialization

### Azure OpenAI Implementation Notes
- Uses the `openai` npm package (v5.9.2) with custom Azure configuration
- Authentication via `api-key` header instead of Bearer token
- Endpoint format: `{endpoint}/openai/deployments/{deployment}`
- Deployment name used instead of model name

### Notes on Testing
- Test provider switching functionality (Gemini ↔ Azure)
- Test credential validation with valid/invalid Azure credentials
- Test session initialization with real Azure OpenAI deployment
- Test error handling scenarios
- Verify localStorage persistence of Azure settings
- Run existing test suite to ensure no regressions

## Tasks

- [ ] 1.0 Verify Current Implementation Completeness
  - [ ] 1.1 Review AzureOpenAIService class implementation
  - [ ] 1.2 Verify IPC handler parameter passing and return values
  - [ ] 1.3 Check UI component integration and localStorage handling
  - [ ] 1.4 Validate main app provider switching logic
  - [ ] 1.5 Confirm renderer function integration

- [ ] 2.0 Test Current Implementation
  - [ ] 2.1 Test Azure UI fields appear and function correctly
  - [ ] 2.2 Test credential validation with invalid inputs
  - [ ] 2.3 Test provider switching between Gemini and Azure
  - [ ] 2.4 Test session initialization with real Azure credentials
  - [ ] 2.5 Verify error handling and status updates

- [ ] 3.0 Complete Implementation (if needed)
  - [ ] 3.1 Fix any parameter mismatch issues
  - [ ] 3.2 Ensure proper error handling and validation
  - [ ] 3.3 Verify all localStorage operations work correctly
  - [ ] 3.4 Test end-to-end flow with real Azure deployment
  - [ ] 3.5 Ensure backward compatibility with existing features

- [ ] 4.0 Documentation and Finalization
  - [ ] 4.1 Update activeContext.md with implementation progress
  - [ ] 4.2 Document Azure configuration requirements
  - [ ] 4.3 Prepare for user testing and feedback
  - [ ] 4.4 Create interim step checkin as requested

## Introduction/Overview
**Feature Name:** Azure OpenAI Integration
**Description:** Add Azure OpenAI as an alternative Language Learning Model (LLM) provider alongside Google Gemini, allowing users to choose between different AI services for real-time assistance.

## Goals
- Provide users with Azure OpenAI as a reliable alternative LLM provider
- Maintain feature parity with existing Gemini integration
- Ensure seamless switching between providers without disrupting user workflow
- Implement proper error handling and credential validation

## User Stories
- As a user, I want to select Azure OpenAI as my LLM provider so I can use Microsoft's AI services
- As a user, I want to enter my Azure API credentials securely so I can authenticate with Azure OpenAI
- As a user, I want to switch between Gemini and Azure OpenAI providers easily so I can choose the best service for my needs
- As a user, I want clear error messages when my Azure credentials are invalid so I can fix configuration issues

## Functional Requirements
1. The system must allow users to select "Azure OpenAI" as an LLM provider in the Advanced settings
2. The system must provide input fields for Azure API Key, Endpoint, and Deployment Name
3. The system must validate Azure credentials before starting a session
4. The system must initialize Azure OpenAI service with proper authentication headers
5. The system must handle provider switching seamlessly between Gemini and Azure OpenAI
6. The system must display appropriate error messages for Azure-specific issues
7. The system must store Azure credentials securely in localStorage
8. The system must maintain the same real-time functionality as Gemini integration

## Non-Goals (Out of Scope)
- Adding support for other LLM providers beyond Azure OpenAI
- Implementing advanced Azure-specific features beyond basic real-time chat
- Creating separate UI components for Azure (will reuse existing patterns)
- Adding Azure-specific configuration options beyond basic authentication

## Technical Considerations
- Must follow PR84 implementation patterns exactly to ensure compatibility
- Azure OpenAI uses different authentication (api-key header) compared to regular OpenAI
- Azure OpenAI endpoint format: `{endpoint}/openai/deployments/{deployment}`
- Must maintain backward compatibility with existing Gemini implementation
- Should reuse existing LLMService base class architecture

## Success Metrics
- Users can successfully switch between Gemini and Azure OpenAI providers
- Azure OpenAI sessions initialize without errors when valid credentials are provided
- Invalid credential scenarios show clear, helpful error messages
- No performance degradation compared to existing Gemini implementation
- All existing functionality continues to work with Azure provider selected

## Open Questions
- Should we provide default values for Azure deployment name beyond "gpt-realtime"?
- Are there specific Azure OpenAI models that should be supported?
- Should we implement Azure-specific rate limiting considerations?

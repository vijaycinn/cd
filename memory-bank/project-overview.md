# Project Overview

## Cheating Daddy - AI Interview Assistant

**Version:** 0.4.0
**Last Updated:** September 29, 2025

## High-Level Vision

Cheating Daddy is an AI-powered interview assistant application designed to provide real-time assistance during technical interviews and coding sessions. The application captures system audio, screenshots, and user interactions to provide contextual AI responses that help users navigate interview scenarios effectively.

## Core Mission

To create a seamless, privacy-focused AI assistant that helps developers and technical professionals succeed in interviews by providing real-time, context-aware assistance while maintaining ethical boundaries.

## Key Features

- **Real-time Audio Processing**: Captures and processes system audio to understand interview context
- **Screen Capture**: Takes periodic screenshots to provide visual context to the AI
- **Multi-LLM Support**: Integrates with multiple Language Learning Models (Google Gemini, Azure OpenAI)
- **Cross-Platform**: Works on Windows, macOS, and Linux operating systems
- **Privacy Focused**: All processing happens locally with user-controlled data
- **Stealth Mode**: Content protection to prevent screen sharing detection

## Target Users

- Software developers preparing for technical interviews
- Computer science students practicing coding problems
- Technical professionals seeking interview assistance
- Career changers entering the tech industry

## Technical Architecture

The application is built as an Electron desktop application with:
- **Frontend**: HTML/CSS/JavaScript with LitElement for UI components
- **Backend**: Node.js with Electron for cross-platform desktop integration
- **AI Services**: Google Gemini API and Azure OpenAI API integration
- **Audio Processing**: Real-time PCM audio capture and processing
- **Storage**: Local storage with IndexedDB for conversation history

## Current Development Status

The application is in active development with version 0.4.0, focusing on expanding LLM provider support and improving real-time processing capabilities.

## Future Goals

- Integration with additional LLM providers
- Enhanced privacy and security features
- Improved UI/UX for better user experience
- Advanced analytics and insights
- Mobile application support

# Symptom Classify & Book Agent

An AI agent that classifies patient symptoms by urgency and department, then books the right appointment — in a single step.

## Overview
Patients often don't know which doctor to consult or how urgent their symptoms are. This AI agent takes patient symptoms via text or voice, uses LLM reasoning to classify urgency and department, and automatically books the appropriate appointment.

## Features
- **Symptom Classification** — Groq LLM reasons about symptoms to determine urgency and department
- **Voice Input** — Web Speech API for hands-free symptom reporting
- **Hybrid Safety** — AI reasoning + rule-based safety floor for high-risk symptoms
- **Human-in-the-Loop** — Low-confidence cases flagged for clinician review
- **Auth0 Token Vault** — Secure identity layer for every booking
- **FHIR Interoperability** — Appointments written to FHIR sandbox for EHR integration
- **A2A Ready** — Published on Prompt Opinion marketplace with agent-to-agent communication

## Tech Stack
- Backend: Node.js, Express
- AI: Groq SDK (Llama 3.3 70B)
- Auth: Auth0 Token Vault
- Interoperability: FHIR (HAPI sandbox)
- Voice: Web Speech API
- Platform: Prompt Opinion (A2A enabled)

## How It Works
1. Patient describes symptoms via text or voice
2. AI classifies urgency (High/Medium/Low) and department
3. Safety rules override AI if needed (e.g., chest pain = always urgent)
4. Appointment is booked with hospital and doctor assigned
5. Record saved locally and written to FHIR sandbox
6. Auth0 token secures the transaction

## Impact
- **Fewer wrong bookings** — AI routes patients to the right department
- **Faster care** — Urgent cases flagged immediately
- **Clinician trust** — Transparent reasoning + human escalation
- **Interoperable** — FHIR-ready for real hospital integration

## Future Scope
- Camera-based distress detection
- Real-time wearable integration
- Multi-language support
- Edge deployment for rural clinics

## Demo
[Link to demo video]

## Prompt Opinion Agent
Published on Prompt Opinion marketplace with A2A and FHIR context enabled.

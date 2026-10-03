---
commit: d31dead
generated: 2026-10-03
scope: plain-language product overview
---

# Career OS — Product Overview

A plain-language guide to what Career OS is, what it does, and how it is built. No technical background needed.

> Career OS is **free and open-source software**, released under the **GNU AGPL-3.0-or-later** license. You can run it, read its code, and modify it.

## What Career OS is

Career OS is a personal career assistant that you run yourself, on your own computer or server. Think of it as a private, always-on career coach and organizer in one: it keeps a living record of your professional life, watches the job market for you, and helps you apply well, without ever inventing things about your experience.

It is built around one simple promise: it works from *evidence*, not guesswork. Everything it tells you or writes for you is tied back to real facts you have confirmed, such as your resume, your public code, and your assessment results.

## Who it is for

Career OS is for one person at a time: someone actively looking for a job, or preparing for their next move, who wants serious automation without handing their private career data to a large company. It suits people who are comfortable running software on their own machine and who care about privacy.

It is not a public website, not a recruiting product, and not something your employer or a third party operates for you.

## What it does

- **Builds a digital twin of you.** It gathers your resume, your public code, your practice results, and what you have done in past applications, then keeps a continuously updated picture of your skills. Each skill is shown with how strong it is, how confident the system is, and how recently you used it.
- **Practices with you.** It offers a range of exercises and assessments, tracks your progress, and suggests what to learn next based on what the job market actually wants.
- **Watches the job market.** It collects job listings from reputable sources, cleans and de-duplicates them, checks how fresh they are, and matches them to your real skills, so you see the roles that genuinely fit. It can also discover postings on public company career sites and job boards (including Workday and other major applicant-tracking systems) using a managed web-crawling service, always respecting each site's published rules and only for public pages.
- **Helps you apply.** It can prepare resumes and cover letters tailored to a specific job, but only by rephrasing facts you have already confirmed. Anything it cannot back up is blocked before you ever see it.
- **Keeps you organized.** It tracks each application through every stage, reminds you what needs doing, and follows up on replies.
- **Reaches you where you are.** It can send a daily summary and take simple commands through Slack, read job-related email to keep your application tracker up to date, and offer a **free companion mobile app** (iOS and Android) showing your daily brief, matched jobs, and pending approvals on the go.
- **Works on desktop too.** A small companion program for your own computer lets you review devices, pair the desktop agent, and run job-site browsing from your own logged-in session.

## How people use it

1. **Set it up once.** You install it, then walk through a guided setup that connects your accounts, imports your resume, and asks you to confirm the facts it found. Nothing sensitive is accepted without your review.
2. **Review your starting point.** The dashboard shows your skill picture, your progress, and early suggestions for what to strengthen.
3. **Practice and improve.** You take assessments and work through suggested learning, and your profile gets more accurate over time.
4. **Browse matched jobs.** The market view shows roles that fit your verified skills, with a clear explanation of where you are strong and where there are gaps.
5. **Prepare and apply.** You generate a tailored resume or cover letter, review it, and approve it. Nothing is ever sent on your behalf without your explicit approval.
6. **Track and follow up.** Your applications and replies stay in one timeline, so nothing falls through the cracks.

## How it is built (in general terms)

Career OS is a self-contained application. You run a web interface that you open in your browser, backed by a secure database that stores your information, plus background helpers that fetch and organize job data. A companion mobile app (Expo/React Native, iOS and Android) reads the same data from your server, and a small desktop program can browse job sites using your own logged-in session, with your permission. For public company career pages and job boards, it uses a managed crawling service and direct adapters that honor each site's rules and rate limits; sites that forbid automated access are not crawled. It is free and open-source software (AGPL-3.0-or-later), so the whole system is inspectable and self-hostable.

It is designed to be provider-agnostic for artificial intelligence: the intelligence layer is a replaceable component, so the system can work with different AI providers instead of being tied to one. It ships with a sensible default and can fall back to a locally run model if your preferred service is unavailable.

## Trust and privacy

- **You own the data.** Career OS is designed so you can export everything it holds about you, or delete it entirely, with a confirmation step. Your backup files are encrypted before they leave your machine.
- **Nothing sends itself.** Every outgoing action, such as submitting an application or sending a message, waits for your approval and is recorded in an audit trail.
- **No invented facts.** Generated documents may only rephrase facts you have confirmed, and a second check blocks anything it cannot trace to a source.
- **Careful with sensitive material.** Content marked as employer-confidential is, by default, never sent to an external AI service.
- **Quiet by default.** The system does not report back to its makers; it only talks to the services you personally connect, and everything about your data stays under your control.

## Where to go next

- **Product and architecture detail:** see the technical knowledge base in this folder (`README.md`, `ARCHITECTURE.md`).
- **Setup walkthrough:** see `docs/dev-setup.md` in the repository.
- **Rules and roadmap:** see `AGENTS.md` and `plan/PLAN.md`.
- **Security posture:** see `SECURITY.md` and `plan/security.md`.

> Current state: Career OS is an early alpha, under active development. Some features described above are partially built and clearly marked as such in the technical documents. The mobile app is read-only for now (no push or offline support yet). Treat this overview as the intended product, and the engineering knowledge base as the accurate picture of what exists today.

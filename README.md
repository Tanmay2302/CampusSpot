# 🏛️ CampusSpot: Confidence-Aware Coordination Kernel

A high-concurrency coordination system for shared campus assets (labs, study pods, equipment). Unlike traditional booking systems that only track "available/busy," CampusSpot models **State Confidence** to handle real-world uncertainty and stale data.

## 🧠 The Engineering Challenge

Shared resources often suffer from "Phantom Bookings" (no-shows) and stale status data. CampusSpot solves this through:

1. **Database-Level Concurrency:** Strict row-level locking (`FOR UPDATE`) to prevent double-bookings during race conditions.
2. **Confidence Modeling:** Explicit separation of Asset Status (Available/In-Use) and State Confidence (Live/Scheduled/Stale).
3. **Self-Healing Decay:** A background maintenance engine using PostgreSQL Advisory Locks to release no-shows and expire completed sessions.

## 🛠️ Tech Stack

- **Backend:** Node.js, Express, PostgreSQL (Raw SQL/`pg`)
- **Real-time:** Socket.io (State synchronization)
- **Frontend:** React, Tailwind CSS v4, Axios
- **Database Architecture:** ACID-compliant transactions with atomic coordination.

## 🛡️ Key Safety Features

- **Overlap-Safe Queries:** SQL logic prevents any two reservations from intersecting on the timeline.
- **Identity-Lite Enforcement:** Transactional check-ins validated against the booking owner.
- **Clock Safety:** Authoritative time is handled by the Database (`NOW()`), preventing issues with client-side clock drift.

## 🚀 Scaling Story

In a production environment, this kernel is designed to scale by:

- Moving to **Optimistic Locking** for high-read/low-write contention.
- Using **Redis** to back the Socket.io broadcast for multi-instance deployments.
- Transitioning the **Advisory Lock** maintenance cycle to a dedicated worker process.

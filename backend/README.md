# Backend Service

Go-based REST API and background service for the attendance system.

## Responsibilities
- Process scan requests from the macOS app.
- Handle session logic (e.g., tracking entry and exit times, enforcing the 1-hour trigger rule).
- Sync attendance logs to Google Sheets via the Sheets API.
- Expose a REST API for the Admin Portal to fetch live data and logs.

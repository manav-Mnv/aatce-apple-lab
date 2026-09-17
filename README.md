# AATCE Apple Lab Attendance System

A face-recognition based lab attendance system for the university coding club's Apple Lab.

## Architecture & Monorepo Structure

- **/macos-app**: Swift/SwiftUI application for the lab iMac. Handles face detection (Vision framework) and matching (CoreML).
- **/backend**: Go service that processes scan requests, handles session logic (entry/exit, 1-hour minimums), and syncs with Google Sheets.
- **/ml-training**: Python pipeline to generate embeddings from raw face images and retrain/fine-tune the CoreML matching model.
- **/admin-portal**: Web dashboard (React) for faculty and admins to view live occupancy, session logs, and export data.
- **/docs**: System architecture overview, data schemas, and key design rules.

## Core Principles
* **Enrollment Number as Key**: A face is never new data on its own. It is always linked to an existing or newly created enrollment number.

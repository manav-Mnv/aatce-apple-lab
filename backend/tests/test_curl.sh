#!/usr/bin/env bash
# tests/test_curl.sh — curl examples for testing the deployed Web App
#
# Usage:
#   1. Deploy your Apps Script project as a Web App (Execute as: Me, Access: Anyone)
#   2. Set WEBAPP_URL below to your deployment URL
#   3. Set API_SECRET to the value you stored in Script Properties
#   4. chmod +x tests/test_curl.sh && ./tests/test_curl.sh

WEBAPP_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
API_SECRET="your-shared-secret-here"

echo "=== Health Check ==="
curl -s "$WEBAPP_URL" | python3 -m json.tool

echo -e "\n\n=== Enroll (single student) ==="
curl -s -X POST "$WEBAPP_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: $API_SECRET" \
  -d '{
    "route": "enroll",
    "studentId": "STU-001",
    "firstName": "Alice",
    "lastName": "Johnson",
    "email": "alice@example.com",
    "grade": "10"
  }' | python3 -m json.tool

echo -e "\n\n=== Enroll (batch) ==="
curl -s -X POST "$WEBAPP_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: $API_SECRET" \
  -d '{
    "route": "enroll",
    "students": [
      {"studentId": "STU-002", "firstName": "Bob", "lastName": "Smith", "grade": "11"},
      {"studentId": "STU-003", "firstName": "Carol", "lastName": "Lee", "email": "carol@example.com", "grade": "9"}
    ]
  }' | python3 -m json.tool

echo -e "\n\n=== Enroll (duplicate — should error) ==="
curl -s -X POST "$WEBAPP_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: $API_SECRET" \
  -d '{
    "route": "enroll",
    "studentId": "STU-001",
    "firstName": "Alice",
    "lastName": "Johnson"
  }' | python3 -m json.tool

echo -e "\n\n=== Enroll (missing fields — should error) ==="
curl -s -X POST "$WEBAPP_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: $API_SECRET" \
  -d '{
    "route": "enroll",
    "studentId": "STU-004",
    "firstName": ""
  }' | python3 -m json.tool

echo -e "\n\n=== Scan (valid token — paste token from enroll response) ==="
TOKEN="PASTE_ENROLLED_TOKEN_HERE"
curl -s -X POST "$WEBAPP_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: $API_SECRET" \
  -d "{
    \"route\": \"scan\",
    \"token\": \"$TOKEN\",
    \"location\": \"main-gate\"
  }" | python3 -m json.tool

echo -e "\n\n=== Scan (invalid token) ==="
curl -s -X POST "$WEBAPP_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: $API_SECRET" \
  -d '{
    "route": "scan",
    "token": "not-a-real-token",
    "location": "main-gate"
  }' | python3 -m json.tool

echo -e "\n\n=== Scan (duplicate — within cooldown) ==="
curl -s -X POST "$WEBAPP_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: $API_SECRET" \
  -d "{
    \"route\": \"scan\",
    \"token\": \"$TOKEN\",
    \"location\": \"main-gate\"
  }" | python3 -m json.tool

echo -e "\n\n=== Auth failure (bad secret) ==="
curl -s -X POST "$WEBAPP_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: wrong-secret" \
  -d '{"route": "scan", "token": "test"}' | python3 -m json.tool

echo -e "\n\n=== Unknown route ==="
curl -s -X POST "$WEBAPP_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: $API_SECRET" \
  -d '{"route": "nonexistent"}' | python3 -m json.tool

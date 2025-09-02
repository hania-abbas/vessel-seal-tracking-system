# Vessel Seal Tracking System Documentation

## Overview

This document provides information about the error handling, validation, and submission tracking features of the Vessel Seal Tracking System.

## Error Codes and Messages

### API Error Codes

- `visit_required`: Visit ID is missing in the request
- `supervisor_required`: Vessel supervisor name is missing
- `invalid_seal_format`: Invalid seal number format
- `payload_overlap`: Single seal number is included in the provided range
- `not_delivered_for_visit`: Seals were not delivered in the specified visit
- `duplicate_found`: Seals have already been returned
- `validation_error`: General validation error
- `server_error`: Internal server error

### HTTP Status Codes

- `400`: Bad Request - Invalid input data
- `409`: Conflict - Business rule violation (duplicates, invalid seals)
- `500`: Internal Server Error

## Real-time Validation

The system performs real-time validation on seal numbers with the following rules:

- Seal numbers must be 6-9 digits long
- Range end must be greater than or equal to range start
- Damaged and lost seal numbers must be valid seal numbers
- All seal numbers must have been delivered in the current visit
- Seals cannot be returned multiple times

## Loading States

The system shows loading indicators during:

- Form submissions
- Data fetching
- Background operations

## Retry Mechanism

- Automatic retry for failed submissions
- Maximum 3 retry attempts
- Exponential backoff between retries
- Visual feedback during retry attempts

## Submission History

The system maintains a history of submissions with:

- Timestamp
- Submission details
- Status (pending/success/error)
- Error messages if any
- Response data

### History Management

- Stores last 50 submissions
- Persists across page reloads
- Can be cleared manually
- Filtered by current visit

## Error Logging

The system logs errors at multiple levels:

1. Client-side Console

   - Validation failures
   - API call errors
   - Retry attempts

2. Server-side Logs
   - Request validation errors
   - Database operation errors
   - Business rule violations

## Troubleshooting Guide

### Common Issues and Solutions

1. "Invalid seal format"

   - Check seal number is 6-9 digits
   - Remove any special characters
   - Ensure no spaces in numbers

2. "Not delivered for visit"

   - Verify seal was delivered in current visit
   - Check visit ID is correct
   - Confirm seal number typing

3. "Duplicate found"
   - Check seal hasn't been returned already
   - Verify against submission history
   - Contact supervisor if needed

### Best Practices

1. Data Entry

   - Always verify seal numbers before submission
   - Use single seal entry for uncertain cases
   - Include notes for special situations

2. Error Resolution

   - Check error message details
   - Review submission history
   - Validate against physical records
   - Contact IT support if persistent

3. System Usage
   - Regular submission history cleanup
   - Report persistent issues
   - Keep error logs for auditing

## Technical Details

### Frontend Components

1. `submission-state.js`

   - Manages loading states
   - Handles retry logic
   - Updates UI during submissions

2. `validation.js`

   - Real-time input validation
   - Form submission validation
   - Error message display

3. `submission-history.js`
   - Tracks submission attempts
   - Stores success/failure status
   - Manages history display

### Backend Components

1. Error Handling

   - Structured error responses
   - Detailed error logging
   - Transaction management

2. Validation Layer

   - Input sanitization
   - Business rule validation
   - Duplicate checking

3. Database Operations
   - Atomic transactions
   - Error recovery
   - Data consistency checks

## Future Improvements

1. Enhanced Validation

   - Pattern recognition for common errors
   - Predictive error prevention
   - Custom validation rules

2. Reporting

   - Error frequency analysis
   - Success rate tracking
   - Performance monitoring

3. User Experience
   - Improved error visualizations
   - Guided error resolution
   - Context-aware help

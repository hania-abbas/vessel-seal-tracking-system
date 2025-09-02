// frontend/seal-handling.js

// frontend/seal-handling.js
import submissionState from './submission-state.js';
import validationHelper from './validation.js';
import submissionHistory from './submission-history.js';

class SealHandler {
  constructor() {
    this.initialized = false;
    this.currentVisit = null;
  }

  initialize() {
    if (this.initialized) return;

    // Initialize validation
    validationHelper.setupFormValidation('sealForm');
    validationHelper.setupFormValidation('returnedSealForm');

    // Get current visit
    this.currentVisit = this.getVisitFromURL();
    this.updateVisitInForms();

    // Set up event listeners
    this.setupEventListeners();

    // Load initial data
    this.loadInitialData();

    this.initialized = true;
    console.log('✅ Seal handler initialized');
  }

  getVisitFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('visit');
  }

  updateVisitInForms() {
    const visitInputs = document.querySelectorAll('input[id*="visit"], input[name*="visit"]');
    visitInputs.forEach(input => {
      input.value = this.currentVisit;
    });

    // Update page title with visit info
    if (this.currentVisit) {
      document.title = `Seal Management - Visit ${this.currentVisit}`;
    }
  }

  setupEventListeners() {
    // Clear history button
    document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
      this.clearHistory();
    });

    // Form submission handlers
    document.getElementById('sealForm')?.addEventListener('submit', (e) => {
      this.handleFormSubmit(e, 'delivered');
    });

    document.getElementById('returnedSealForm')?.addEventListener('submit', (e) => {
      this.handleFormSubmit(e, 'returned');
    });

    // Refresh log button
    document.getElementById('refreshSealLogBtn')?.addEventListener('click', () => {
      this.refreshSealLog();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      this.handleKeyboardShortcuts(e);
    });
  }

  async handleFormSubmit(event, formType) {
    event.preventDefault();
    
    const form = event.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    try {
      await submissionState.withRetry(async () => {
        const submission = submissionHistory.addSubmission({
          ...data,
          formType,
          timestamp: new Date().toISOString()
        });

        const response = await fetch(`/api/${formType}-seals`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data)
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || `Failed to submit ${formType} seals`);
        }

        const result = await response.json();
        submissionHistory.updateSubmissionStatus(submission, 'success', result);

        // Clear form on success
        if (formType === 'delivered') {
          this.clearForm('sealForm');
        } else {
          this.clearForm('returnedSealForm');
        }

        // Refresh log
        this.refreshSealLog();

        return result;
      });
    } catch (error) {
      console.error(`${formType} form submission error:`, error);
      this.showError(error.message);
    }
  }

  clearForm(formId) {
    const form = document.getElementById(formId);
    if (form) {
      form.reset();
      // Trigger validation update
      validationHelper.updateFormValidity();
    }
  }

  clearHistory() {
    if (confirm('Are you sure you want to clear all submission history? This action cannot be undone.')) {
      submissionHistory.clearHistory();
      this.showSuccess('History cleared successfully');
    }
  }

  async refreshSealLog() {
    if (typeof window.loadSealLog === 'function') {
      await window.loadSealLog();
      this.showSuccess('Log refreshed');
    }
  }

  showError(message) {
    this.showNotification(message, 'error');
  }

  showSuccess(message) {
    this.showNotification(message, 'success');
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
      <span>${message}</span>
      <button onclick="this.parentElement.remove()">×</button>
    `;
    
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      background: ${type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : '#17a2b8'};
      color: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: 400px;
    `;
    
    document.body.appendChild(notification);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 5000);
  }

  handleKeyboardShortcuts(event) {
    // Ctrl+Enter to submit forms
    if (event.ctrlKey && event.key === 'Enter') {
      const activeForm = document.querySelector('form:focus-within');
      if (activeForm) {
        activeForm.dispatchEvent(new Event('submit'));
      }
    }
    
    // Esc to clear forms
    if (event.key === 'Escape') {
      const activeInput = document.activeElement;
      if (activeInput?.form) {
        activeInput.form.reset();
      }
    }
  }

  async loadInitialData() {
    // Load initial seal log
    if (typeof window.loadSealLog === 'function') {
      await window.loadSealLog();
    }
    
    // Load submission history
    submissionHistory.updateUI();
  }
}

// Create and initialize singleton
const sealHandler = new SealHandler();

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  sealHandler.initialize();
});

// Export for global access
window.sealHandler = sealHandler;
export default sealHandler;
